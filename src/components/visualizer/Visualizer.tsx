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
      const wasFullscreen = isFullscreen;
      const nowFullscreen = !!document.fullscreenElement;
      setIsFullscreen(nowFullscreen);
      
      // Force layout recalculation when EXITING fullscreen on mobile
      if (wasFullscreen && !nowFullscreen && containerRef.current) {
        // Use a small delay to let the browser finish its fullscreen transition
        setTimeout(() => {
          if (containerRef.current) {
            // Force a reflow by toggling display
            containerRef.current.style.display = 'none';
            // Read a layout property to force synchronous reflow
            void containerRef.current.offsetHeight;
            containerRef.current.style.display = '';
            
            // Dispatch resize event to trigger dvh recalculation
            window.dispatchEvent(new Event('resize'));
            
            // Additional reflow after a frame for stubborn browsers
            requestAnimationFrame(() => {
              if (containerRef.current) {
                containerRef.current.style.opacity = '0.99';
                requestAnimationFrame(() => {
                  if (containerRef.current) {
                    containerRef.current.style.opacity = '';
                  }
                });
              }
            });
          }
        }, 100);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [isFullscreen]);

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
      <div className="relative z-10 pb-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-8">
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
