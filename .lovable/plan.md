
# Fix Time Scrubber Snapping to Beginning

## Problem
The time scrubber snaps back to `0:00` when released, especially noticeable when:
- You haven't pressed Play yet (audio element not initialized)
- The audio is paused

**Root Cause**: When seeking before the audio has been played, the `seek()` function creates the `HTMLAudioElement` for the first time. The browser fires a `timeupdate` event with `currentTime = 0` before the seek value takes effect. This races with the 50ms delay in `AudioControls`, causing the slider to snap back to 0.

## Solution
Prevent the `timeupdate` event listener from overwriting the seek value while a seek operation is in progress.

### Approach
Add a "seeking" flag in the `useAudioAnalyzer` hook that temporarily blocks `timeupdate` events from updating state. This ensures the React state reflects the intended seek position, not a stale browser value.

## Implementation Details

### File 1: `src/hooks/useAudioAnalyzer.ts`

Add a `seekingRef` to track when a seek is in progress:

```text
Changes:
1. Add a new ref: `const seekingRef = useRef(false);`
2. In the `timeupdate` event listener, check `if (!seekingRef.current)` before updating state
3. In the `seek()` function:
   - Set `seekingRef.current = true` before setting `audio.currentTime`
   - Use a small timeout (100ms) to reset it, or listen for the `seeked` event
```

**Modified `ensureAudioElement` (timeupdate listener):**
```tsx
audio.addEventListener('timeupdate', () => {
  // Don't update if we're in the middle of a seek operation
  if (!seekingRef.current) {
    setState(prev => ({ ...prev, currentTime: audio.currentTime }));
  }
});
```

**Modified `seek` function:**
```tsx
const seek = useCallback((time: number) => {
  const audio = ensureAudioElement();
  seekingRef.current = true;
  audio.currentTime = time;
  setState(prev => ({ ...prev, currentTime: time }));
  
  // Reset seeking flag after browser has processed the seek
  setTimeout(() => {
    seekingRef.current = false;
  }, 100);
}, [ensureAudioElement]);
```

### File 2: `src/components/player/AudioControls.tsx`

Increase the timeout from 50ms to 150ms to give more margin for the seek to fully propagate:

```tsx
onValueCommit={([value]) => {
  onSeek(value);
  setScrubTime(value);
  // Longer delay to ensure seek propagates fully
  setTimeout(() => setIsScrubbing(false), 150);
}}
```

## Why This Works

```text
User drags scrubber to 1:30 → releases

┌─────────────────────────────────────────────────────────┐
│ Before Fix                                              │
├─────────────────────────────────────────────────────────┤
│ 1. onSeek(90) called                                    │
│ 2. seek() creates audio element (if first time)         │
│ 3. audio.currentTime = 90                               │
│ 4. Browser fires timeupdate with currentTime = 0        │
│ 5. setState({ currentTime: 0 })  ← PROBLEM!             │
│ 6. 50ms later: isScrubbing = false                      │
│ 7. Slider reads currentTime = 0, snaps back             │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ After Fix                                               │
├─────────────────────────────────────────────────────────┤
│ 1. onSeek(90) called                                    │
│ 2. seek() sets seekingRef = true                        │
│ 3. seek() creates audio element (if first time)         │
│ 4. audio.currentTime = 90                               │
│ 5. setState({ currentTime: 90 })                        │
│ 6. Browser fires timeupdate with currentTime = 0        │
│ 7. timeupdate blocked by seekingRef ← FIXED!            │
│ 8. 100ms later: seekingRef = false                      │
│ 9. 150ms later: isScrubbing = false                     │
│ 10. Slider reads currentTime = 90, stays put            │
└─────────────────────────────────────────────────────────┘
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useAudioAnalyzer.ts` | Add `seekingRef`, guard `timeupdate` listener, update `seek()` function |
| `src/components/player/AudioControls.tsx` | Increase timeout from 50ms to 150ms |

## Testing Checklist
- Scrub before ever pressing Play → should stay at scrubbed position
- Scrub while paused → should stay at scrubbed position
- Scrub while playing → should continue from scrubbed position
- Volume slider should still work normally (unaffected)
