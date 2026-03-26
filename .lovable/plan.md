

# Fix: Play always jumps back to start

## Problem
When the user seeks to a position while paused and then hits play, the audio resets to 0:00. This happens because:
1. The audio element is created eagerly on mount, but metadata may not be loaded yet
2. Setting `audio.currentTime` before the audio is fully loaded doesn't always persist
3. When `play()` is called, the first-time audio graph creation (`createMediaElementSource`) can also cause the position to reset

## Solution
In the `play` function, after setting up the audio graph and before calling `audio.play()`, re-apply the current seek position from React state to the audio element. This ensures the intended position is always enforced at play time.

## Changes

**File: `src/hooks/useAudioAnalyzer.ts`**

Update the `play` function to restore `currentTime` from state before playing:

```ts
const play = useCallback(async () => {
  ensureAudioGraph();
  const audio = audioRef.current!;
  if (audioContextRef.current?.state === 'suspended') {
    await audioContextRef.current.resume();
  }
  // Re-apply seek position — it may not have persisted if set before metadata loaded
  const intended = stateRef.current.currentTime;
  if (Math.abs(audio.currentTime - intended) > 0.5) {
    audio.currentTime = intended;
  }
  await audio.play();
  setState(prev => ({ ...prev, isPlaying: true }));
}, [ensureAudioGraph]);
```

Single file change, minimal risk.

