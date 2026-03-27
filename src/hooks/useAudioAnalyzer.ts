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
const SEEK_RETRY_LIMIT = 8;

export const useAudioAnalyzer = (audioUrl: string) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const animationRef = useRef<number>(0);
  const cleanupAudioListenersRef = useRef<(() => void) | null>(null);

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

        if (target !== null) {
          if (awaitingPlaybackSeekRef.current) {
            if (Math.abs(audio.currentTime - target) <= SEEK_TOLERANCE) {
              desiredTimeRef.current = null;
              awaitingPlaybackSeekRef.current = false;
              seekRetryCountRef.current = 0;
              setState(prev => ({ ...prev, currentTime: audio.currentTime }));
              return;
            }

            if (seekRetryCountRef.current < SEEK_RETRY_LIMIT) {
              seekRetryCountRef.current += 1;
              audio.currentTime = target;
            }

            setState(prev => ({ ...prev, currentTime: target }));
            return;
          }

          setState(prev => ({ ...prev, currentTime: target }));
          return;
        }

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

      const handleSeeking = () => {
        if (desiredTimeRef.current !== null && stateRef.current.isPlaying) {
          awaitingPlaybackSeekRef.current = true;
        }
      };

      const handleSeeked = () => {
        if (desiredTimeRef.current !== null && !awaitingPlaybackSeekRef.current) {
          setState(prev => ({ ...prev, currentTime: desiredTimeRef.current ?? prev.currentTime }));
        }
      };

      const handlePlaying = () => {
        const target = desiredTimeRef.current;

        if (target !== null) {
          awaitingPlaybackSeekRef.current = true;

          if (Math.abs(audio.currentTime - target) > SEEK_TOLERANCE) {
            if (seekRetryCountRef.current < SEEK_RETRY_LIMIT) {
              seekRetryCountRef.current += 1;
              audio.currentTime = target;
            }
          }

          setState(prev => ({ ...prev, currentTime: target }));
        }
      };

      audio.volume = stateRef.current.volume;
      audio.muted = stateRef.current.isMuted;
      audio.loop = stateRef.current.isLooping;

      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      audio.addEventListener('ended', handleEnded);
      audio.addEventListener('seeking', handleSeeking);
      audio.addEventListener('seeked', handleSeeked);
      audio.addEventListener('playing', handlePlaying);

      cleanupAudioListenersRef.current = () => {
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('ended', handleEnded);
        audio.removeEventListener('seeking', handleSeeking);
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
    const target = desiredTimeRef.current;

    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    if (target !== null) {
      awaitingPlaybackSeekRef.current = true;
      seekRetryCountRef.current = 0;
      audio.currentTime = target;
      setState(prev => ({ ...prev, currentTime: target }));
    }

    await audio.play();
    setState(prev => ({ ...prev, isPlaying: true, currentTime: target ?? prev.currentTime }));

    if (target !== null) {
      requestAnimationFrame(() => {
        if (!audio.paused && desiredTimeRef.current === target && Math.abs(audio.currentTime - target) > SEEK_TOLERANCE) {
          if (seekRetryCountRef.current < SEEK_RETRY_LIMIT) {
            seekRetryCountRef.current += 1;
            audio.currentTime = target;
          }
          setState(prev => ({ ...prev, currentTime: target }));
        }
      });
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

    setState(prev => ({ ...prev, currentTime: time }));

    if (stateRef.current.isPlaying) {
      audio.currentTime = time;
      desiredTimeRef.current = null;
      awaitingPlaybackSeekRef.current = false;
      seekRetryCountRef.current = 0;
      return;
    }

    desiredTimeRef.current = time;
    awaitingPlaybackSeekRef.current = false;
    seekRetryCountRef.current = 0;
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
