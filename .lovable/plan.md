
Root cause is most likely not the paused scrub itself anymore. The current deferred-seek logic is still fragile because it waits for `seeked` to clear `pendingSeekRef`, but Chrome can fail to emit `seeked` reliably in this sequence or emit time/progress events in an order that leaves React state out of sync. The result is: UI shows the scrubbed value while paused, then `play()` starts from the real media position (still 0), and the slider follows playback from 0.

What I would change

1. Make the audio element the source of truth once play starts
- In `play()`, if `pendingSeekRef.current` exists, set `audio.currentTime` to that value and immediately sync React state to that same value.
- Do not rely only on `seeked` to keep state correct.

2. Add explicit playback-start reconciliation
- After `audio.play()`, compare `audio.currentTime` with the pending target.
- If Chrome ignored the seek and `audio.currentTime` is still near 0, retry the seek once after playback has actually begun (for example on `playing` or first `timeupdate`).
- Only clear `pendingSeekRef` after the element is confirmed near the requested time.

3. Track “desired time” separately from “actual media time”
- Keep a `desiredTimeRef` or reuse `pendingSeekRef` as the requested scrub position.
- While paused, slider uses the desired value.
- Once playback is confirmed at the requested position, resume normal time updates from the element.

4. Handle the Chrome-specific failure mode
- If paused seeking is ignored before playback, use this sequence:
  - set `audio.currentTime = target`
  - call `audio.play()`
  - on `playing`, set `audio.currentTime = target` again
- This is the most likely fix for “click play -> snaps to 0 and starts playing”.

5. Tighten event handling in `useAudioAnalyzer.ts`
- Add listeners for `seeking`, `seeked`, and `playing`.
- `timeupdate` should not overwrite `currentTime` while there is an unresolved desired seek target.
- When resolved, update state from `audio.currentTime` and clear the pending target.

6. Keep `AudioControls.tsx` simple
- The controls file is fine conceptually: slider should keep calling `onSeek` on drag and commit.
- No extra local scrub state unless needed for drag UX; the bug is in media-state reconciliation, not the slider component now.

7. Fix the ref warnings separately
- `AudioControls` is being passed a ref somewhere through composition, and `BarGrid` is also triggering a ref warning from React Three Fiber.
- These warnings probably are not the direct cause of the scrubber bug, but they should be cleaned up because they indicate component contract issues and make debugging harder.
- Likely fix: convert components that receive refs indirectly to `forwardRef`, or stop passing refs to plain function components.

Files to update
- `src/hooks/useAudioAnalyzer.ts` — main fix
- `src/components/player/AudioControls.tsx` — likely minimal/no logic change
- Optionally:
  - `src/components/visualizer/Visualizer.tsx`
  - `src/components/visualizer/Scene.tsx`
  - `src/components/visualizer/BarGrid.tsx`
  for the ref-warning cleanup

Implementation outline
```text
seek(time):
  set UI currentTime = time
  if playing:
    audio.currentTime = time
    pendingSeekRef = null
  else:
    pendingSeekRef = time

play():
  ensure graph
  target = pendingSeekRef
  if target != null:
    audio.currentTime = target
    set UI currentTime = target

  await audio.play()
  set isPlaying = true

  if target != null:
    when playing/first timeupdate:
      if audio.currentTime is not close to target:
        audio.currentTime = target
      if audio.currentTime is close to target:
        pendingSeekRef = null
        set UI currentTime = audio.currentTime
```

Expected result
- Scrub while paused: thumb stays where selected
- Press play: playback starts from the scrubbed timestamp instead of 0
- Scrub while playing: seeks immediately and keeps tracking correctly

Technical note
The current bug strongly suggests “requested seek time” and “actual media playback position” are being conflated too early. The fix is to explicitly reconcile them after playback really starts, instead of assuming `currentTime = target` succeeded just because the assignment ran.
