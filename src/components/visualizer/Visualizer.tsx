import { useCallback, useRef, useState, useEffect } from 'react';
import Scene from './Scene';
import AudioControls from '../player/AudioControls';
import { useAudioAnalyzer } from '@/hooks/useAudioAnalyzer';
import audioFile from '@/assets/built-to-bend.mp3';

const AUDIO_URL = audioFile;

const Visualizer = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  
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

  // Use Visual Viewport API for accurate height on mobile
  useEffect(() => {
    const updateHeight = () => {
      if (window.visualViewport) {
        setViewportHeight(window.visualViewport.height);
      } else {
        setViewportHeight(window.innerHeight);
      }
    };

    updateHeight();

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateHeight);
      window.visualViewport.addEventListener('scroll', updateHeight);
    }
    window.addEventListener('resize', updateHeight);
    window.addEventListener('orientationchange', () => {
      // Delay to let orientation change complete
      setTimeout(updateHeight, 100);
    });

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateHeight);
        window.visualViewport.removeEventListener('scroll', updateHeight);
      }
      window.removeEventListener('resize', updateHeight);
    };
  }, []);

  // Listen for fullscreen changes to force layout recalculation
  useEffect(() => {
    const handleFullscreenChange = () => {
      const wasFullscreen = isFullscreen;
      const nowFullscreen = !!document.fullscreenElement;
      setIsFullscreen(nowFullscreen);
      
      // Force layout recalculation when EXITING fullscreen on mobile
      if (wasFullscreen && !nowFullscreen) {
        // Use a small delay to let the browser finish its fullscreen transition
        setTimeout(() => {
          // Re-trigger viewport height calculation
          if (window.visualViewport) {
            setViewportHeight(window.visualViewport.height);
          } else {
            setViewportHeight(window.innerHeight);
          }
          
          // Dispatch resize event to trigger any other listeners
          window.dispatchEvent(new Event('resize'));
          
          // Force container reflow if needed
          if (containerRef.current) {
            containerRef.current.style.display = 'none';
            void containerRef.current.offsetHeight;
            containerRef.current.style.display = '';
          }
        }, 150);
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

  // Use inline height from Visual Viewport API, fallback to 100dvh
  const containerStyle = viewportHeight 
    ? { height: `${viewportHeight}px` } 
    : {};

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      className="relative w-full h-screen h-[100dvh] flex flex-col bg-gradient-to-br from-player-dark via-player-purple/20 to-player-orange/10 overflow-hidden"
    >
      {/* Gradient overlay for depth */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
      
      {/* 3D Canvas - takes remaining space */}
      <div className="flex-1 relative">
        <Scene frequencyData={frequencyData} />
      </div>

      {/* Audio Controls - larger bottom padding for Android gesture nav (48-56px) */}
      <div className="relative z-10 pb-14 sm:pb-8">
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
