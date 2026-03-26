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

const SEEK_TOLERANCE = 0.25;
const SEEK_RELEASE_DELAY = 150;
const SEEK_METADATA_TIMEOUT = 500;
const SEEK_SETTLE_TIMEOUT = 250;

export const useAudioAnalyzer = (audioUrl: string) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const animationRef = useRef<number>(0);
  const seekingRef = useRef(false);
  const seekTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
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

  const applyPendingSeek = useCallback(async (audio: HTMLAudioElement, targetTime: number) => {
    pendingSeekRef.current = targetTime;

    if (Math.abs(audio.currentTime - targetTime) <= SEEK_TOLERANCE) {
      pendingSeekRef.current = null;
      return;
    }

    if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise<void>((resolve) => {
        let resolved = false;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeoutId);
          audio.removeEventListener('loadedmetadata', finish);
          audio.removeEventListener('canplay', finish);
          resolve();
        };

        const timeoutId = window.setTimeout(finish, SEEK_METADATA_TIMEOUT);
        audio.addEventListener('loadedmetadata', finish);
        audio.addEventListener('canplay', finish);
        audio.load();
      });
    }

    try {
      audio.currentTime = targetTime;
    } catch {
      return;
    }

    if (Math.abs(audio.currentTime - targetTime) <= SEEK_TOLERANCE) {
      pendingSeekRef.current = null;
      return;
    }

    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        audio.removeEventListener('seeked', finish);
        audio.removeEventListener('canplay', finish);
        resolve();
      };

      const timeoutId = window.setTimeout(finish, SEEK_SETTLE_TIMEOUT);
      audio.addEventListener('seeked', finish);
      audio.addEventListener('canplay', finish);
    });

    if (Math.abs(audio.currentTime - targetTime) <= SEEK_TOLERANCE) {
      pendingSeekRef.current = null;
    }
  }, []);

  const ensureAudioElement = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio(audioUrl);
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';

      const syncPendingSeek = () => {
        const pendingTime = pendingSeekRef.current;
        if (pendingTime === null || Number.isNaN(pendingTime)) return;

        if (Math.abs(audio.currentTime - pendingTime) > SEEK_TOLERANCE) {
          try {
            audio.currentTime = pendingTime;
          } catch {
            return;
          }
        }

        if (Math.abs(audio.currentTime - pendingTime) <= SEEK_TOLERANCE) {
          pendingSeekRef.current = null;
        }
      };

      const handleTimeUpdate = () => {
        if (!seekingRef.current) {
          setState(prev => ({ ...prev, currentTime: audio.currentTime }));
        }

        if (pendingSeekRef.current !== null && Math.abs(audio.currentTime - pendingSeekRef.current) <= SEEK_TOLERANCE) {
          pendingSeekRef.current = null;
        }
      };

      const handleLoadedMetadata = () => {
        setState(prev => ({ ...prev, duration: audio.duration }));
        syncPendingSeek();
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
      audio.addEventListener('canplay', syncPendingSeek);
      audio.addEventListener('seeked', syncPendingSeek);
      audio.addEventListener('ended', handleEnded);

      cleanupAudioListenersRef.current = () => {
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('canplay', syncPendingSeek);
        audio.removeEventListener('seeked', syncPendingSeek);
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

    const intended = pendingSeekRef.current ?? stateRef.current.currentTime;
    if (intended > 0) {
      await applyPendingSeek(audio, intended);
    }

    await audio.play();
    setState(prev => ({ ...prev, isPlaying: true }));
  }, [applyPendingSeek, ensureAudioGraph]);

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
    pendingSeekRef.current = time;
    seekingRef.current = true;
    clearTimeout(seekTimeoutRef.current);

    setState(prev => ({ ...prev, currentTime: time }));

    const commitSeek = () => {
      void applyPendingSeek(audio, time);
    };

    if (audio.paused) {
      window.setTimeout(commitSeek, 0);
    } else {
      commitSeek();
    }

    seekTimeoutRef.current = window.setTimeout(() => {
      seekingRef.current = false;
    }, SEEK_RELEASE_DELAY);
  }, [applyPendingSeek, ensureAudioElement]);

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
      clearTimeout(seekTimeoutRef.current);
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
