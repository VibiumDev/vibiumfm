import { useRef, useState, useCallback, useEffect } from 'react';

interface AudioAnalyzerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isLooping: boolean;
  frequencyData: Uint8Array;
}

export const useAudioAnalyzer = (audioUrl: string) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const animationRef = useRef<number>(0);
  const seekingRef = useRef(false);
  const pendingSeekTimeRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  // Stable event handler refs for cleanup
  const handleTimeUpdateRef = useRef<(() => void) | null>(null);
  const handleLoadedMetadataRef = useRef<(() => void) | null>(null);
  const handleEndedRef = useRef<(() => void) | null>(null);

  const [state, setState] = useState<AudioAnalyzerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.7,
    isMuted: false,
    isLooping: false,
    frequencyData: new Uint8Array(256),
  });

  // Use a ref to track latest state for audio element initialization
  const stateRef = useRef(state);
  stateRef.current = state;

  // Helper: wait for metadata to be ready
  const waitForMetadata = useCallback((audio: HTMLAudioElement): Promise<void> => {
    return new Promise((resolve) => {
      if (audio.readyState >= 1) {
        resolve();
        return;
      }
      const onLoaded = () => {
        audio.removeEventListener('loadedmetadata', onLoaded);
        resolve();
      };
      audio.addEventListener('loadedmetadata', onLoaded);
    });
  }, []);

  // Helper: seek and wait for confirmation via 'seeked' event
  const seekTo = useCallback((audio: HTMLAudioElement, time: number): Promise<void> => {
    return new Promise((resolve) => {
      seekingRef.current = true;
      
      const cleanup = () => {
        audio.removeEventListener('seeked', onSeeked);
        clearTimeout(timeoutId);
      };
      
      const onSeeked = () => {
        cleanup();
        seekingRef.current = false;
        // Clear pending if it matches what we just seeked to
        if (pendingSeekTimeRef.current === time) {
          pendingSeekTimeRef.current = null;
        }
        resolve();
      };
      
      // Safety timeout fallback (500ms)
      const timeoutId = setTimeout(() => {
        cleanup();
        seekingRef.current = false;
        resolve();
      }, 500);
      
      audio.addEventListener('seeked', onSeeked);
      audio.currentTime = time;
    });
  }, []);

  // Create audio element only (no AudioContext) - safe to call before user gesture
  const ensureAudioElement = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio(audioUrl);
      audio.crossOrigin = 'anonymous';
      audio.preload = 'metadata'; // Encourage metadata readiness on mobile
      
      // Apply current state from ref (avoids dependency on state)
      audio.volume = stateRef.current.volume;
      audio.muted = stateRef.current.isMuted;
      audio.loop = stateRef.current.isLooping;
      
      // Create stable event handlers
      handleTimeUpdateRef.current = () => {
        if (!mountedRef.current) return;
        // Don't update if we're in the middle of a seek operation
        if (!seekingRef.current) {
          setState(prev => ({ ...prev, currentTime: audio.currentTime }));
        }
      };
      
      handleLoadedMetadataRef.current = () => {
        if (!mountedRef.current) return;
        setState(prev => ({ ...prev, duration: audio.duration }));
        
        // If there's a pending seek, apply it now that metadata is ready
        if (pendingSeekTimeRef.current !== null) {
          const pendingTime = pendingSeekTimeRef.current;
          seekTo(audio, pendingTime);
        }
      };
      
      handleEndedRef.current = () => {
        if (!mountedRef.current) return;
        setState(prev => ({ ...prev, isPlaying: false, currentTime: 0 }));
      };
      
      // Attach event listeners
      audio.addEventListener('timeupdate', handleTimeUpdateRef.current);
      audio.addEventListener('loadedmetadata', handleLoadedMetadataRef.current);
      audio.addEventListener('ended', handleEndedRef.current);
      
      audioRef.current = audio;
    }
    return audioRef.current;
  }, [audioUrl, seekTo]);

  // Create AudioContext and analyzer graph - only needed for playback
  const ensureAudioGraph = useCallback(() => {
    const audio = ensureAudioElement();
    
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 512;
      analyserRef.current.smoothingTimeConstant = 0.8;

      // Create gain node for volume control (works in Safari)
      gainRef.current = audioContextRef.current.createGain();
      gainRef.current.gain.value = stateRef.current.volume;

      sourceRef.current = audioContextRef.current.createMediaElementSource(audio);
      sourceRef.current.connect(analyserRef.current);
      analyserRef.current.connect(gainRef.current);
      gainRef.current.connect(audioContextRef.current.destination);
    }
  }, [ensureAudioElement]);

  const updateFrequencyData = useCallback(() => {
    if (analyserRef.current && state.isPlaying) {
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);
      setState(prev => ({ ...prev, frequencyData: dataArray }));
      animationRef.current = requestAnimationFrame(updateFrequencyData);
    }
  }, [state.isPlaying]);

  const play = useCallback(async () => {
    ensureAudioGraph();
    const audio = audioRef.current!;
    
    // Determine target time: pending seek takes priority, then current state
    const targetTime = pendingSeekTimeRef.current ?? stateRef.current.currentTime;
    
    // Wait for metadata before seeking
    await waitForMetadata(audio);
    
    // Apply seek before playback if target is meaningful
    const duration = audio.duration;
    if (targetTime >= 0 && (!isNaN(duration) ? targetTime <= duration : true)) {
      if (Math.abs(audio.currentTime - targetTime) > 0.1) {
        await seekTo(audio, targetTime);
      }
    }
    
    // Resume AudioContext if suspended
    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    
    await audio.play();
    setState(prev => ({ ...prev, isPlaying: true }));
    
    // Post-play correction: Android Chrome may reset currentTime after play() resolves
    // Check on next frames and re-seek if needed
    const checkAndCorrect = () => {
      if (!mountedRef.current || !audioRef.current) return;
      
      const currentAudioTime = audioRef.current.currentTime;
      // If browser reset us back near 0 (or drifted significantly), re-seek
      if (Math.abs(currentAudioTime - targetTime) > 0.5 && targetTime > 0.5) {
        seekTo(audioRef.current, targetTime);
      }
    };
    
    // Use rAF twice to catch async resets
    requestAnimationFrame(() => {
      requestAnimationFrame(checkAndCorrect);
    });
  }, [ensureAudioGraph, waitForMetadata, seekTo]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setState(prev => ({ ...prev, isPlaying: false }));
  }, []);

  const togglePlay = useCallback(() => {
    if (state.isPlaying) {
      pause();
    } else {
      play();
    }
  }, [state.isPlaying, play, pause]);

  const setVolume = useCallback((volume: number) => {
    ensureAudioElement();
    // Use GainNode for volume if audio graph exists (Safari compatibility)
    if (gainRef.current) {
      gainRef.current.gain.value = volume;
    }
    setState(prev => ({ ...prev, volume, isMuted: volume === 0 }));
  }, [ensureAudioElement]);

  const toggleMute = useCallback(() => {
    ensureAudioElement();
    setState(prev => {
      const newMuted = !prev.isMuted;
      // Use GainNode for mute if audio graph exists (Safari compatibility)
      if (gainRef.current) {
        gainRef.current.gain.value = newMuted ? 0 : prev.volume;
      }
      return { ...prev, isMuted: newMuted };
    });
  }, [ensureAudioElement]);

  const seek = useCallback((time: number) => {
    // Set pending seek as source of truth
    pendingSeekTimeRef.current = time;
    
    const audio = ensureAudioElement();
    
    // Optimistically update React state immediately (keeps UI responsive)
    setState(prev => ({ ...prev, currentTime: time }));
    
    // If metadata is ready, apply the seek to the audio element
    if (audio.readyState >= 1) {
      seekTo(audio, time);
    }
    // If metadata isn't ready, loadedmetadata handler will apply the pending seek
  }, [ensureAudioElement, seekTo]);

  const toggleLoop = useCallback(() => {
    const audio = ensureAudioElement();
    setState(prev => {
      const newLooping = !prev.isLooping;
      audio.loop = newLooping;
      return { ...prev, isLooping: newLooping };
    });
  }, [ensureAudioElement]);

  useEffect(() => {
    if (state.isPlaying) {
      updateFrequencyData();
    } else {
      cancelAnimationFrame(animationRef.current);
    }
    return () => cancelAnimationFrame(animationRef.current);
  }, [state.isPlaying, updateFrequencyData]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    
    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(animationRef.current);
      
      if (audioRef.current) {
        const audio = audioRef.current;
        
        // Remove event listeners using stable refs
        if (handleTimeUpdateRef.current) {
          audio.removeEventListener('timeupdate', handleTimeUpdateRef.current);
        }
        if (handleLoadedMetadataRef.current) {
          audio.removeEventListener('loadedmetadata', handleLoadedMetadataRef.current);
        }
        if (handleEndedRef.current) {
          audio.removeEventListener('ended', handleEndedRef.current);
        }
        
        audio.pause();
        audio.src = '';
        audioRef.current = null;
      }
      
      audioContextRef.current?.close();
      audioContextRef.current = null;
      sourceRef.current = null;
      analyserRef.current = null;
      gainRef.current = null;
    };
  }, []);

  return {
    ...state,
    play,
    pause,
    togglePlay,
    setVolume,
    toggleMute,
    seek,
    toggleLoop,
  };
};
