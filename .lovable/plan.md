

## Problem Diagnosis

The scrubber snaps back to 0 because:

1. `seek()` sets `seekingRef = true` (guards against `timeupdate` overwriting state) but the guard expires after **150ms**
2. After 150ms, `handleTimeUpdate` fires with `audio.currentTime` which is still **0** — because Chrome silently fails to seek on an unplayed/unbuffered audio element
3. That 0 gets pushed into React state, overwriting the scrubbed position
4. In AudioControls, the `scrubValue` cleanup effect doesn't match (scrubValue=30 vs currentTime=0), so eventually the slider shows 0

The "play is broken after scrubbing" issue: `applyPendingSeek` awaits metadata/canplay events that may never fire (audio already loaded), or the seek still fails because Chrome won't seek to unbuffered regions without active playback.

## Solution: Deferred Seek Architecture

Stop trying to seek the actual `<audio>` element while paused. Instead, just remember the intended position and apply it only when play starts.

### Changes to `useAudioAnalyzer.ts`

1. **Remove `applyPendingSeek` entirely** — it's overcomplicated and the async awaits cause race conditions
2. **Simplify `seek()`**: Just store the target in `pendingSeekRef` and update `currentTime` in state. Don't touch `audio.currentTime` at all if paused.
3. **Simplify `play()`**: Before calling `audio.play()`, set `audio.currentTime = pendingSeekRef.current` synchronously (audio is loaded by this point due to `preload="auto"`). Clear the ref.
4. **Fix `handleTimeUpdate`**: If `pendingSeekRef.current` is set, ignore timeupdate events (don't overwrite the user's chosen position). Remove the 150ms timeout guard entirely.
5. **When playing and user seeks**: Set `audio.currentTime` directly (works fine since audio is actively buffering during playback). Keep `pendingSeekRef` as backup.

### Changes to `AudioControls.tsx`

6. **Remove the `scrubValue` state and effect entirely** — the parent's `currentTime` will now stay correct because we won't let `handleTimeUpdate` overwrite it while a seek is pending. The slider just uses `currentTime` directly.
7. **`onValueChange`**: Call `onSeek(value)` 
8. **`onValueCommit`**: Call `onSeek(value)` (same — the deferred logic lives in the hook)

### Result

- Dragging while paused: slider stays where you put it, audio seeks on play
- Dragging while playing: audio seeks immediately (already buffering)
- No async race conditions, no timeout guards, no snap-back

