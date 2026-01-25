import { useCallback, useRef } from 'react';
import Scene from './Scene';
import AudioControls from '../player/AudioControls';
import { useAudioAnalyzer } from '@/hooks/useAudioAnalyzer';

// Placeholder audio URL - replace with actual Vibium anthem
const AUDIO_URL = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';

const Visualizer = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const {
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    frequencyData,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
  } = useAudioAnalyzer(AUDIO_URL);

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
      className="relative w-full h-screen bg-gradient-to-br from-player-dark via-player-purple/20 to-player-orange/10 overflow-hidden"
    >
      {/* Gradient overlay for depth */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
      
      {/* 3D Canvas */}
      <div className="absolute inset-0">
        <Scene frequencyData={frequencyData} />
      </div>

      {/* Audio Controls */}
      <div className="absolute bottom-8 left-0 right-0 z-10">
        <AudioControls
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          isMuted={isMuted}
          onTogglePlay={togglePlay}
          onSeek={seek}
          onVolumeChange={setVolume}
          onToggleMute={toggleMute}
          onFullscreen={handleFullscreen}
        />
      </div>
    </div>
  );
};

export default Visualizer;
