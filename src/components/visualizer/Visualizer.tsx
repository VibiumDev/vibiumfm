import { useCallback, useRef, useState, useEffect } from 'react';
import Scene from './Scene';
import AudioControls from '../player/AudioControls';
import { useAudioAnalyzer } from '@/hooks/useAudioAnalyzer';
import audioFile from '@/assets/built-to-bend.mp3';

const AUDIO_URL = audioFile;

const Visualizer = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [remountKey, setRemountKey] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  
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

  // Listen for fullscreen changes - force remount on exit to fix layout
  useEffect(() => {
    const handleFullscreenChange = () => {
      const nowFullscreen = !!document.fullscreenElement;
      const wasFullscreen = isFullscreen;
      setIsFullscreen(nowFullscreen);
      
      // When EXITING fullscreen, fade out, remount, then fade back in
      if (wasFullscreen && !nowFullscreen) {
        setIsTransitioning(true);
        
        setTimeout(() => {
          setRemountKey(k => k + 1);
          
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setIsTransitioning(false);
            });
          });
        }, 200);
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
      key={remountKey}
      ref={containerRef}
      className={`fixed inset-0 flex flex-col bg-gradient-to-br from-player-dark via-player-purple/20 to-player-orange/10 overflow-hidden transition-opacity duration-200 ${
        isTransitioning ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Gradient overlay for depth */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
      
      {/* 3D Canvas - takes remaining space */}
      <div className="flex-1 relative min-h-0">
        <Scene frequencyData={frequencyData} />
      </div>

      {/* Audio Controls - fixed bottom padding for Android gesture nav */}
      <div className="relative z-10 pb-14 sm:pb-8 flex-shrink-0">
        <AudioControls
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          isMuted={isMuted}
          isLooping={isLooping}
          onTogglePlay={togglePlay}
          onSeekPreview={seek}
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
