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

const SEEK_TOLERANCE = 0.35;

export const useAudioAnalyzer = (audioUrl: string) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const animationRef = useRef<number>(0);
  const playbackSeekAnimationRef = useRef<number>(0);
  const cleanupAudioListenersRef = useRef<(() => void) | null>(null);
  const pendingSeekRef = useRef<number | null>(null);

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

  const clearPlaybackSeekAnimation = useCallback(() => {
    cancelAnimationFrame(playbackSeekAnimationRef.current);
    playbackSeekAnimationRef.current = 0;
  }, []);

  const getClampedTime = useCallback((audio: HTMLAudioElement, time: number) => {
    const max = Number.isFinite(audio.duration) ? audio.duration : time;
    return Math.max(0, Math.min(time, max));
  }, []);

  const schedulePlaybackSeekCorrection = useCallback((audio: HTMLAudioElement) => {
    clearPlaybackSeekAnimation();

    playbackSeekAnimationRef.current = requestAnimationFrame(() => {
      playbackSeekAnimationRef.current = requestAnimationFrame(() => {
        playbackSeekAnimationRef.current = 0;

        const target = pendingSeekRef.current;
        if (target === null) return;

        if (Math.abs(audio.currentTime - target) > SEEK_TOLERANCE) {
          audio.currentTime = target;
          setState(prev => ({ ...prev, currentTime: target }));
          return;
        }

        pendingSeekRef.current = null;
      });
    });
  }, [clearPlaybackSeekAnimation]);

  const ensureAudioElement = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio(audioUrl);
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';

      const handleTimeUpdate = () => {
        const target = pendingSeekRef.current;

        if (target !== null && Math.abs(audio.currentTime - target) <= SEEK_TOLERANCE) {
          pendingSeekRef.current = null;
        }

        setState(prev => ({ ...prev, currentTime: audio.currentTime }));
      };

      const handleLoadedMetadata = () => {
        const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
        const target = pendingSeekRef.current;

        if (target !== null) {
          const clampedTarget = getClampedTime(audio, target);
          pendingSeekRef.current = clampedTarget;
          audio.currentTime = clampedTarget;
          setState(prev => ({ ...prev, duration: nextDuration, currentTime: clampedTarget }));
          return;
        }

        setState(prev => ({ ...prev, duration: nextDuration }));
      };

      const handlePlaying = () => {
        setState(prev => ({ ...prev, isPlaying: true, currentTime: audio.currentTime }));

        if (pendingSeekRef.current !== null) {
          schedulePlaybackSeekCorrection(audio);
        }
      };

      const handlePause = () => {
        setState(prev => ({ ...prev, isPlaying: false, currentTime: audio.currentTime }));
      };

      const handleSeeked = () => {
        const target = pendingSeekRef.current;

        if (target !== null && Math.abs(audio.currentTime - target) <= SEEK_TOLERANCE) {
          pendingSeekRef.current = null;
        }

        setState(prev => ({ ...prev, currentTime: audio.currentTime }));
      };

      const handleEnded = () => {
        clearPlaybackSeekAnimation();
        pendingSeekRef.current = null;
        setState(prev => ({ ...prev, isPlaying: false, currentTime: 0 }));
      };

      audio.volume = stateRef.current.volume;
      audio.muted = stateRef.current.isMuted;
      audio.loop = stateRef.current.isLooping;

      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      audio.addEventListener('playing', handlePlaying);
      audio.addEventListener('pause', handlePause);
      audio.addEventListener('seeked', handleSeeked);
      audio.addEventListener('ended', handleEnded);

      cleanupAudioListenersRef.current = () => {
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('playing', handlePlaying);
        audio.removeEventListener('pause', handlePause);
        audio.removeEventListener('seeked', handleSeeked);
        audio.removeEventListener('ended', handleEnded);
      };

      audioRef.current = audio;
    }

    return audioRef.current;
  }, [audioUrl, clearPlaybackSeekAnimation, getClampedTime, schedulePlaybackSeekCorrection]);

  const ensureAudioGraph = useCallback(() => {
    const audio = ensureAudioElement();

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 512;
      analyserRef.current.smoothingTimeConstant = 0.8;

      gainRef.current = audioContextRef.current.createGain();
      gainRef.current.gain.value = stateRef.current.isMuted ? 0 : stateRef.current.volume;

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
    const audio = audioRef.current;

    if (!audio) return;

    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    if (pendingSeekRef.current !== null) {
      const target = getClampedTime(audio, pendingSeekRef.current);
      pendingSeekRef.current = target;
      audio.currentTime = target;
      setState(prev => ({ ...prev, currentTime: target }));
    }

    try {
      await audio.play();
      setState(prev => ({ ...prev, isPlaying: true, currentTime: audio.currentTime }));

      if (pendingSeekRef.current !== null) {
        schedulePlaybackSeekCorrection(audio);
      }
    } catch {
      setState(prev => ({ ...prev, isPlaying: false }));
    }
  }, [ensureAudioGraph, getClampedTime, schedulePlaybackSeekCorrection]);

  const pause = useCallback(() => {
    clearPlaybackSeekAnimation();
    const audio = audioRef.current;

    if (!audio) {
      setState(prev => ({ ...prev, isPlaying: false }));
      return;
    }

    audio.pause();
    setState(prev => ({ ...prev, isPlaying: false, currentTime: audio.currentTime }));
  }, [clearPlaybackSeekAnimation]);

  const togglePlay = useCallback(() => {
    if (stateRef.current.isPlaying) {
      pause();
    } else {
      void play();
    }
  }, [play, pause]);

  const setVolume = useCallback((volume: number) => {
    const audio = ensureAudioElement();
    const isMuted = volume === 0;

    audio.volume = volume;
    audio.muted = isMuted;

    if (gainRef.current) {
      gainRef.current.gain.value = isMuted ? 0 : volume;
    }

    setState(prev => ({ ...prev, volume, isMuted }));
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

  const previewSeek = useCallback((time: number) => {
    setState(prev => ({ ...prev, currentTime: time }));
  }, []);

  const seek = useCallback((time: number) => {
    const audio = ensureAudioElement();
    const nextTime = getClampedTime(audio, time);

    clearPlaybackSeekAnimation();
    pendingSeekRef.current = nextTime;
    setState(prev => ({ ...prev, currentTime: nextTime }));

    if (audio.readyState < 1) return;

    audio.currentTime = nextTime;

    if (stateRef.current.isPlaying) {
      schedulePlaybackSeekCorrection(audio);
    }
  }, [clearPlaybackSeekAnimation, ensureAudioElement, getClampedTime, schedulePlaybackSeekCorrection]);

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
      clearPlaybackSeekAnimation();
      cancelAnimationFrame(animationRef.current);
      cleanupAudioListenersRef.current?.();
      audioRef.current?.pause();
      void audioContextRef.current?.close();
    };
  }, [clearPlaybackSeekAnimation]);

  return {
    ...state,
    play,
    pause,
    togglePlay,
    setVolume,
    toggleMute,
    previewSeek,
    seek,
    toggleLoop,
  };
};
