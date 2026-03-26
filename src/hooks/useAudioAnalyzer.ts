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
  const pendingSeekRef = useRef<number | null>(null);
  const cleanupAudioListenersRef = useRef<(() => void) | null>(null);

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
        // If a seek is pending, don't let the browser overwrite our state
        if (pendingSeekRef.current !== null) return;
        setState(prev => ({ ...prev, currentTime: audio.currentTime }));
      };

      const handleLoadedMetadata = () => {
        setState(prev => ({ ...prev, duration: audio.duration }));
      };

      const handleEnded = () => {
        pendingSeekRef.current = null;
        setState(prev => ({ ...prev, isPlaying: false, currentTime: 0 }));
      };

      audio.volume = stateRef.current.volume;
      audio.muted = stateRef.current.isMuted;
      audio.loop = stateRef.current.isLooping;

      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      audio.addEventListener('ended', handleEnded);

      cleanupAudioListenersRef.current = () => {
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('ended', handleEnded);
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

    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    // Apply deferred seek before playing — keep ref set until browser confirms
    const seekTarget = pendingSeekRef.current;
    if (seekTarget !== null) {
      audio.currentTime = seekTarget;
      // Clear pending only after the browser has actually seeked
      const onSeeked = () => {
        pendingSeekRef.current = null;
        audio.removeEventListener('seeked', onSeeked);
      };
      audio.addEventListener('seeked', onSeeked);
    }

    await audio.play();
    setState(prev => ({ ...prev, isPlaying: true }));
  }, [ensureAudioGraph]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setState(prev => ({ ...prev, isPlaying: false }));
  }, []);

  const togglePlay = useCallback(() => {
    if (state.isPlaying) {
      pause();
    } else {
      void play();
    }
  }, [state.isPlaying, play, pause]);

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

    // Always update React state immediately
    setState(prev => ({ ...prev, currentTime: time }));

    if (state.isPlaying) {
      // Playing: seek the audio element directly (buffering is active)
      audio.currentTime = time;
      pendingSeekRef.current = null;
    } else {
      // Paused: defer the seek until play()
      pendingSeekRef.current = time;
    }
  }, [ensureAudioElement, state.isPlaying]);

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
