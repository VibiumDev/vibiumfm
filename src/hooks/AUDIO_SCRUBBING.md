# Audio Scrubbing & Seek Reconciliation

> **Why this document exists**: The audio scrubber took many iterations to get
> working reliably across browsers. The core problem is a Chrome-specific
> behavior where `audio.currentTime` assignments are silently discarded during
> playback transitions. This doc explains the full system so future developers
> (human or AI) can modify it safely.

---

## Architecture Overview

The scrubbing system spans two files:

| File | Role |
|---|---|
| `src/hooks/useAudioAnalyzer.ts` | All audio state, seeking logic, and browser reconciliation |
| `src/components/player/AudioControls.tsx` | Stateless UI — renders a Radix `<Slider>` bound to `currentTime` from the hook |

`AudioControls` has **no local scrub state**. It calls `onSeek(time)` on every
slider change and commit. All intelligence lives in the hook.

---

## The Two Sources of Time

There are always two "current times" in play:

1. **`audio.currentTime`** — the browser's actual media engine position.
2. **`state.currentTime`** — the React state that drives the slider UI.

The scrubber bug was caused by these two diverging: the user drags to 1:30,
React shows 1:30, but when play starts Chrome's media engine is actually at
0:00 and `timeupdate` events overwrite React state back to 0:00.

---

## The Chrome Bug (Root Cause)

Safari and Chrome handle `audio.currentTime = X` differently:

### Safari
- Honors `currentTime` assignments at any time, including while paused.
- The assigned value survives the `pause → play()` transition.
- `seeked` event reliably means "I am now at position X."

### Chrome
- Accepts the `currentTime` assignment and fires `seeked`.
- **But then resets `currentTime` back to 0** (or the previous position) when
  `play()` actually engages the media pipeline.
- The `seeked` event is misleading — it means "I processed the request" not
  "playback will start here."
- After `play()`, the first several `timeupdate` events may report the OLD
  position before the seek takes effect.

This means any code that:
1. Sets `audio.currentTime = target`
2. Assumes it worked
3. Clears the pending seek state

...will break in Chrome because the media engine silently reverts.

---

## Solution: Reconciled Seek with Confirmation

### Three Refs

```
desiredTimeRef          — The time the user wants (set on scrub)
awaitingPlaybackSeekRef — Whether we're waiting for Chrome to confirm the seek
seekRetryCountRef       — Safety counter to prevent infinite retry loops
```

### State Machine

```
                    seek(t) while paused
    ┌────────┐  ──────────────────────────►  ┌───────────────┐
    │  IDLE  │                               │  DESIRED_SET  │
    │  d=null│                               │  d=t          │
    │  a=F   │                               │  a=false      │
    └────────┘                               └───────┬───────┘
         ▲                                           │ play()
         │                                           ▼
         │ confirmed                         ┌───────────────┐
         │ |pos - t| < 0.5s                  │   AWAITING    │
         └───────────────────────────────────│  d=t          │
                                             │  a=true       │
                                             │  retries ≤ 8  │
                                             └───────────────┘

    seek(t) while playing → same as above but skips DESIRED_SET,
                            goes straight to AWAITING
```

### Key: `d` = `desiredTimeRef`, `a` = `awaitingPlaybackSeekRef`

---

## How Each Function Works

### `seek(time)` — called by the slider on every drag/commit

```
1. Set React state.currentTime = time  (instant UI feedback)

2. If currently playing:
     - Set audio.currentTime = time    (tell browser to seek)
     - Set desiredTimeRef = time       (remember the target)
     - Set awaitingPlaybackSeekRef = true
     - Chrome will confirm via timeupdate later

3. If paused:
     - Set desiredTimeRef = time       (defer actual seek)
     - awaitingPlaybackSeekRef = false (not awaiting yet — play() will set it)
     - Do NOT touch audio.currentTime  (Chrome would ignore it anyway)
```

### `play()` — called when user presses play

```
1. Ensure audio graph (AudioContext, AnalyserNode, etc.)
2. Resume AudioContext if suspended (required after user gesture)

3. If desiredTimeRef has a value:
     - Set audio.currentTime = target  (first attempt)
     - Set awaitingPlaybackSeekRef = true
     - Set React state to target       (keep UI pinned)

4. await audio.play()

5. Set isPlaying = true

6. Post-play check (requestAnimationFrame):
     - If audio.currentTime is NOT near target, force it again
     - This catches Chrome's "I reset your seek on play()" behavior
```

### `handleTimeUpdate` — fires ~4x/sec during playback

```
1. If desiredTimeRef is set AND awaiting confirmation:
     a. If audio.currentTime is within 0.5s of target:
          → CONFIRMED. Clear all pending state. Use audio.currentTime.
     b. Else if retries < 8:
          → Force audio.currentTime = target again. Keep UI at target.
     c. Else (retries exhausted):
          → Give up. Clear pending state. Accept audio.currentTime.

2. If desiredTimeRef is set but NOT awaiting (paused scrub):
     → Keep UI showing desiredTimeRef. Ignore audio.currentTime.

3. If desiredTimeRef is null (normal playback):
     → Update UI from audio.currentTime as usual.
```

### `handlePlaying` — fires when media engine actually starts producing audio

```
1. If desiredTimeRef is set:
     - Enter AWAITING state
     - If audio.currentTime is wrong, force seek again
     - Keep UI at target

This is the most critical handler for Chrome. It catches the case where
play() accepted the seek but the media engine started from 0 anyway.
```

### `handleSeeked` — fires when browser processes a seek

```
- Does NOT clear desiredTimeRef (this was the original bug!)
- Only updates UI to show the desired position if not already awaiting
- In Chrome, this event is unreliable as confirmation
```

### `handleSeeking` — fires when browser begins processing a seek

```
- If we have a desired time and are playing, enter AWAITING state
- This ensures the guard is up before timeupdate can push stale values
```

---

## Why Each Design Decision Matters

| Decision | Reason |
|---|---|
| Never clear `desiredTimeRef` in `seeked` | Chrome fires `seeked` then resets position on `play()` |
| Keep UI at `desiredTimeRef` while pending | Prevents slider from flickering to 0:00 and back |
| Re-force seek in `playing` event | Catches Chrome's post-play() position reset |
| Re-force seek in `requestAnimationFrame` after `play()` | Belt-and-suspenders for the race condition |
| Re-force seek in `timeupdate` with retry limit | Handles cases where even the `playing` re-seek is ignored |
| 8-retry limit | Prevents infinite loops if the audio source can't seek to that position |
| 0.5s tolerance | Media engines don't seek to exact sample boundaries; need wiggle room |
| `stateRef` mirror of React state | Event handlers are closures created once; need current state without re-creating listeners |

---

## Mobile Touch Considerations

The Radix `<Slider>` in `AudioControls` uses:
- `touch-none` CSS to prevent browser gesture interference
- An enlarged invisible touch target (`before:-inset-3`) on the thumb for fat-finger reliability
- No local drag state — every touch movement calls `onSeek()` immediately

---

## Testing Checklist

**Must test in Chrome** (Safari masks the bug by being more permissive).

| # | Scenario | Expected |
|---|---|---|
| 1 | Scrub while paused → press play | Starts from scrubbed position |
| 2 | Scrub while playing | Seeks without snapping back |
| 3 | Scrub to 0:00 while paused → play | Starts from beginning |
| 4 | Rapid successive scrubs while playing | Lands on last position |
| 5 | Let track end → scrub → play | Works from new position |
| 6 | Test on mobile Chrome | Same engine, same bug potential |
| 7 | Scrub near end of track while playing | Doesn't trigger false "ended" |

---

## Common Mistakes to Avoid

1. **Don't add local scrub state to AudioControls** — the reconciliation must
   happen in the hook, not the UI layer. Two sources of truth = two bugs.

2. **Don't trust `seeked` for anything important** — use it for minor UI hints
   at most.

3. **Don't remove the retry logic** — it looks aggressive but it's the only
   thing that works across Chrome's async media pipeline.

4. **Don't set `audio.currentTime` while paused and expect it to stick** —
   Chrome may discard it on `play()`. Always re-apply after play.

5. **Don't remove `handlePlaying`** — it's the primary Chrome fix. Without it,
   paused scrub → play will snap to 0:00.
