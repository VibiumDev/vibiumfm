import { Play, Pause, Volume2, VolumeX, Maximize } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

interface AudioControlsProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onFullscreen: () => void;
}

const formatTime = (seconds: number): string => {
  if (isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const AudioControls = ({
  isPlaying,
  currentTime,
  duration,
  volume,
  isMuted,
  onTogglePlay,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onFullscreen,
}: AudioControlsProps) => {
  return (
    <div className="w-full max-w-2xl mx-auto px-4">
      <div className="bg-black/40 backdrop-blur-md rounded-2xl p-4 border border-white/10">
        {/* Progress bar */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xs text-player-text/70 w-10 text-right font-mono">
            {formatTime(currentTime)}
          </span>
          <Slider
            value={[currentTime]}
            max={duration || 100}
            step={0.1}
            onValueChange={([value]) => onSeek(value)}
            className="flex-1"
          />
          <span className="text-xs text-player-text/70 w-10 font-mono">
            {formatTime(duration)}
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between">
          {/* Volume controls */}
          <div className="flex items-center gap-2 w-32">
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleMute}
              className="text-player-text hover:text-player-accent hover:bg-white/10"
            >
              {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </Button>
            <Slider
              value={[isMuted ? 0 : volume]}
              max={1}
              step={0.01}
              onValueChange={([value]) => onVolumeChange(value)}
              className="w-20"
            />
          </div>

          {/* Play/Pause button */}
          <Button
            onClick={onTogglePlay}
            size="lg"
            className="w-14 h-14 rounded-full bg-gradient-to-br from-player-orange to-player-purple hover:opacity-90 text-white shadow-lg shadow-player-purple/30"
          >
            {isPlaying ? (
              <Pause className="w-6 h-6" />
            ) : (
              <Play className="w-6 h-6 ml-1" />
            )}
          </Button>

          {/* Fullscreen button */}
          <div className="w-32 flex justify-end">
            <Button
              variant="ghost"
              size="icon"
              onClick={onFullscreen}
              className="text-player-text hover:text-player-accent hover:bg-white/10"
            >
              <Maximize className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudioControls;
