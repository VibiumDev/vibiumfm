import { useCallback, useRef, useState, useEffect } from 'react';
import Scene from './Scene';
import AudioControls from '../player/AudioControls';
import { useAudioAnalyzer } from '@/hooks/useAudioAnalyzer';
import audioFile from '@/assets/built-to-bend.mp3';

const AUDIO_URL = audioFile;

const Visualizer = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const {
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    isLooping,
    frequencyData,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    toggleLoop,
  } = useAudioAnalyzer(AUDIO_URL);

  // Listen for fullscreen changes to force layout recalculation
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      // Force a reflow on mobile after exiting fullscreen
      if (!document.fullscreenElement && containerRef.current) {
        containerRef.current.style.display = 'none';
        containerRef.current.offsetHeight; // Trigger reflow
        containerRef.current.style.display = '';
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const handleFullscreen = useCallback(() => {
    if (containerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        containerRef.current.requestFullscreen();
      }
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-screen h-[100dvh] flex flex-col bg-gradient-to-br from-player-dark via-player-purple/20 to-player-orange/10 overflow-hidden"
    >
      {/* Gradient overlay for depth */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
      
      {/* 3D Canvas - takes remaining space */}
      <div className="flex-1 relative">
        <Scene frequencyData={frequencyData} />
      </div>

      {/* Audio Controls - auto-sized at bottom with safe area padding */}
      <div className="relative z-10 pb-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-8">
        <AudioControls
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          isMuted={isMuted}
          isLooping={isLooping}
          onTogglePlay={togglePlay}
          onSeek={seek}
          onVolumeChange={setVolume}
          onToggleMute={toggleMute}
          onToggleLoop={toggleLoop}
          onFullscreen={handleFullscreen}
        />
      </div>
    </div>
  );
};

export default Visualizer;
