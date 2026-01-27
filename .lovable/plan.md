
Goal: Fix Android Chrome behavior where the user can scrub to a time while paused (before first Play), but pressing Play snaps audio back to 0:00 and ignores the chosen position.

What’s happening (root cause)
- The scrubber fix prevents “timeupdate” from overwriting state during a seek, so the UI can show the right time while paused.
- However, on Android Chrome, the first-time creation of the Web Audio graph (createMediaElementSource + connecting nodes) and/or the first call to audio.play() can asynchronously reset the underlying HTMLAudioElement playback position back to 0.
- Our current “restore seeked position” logic runs immediately after ensureAudioGraph(), but the reset can occur slightly later (after play starts / after internal buffering), so our correction is getting overwritten.

High-level solution
- Treat “seek before first play” as a pending seek that must be authoritatively applied at the moment playback begins.
- Make seeking deterministic by:
  1) waiting for metadata when needed,
  2) using the audio element’s native “seeked” event (not timeouts) to know when the seek truly applied,
  3) re-applying the desired currentTime after playback starts if the browser resets it.

Implementation plan (code changes)

1) Update `src/hooks/useAudioAnalyzer.ts` to use “pending seek” + “seeked-confirmed” logic
Add new refs:
- `pendingSeekTimeRef = useRef<number | null>(null)`  
  Stores the last user-requested seek time that must be honored, especially across “press Play” transitions.
- Replace the current timeout-based seeking unlock with event-based unlock:
  - keep `seekingRef` but clear it on `seeked` (with a small safety timeout fallback).

Add small helper promises (internal functions inside the hook):
- `waitForMetadata(audio): Promise<void>`
  - Resolves when `loadedmetadata` fires (or immediately if `readyState >= 1`).
- `seekTo(audio, time): Promise<void>`
  - Sets `seekingRef.current = true`
  - Sets `audio.currentTime = time`
  - Resolves on `seeked` (or times out after e.g. 500–1000ms to avoid hanging)
  - On resolve: `seekingRef.current = false` and clear `pendingSeekTimeRef` if it matches the requested time.

Modify `ensureAudioElement()`:
- Set `audio.preload = 'metadata'` to encourage metadata readiness on mobile.
- In `loadedmetadata` listener:
  - keep setting duration
  - if `pendingSeekTimeRef.current !== null`, call `seekTo(audio, pendingSeekTimeRef.current)` (fire-and-forget or awaited via an async IIFE) so that late metadata still results in correct position.

Modify `seek(time)`:
- Set `pendingSeekTimeRef.current = time` immediately (source of truth).
- Ensure audio element exists.
- Optimistically update React state `currentTime` immediately (keeps UI responsive).
- If metadata is ready: call `seekTo(audio, time)` (so the media element is actually moved).
- If metadata isn’t ready: call `audio.load()` (optional) and let `loadedmetadata` handler apply the pending seek.

2) Update `play()` in `src/hooks/useAudioAnalyzer.ts` to “enforce time” around playback start
Current code restores the time once before calling play. We’ll make it robust:

New play flow:
- `ensureAudioGraph()` (creates/attaches WebAudio graph)
- `const audio = ensureAudioElement()` (guarantee element)
- Determine target time:
  - `const targetTime = pendingSeekTimeRef.current ?? stateRef.current.currentTime;`
- `await waitForMetadata(audio)`
- If targetTime is meaningful (>= 0 and <= duration when known), run `await seekTo(audio, targetTime)` BEFORE starting playback.
- Resume AudioContext if suspended.
- `await audio.play()`

Post-play correction (the key Android Chrome fix):
- After playback begins, re-check whether the browser reset the time:
  - On the next tick(s) (e.g. `requestAnimationFrame` twice, or a short `setTimeout(0)` + rAF), compare `audio.currentTime` with `targetTime`.
  - If it drifted back near 0 (or differs > ~0.5s), call `seekTo(audio, targetTime)` again.
  - Do not pause; just re-seek while playing.

Why this works:
- If the reset happens after our initial pre-play seek, the post-play correction catches it and forces the media element back to the intended position.

3) Cleanup stability (prevents React “Should have a queue” during HMR/dev)
Right now, event listeners are anonymous and can’t be removed.
- Store event handlers in stable function references (e.g., define them once when creating the audio element, keep them in refs, and remove them in cleanup).
- In the unmount cleanup, remove `timeupdate`, `loadedmetadata`, `ended`, and any temporary `seeked` listeners created by `seekTo`.
This reduces the chance of stale listeners calling `setState` after a component is replaced by hot reload.

4) Minor UI tweak (optional, keep if it helps)
- Keep the 150ms delay in `AudioControls` (it’s harmless and improves UX), but after the hook fix it should no longer be required for correctness.
- If desired later, we can simplify scrubbing UI once the media element and hook are stable.

Testing checklist (Android Chrome stable focus)
1) Fresh load → scrub to 1:30 without ever pressing Play → press Play
   - Expected: audio starts at ~1:30, scrubber stays at ~1:30 and begins advancing.
2) While paused after playing once → scrub to 2:10 → press Play
   - Expected: starts at ~2:10.
3) While playing → scrub to a new time
   - Expected: jumps to new time and continues.
4) Edge cases:
   - scrub very close to 0 (0–1s): should still work, no jitter.
   - scrub near end: should play near end (and stop or loop depending on loop setting).

Files that will be modified
- `src/hooks/useAudioAnalyzer.ts` (main fix: pending seek + seeked event + post-play correction + listener cleanup)
- `src/components/player/AudioControls.tsx` (likely no further changes required; keep current delay unless we choose to simplify)

Expected outcome
- Seeking before first play will be honored.
- Pressing Play will no longer snap back to 0 on Android Chrome; if the browser tries to reset, we correct it immediately after playback starts.
