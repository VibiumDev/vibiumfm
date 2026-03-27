
Diagnosis

This is happening because Safari and Chrome do not treat pre-play seeks the same way, and the current hook assumes they do.

Why Safari works
- Safari is more permissive about keeping a `currentTime` assignment that happens before playback is fully established.
- So your paused scrub target survives the transition into playback.

Why Chrome fails
- Chrome can temporarily accept `audio.currentTime = target`, fire `seeked`, and then still begin actual playback from 0 once `play()` starts.
- In this hook, `handleSeeked` clears `pendingSeekRef` too early:
  - paused scrub stores target
  - `play()` sets `audio.currentTime = target`
  - Chrome may emit `seeked`
  - `handleSeeked` clears `pendingSeekRef`
  - playback then starts from real media position 0
  - `timeupdate` now trusts the audio element and pushes 0 into React state
- So the bug is not the slider. It is the hook clearing “desired seek” before Chrome has proven playback really started at that position.

What to change

1. Stop treating `seeked` as confirmation
- Do not clear `pendingSeekRef` in `handleSeeked` during paused-to-play transition.
- `seeked` only means the element processed a seek request, not that playback has stabilized there in Chrome.

2. Separate desired time from confirmed playback time
- Keep a ref for the user’s intended scrub position.
- While paused, UI should continue showing that desired position.
- Only switch back to audio-element-driven time after playback is confirmed near the target.

3. Confirm the seek only after playback actually starts
- In `play()`, apply the target before play.
- Then re-apply it again on `playing` or first `timeupdate`.
- Clear the pending target only when `audio.currentTime` is actually within tolerance while playing.

4. Guard `timeupdate`
- While a desired seek is unresolved, `timeupdate` must not overwrite state with 0 or near-0 values.
- If Chrome starts from 0, immediately force `audio.currentTime = target` again instead of accepting the event.

5. Add a small playback-confirmation state
- Example: `awaitingPlaybackSeekRef` or `pendingSeekPhaseRef`
- States:
  - paused target chosen
  - play requested
  - playback started but not confirmed
  - playback confirmed at target
- This avoids one ref trying to represent too many meanings.

Implementation plan

- Update `src/hooks/useAudioAnalyzer.ts`
  - remove or gate the current `handleSeeked` clearing logic
  - add a dedicated “awaiting playback confirmation” ref
  - keep paused seeks purely in React/ref state
  - in `play()`, set `audio.currentTime = target`, then after `play()` and on `playing`, reapply if Chrome reset it
  - in `timeupdate`, ignore/reset early 0-values until target is confirmed

- Keep `src/components/player/AudioControls.tsx` unchanged
  - it is already correctly using `currentTime` as the source of truth

Technical details

```text
seek(time):
  set state.currentTime = time
  if paused:
    desiredTimeRef = time
    awaitingPlaybackSeekRef = true
  else:
    audio.currentTime = time
    desiredTimeRef = null
    awaitingPlaybackSeekRef = false

play():
  target = desiredTimeRef
  if target != null:
    audio.currentTime = target
    set state.currentTime = target

  await audio.play()
  set isPlaying = true

on playing / first timeupdate:
  if awaitingPlaybackSeekRef and target != null:
    if abs(audio.currentTime - target) > tolerance:
      audio.currentTime = target
      keep UI at target
    else:
      clear desired/pending refs
      sync UI from audio.currentTime
```

Expected result
- Paused scrub stays where selected
- Pressing play in Chrome starts from the scrubbed time instead of snapping to 0
- Safari behavior remains correct
- The hook becomes browser-safe instead of depending on Safari-friendly event ordering
