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

const SEEK_TOLERANCE = 0.5;

export const useAudioAnalyzer = (audioUrl: string) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const animationRef = useRef<number>(0);
  const cleanupAudioListenersRef = useRef<(() => void) | null>(null);

  // Separate refs for the Chrome-safe seek reconciliation
  const desiredTimeRef = useRef<number | null>(null);
  const awaitingPlaybackSeekRef = useRef(false);
  const seekRetryCountRef = useRef(0);

  const [state, setState] = useState<AudioAnalyzerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.7,
    isMuted: false,
    isLooping: false,
    frequencyData: new Uint8Array(256),
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const ensureAudioElement = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio(audioUrl);
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';

      const handleTimeUpdate = () => {
        const target = desiredTimeRef.current;

        // While awaiting playback confirmation at a seek target, guard against Chrome pushing 0
        if (target !== null && awaitingPlaybackSeekRef.current) {
          if (Math.abs(audio.currentTime - target) <= SEEK_TOLERANCE) {
            // Confirmed: playback is at the target
            desiredTimeRef.current = null;
            awaitingPlaybackSeekRef.current = false;
            seekRetryCountRef.current = 0;
            setState(prev => ({ ...prev, currentTime: audio.currentTime }));
          } else if (seekRetryCountRef.current < 5) {
            // Chrome reset to 0 — force seek again
            seekRetryCountRef.current += 1;
            audio.currentTime = target;
            setState(prev => ({ ...prev, currentTime: target }));
          } else {
            // Give up after too many retries
            desiredTimeRef.current = null;
            awaitingPlaybackSeekRef.current = false;
            seekRetryCountRef.current = 0;
            setState(prev => ({ ...prev, currentTime: audio.currentTime }));
          }
          return;
        }

        // If we have a desired time but not awaiting playback (paused scrub), keep UI at desired
        if (target !== null) {
          setState(prev => ({ ...prev, currentTime: target }));
          return;
        }

        // Normal: no pending seek
        setState(prev => ({ ...prev, currentTime: audio.currentTime }));
      };

      const handleLoadedMetadata = () => {
        setState(prev => ({ ...prev, duration: audio.duration }));
      };

      const handleEnded = () => {
        desiredTimeRef.current = null;
        awaitingPlaybackSeekRef.current = false;
        seekRetryCountRef.current = 0;
        setState(prev => ({ ...prev, isPlaying: false, currentTime: 0 }));
      };

      // Do NOT clear desiredTimeRef in seeked — Chrome fires this before playback stabilizes
      const handleSeeked = () => {
        // intentionally empty — confirmation happens in timeupdate/playing only
      };

      const handlePlaying = () => {
        const target = desiredTimeRef.current;
        if (target !== null && awaitingPlaybackSeekRef.current) {
          if (Math.abs(audio.currentTime - target) > SEEK_TOLERANCE) {
            // Chrome started from wrong position — force seek
            seekRetryCountRef.current += 1;
            audio.currentTime = target;
            setState(prev => ({ ...prev, currentTime: target }));
          } else {
            // Already at target
            desiredTimeRef.current = null;
            awaitingPlaybackSeekRef.current = false;
            seekRetryCountRef.current = 0;
            setState(prev => ({ ...prev, currentTime: audio.currentTime }));
          }
        }
      };

      audio.volume = stateRef.current.volume;
      audio.muted = stateRef.current.isMuted;
      audio.loop = stateRef.current.isLooping;

      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      audio.addEventListener('ended', handleEnded);
      audio.addEventListener('seeked', handleSeeked);
      audio.addEventListener('playing', handlePlaying);

      cleanupAudioListenersRef.current = () => {
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('ended', handleEnded);
        audio.removeEventListener('seeked', handleSeeked);
        audio.removeEventListener('playing', handlePlaying);
      };

      audioRef.current = audio;
    }

    return audioRef.current;
  }, [audioUrl]);

  const ensureAudioGraph = useCallback(() => {
    const audio = ensureAudioElement();

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 512;
      analyserRef.current.smoothingTimeConstant = 0.8;

      gainRef.current = audioContextRef.current.createGain();
      gainRef.current.gain.value = stateRef.current.volume;

      sourceRef.current = audioContextRef.current.createMediaElementSource(audio);
      sourceRef.current.connect(analyserRef.current);
      analyserRef.current.connect(gainRef.current);
      gainRef.current.connect(audioContextRef.current.destination);
    }
  }, [ensureAudioElement]);

  const updateFrequencyData = useCallback(() => {
    if (analyserRef.current && stateRef.current.isPlaying) {
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);
      setState(prev => ({ ...prev, frequencyData: dataArray }));
      animationRef.current = requestAnimationFrame(updateFrequencyData);
    }
  }, []);

  const play = useCallback(async () => {
    ensureAudioGraph();
    const audio = audioRef.current!;

    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    const target = desiredTimeRef.current;
    if (target !== null) {
      // Apply the deferred seek before play
      audio.currentTime = target;
      setState(prev => ({ ...prev, currentTime: target }));
      // Mark as awaiting confirmation — don't clear desiredTimeRef yet
      awaitingPlaybackSeekRef.current = true;
      seekRetryCountRef.current = 0;
    }

    await audio.play();
    setState(prev => ({ ...prev, isPlaying: true }));

    // Post-play: if Chrome reset position, force it again
    if (target !== null && Math.abs(audio.currentTime - target) > SEEK_TOLERANCE) {
      audio.currentTime = target;
    }
  }, [ensureAudioGraph]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setState(prev => ({ ...prev, isPlaying: false }));
  }, []);

  const togglePlay = useCallback(() => {
    if (stateRef.current.isPlaying) {
      pause();
    } else {
      void play();
    }
  }, [play, pause]);

  const setVolume = useCallback((volume: number) => {
    const audio = ensureAudioElement();
    audio.volume = volume;
    if (gainRef.current) {
      gainRef.current.gain.value = volume;
    }
    setState(prev => ({ ...prev, volume, isMuted: volume === 0 }));
  }, [ensureAudioElement]);

  const toggleMute = useCallback(() => {
    const audio = ensureAudioElement();
    setState(prev => {
      const newMuted = !prev.isMuted;
      audio.muted = newMuted;
      if (gainRef.current) {
        gainRef.current.gain.value = newMuted ? 0 : prev.volume;
      }
      return { ...prev, isMuted: newMuted };
    });
  }, [ensureAudioElement]);

  const seek = useCallback((time: number) => {
    const audio = ensureAudioElement();

    // Always update UI immediately
    setState(prev => ({ ...prev, currentTime: time }));

    if (stateRef.current.isPlaying) {
      // Playing: seek directly, no deferred logic needed
      audio.currentTime = time;
      desiredTimeRef.current = null;
      awaitingPlaybackSeekRef.current = false;
      seekRetryCountRef.current = 0;
    } else {
      // Paused: store desired time, defer actual seek to play()
      desiredTimeRef.current = time;
      awaitingPlaybackSeekRef.current = false; // not awaiting yet — that happens on play()
      seekRetryCountRef.current = 0;
    }
  }, [ensureAudioElement]);

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

  useEffect(() => {
    ensureAudioElement();
  }, [ensureAudioElement]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animationRef.current);
      cleanupAudioListenersRef.current?.();
      audioRef.current?.pause();
      audioContextRef.current?.close();
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
