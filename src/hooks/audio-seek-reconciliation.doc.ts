/**
 * Chrome Audio Seek Reconciliation — Bug Documentation
 * ====================================================
 *
 * This documents a critical cross-browser bug in HTMLAudioElement seeking
 * that took multiple iterations to fix. Preserved here so future developers
 * don't repeat the investigation.
 *
 * ## The Bug
 *
 * When a user scrubs the audio slider to a new position (while paused OR
 * while playing) and then plays/releases, Chrome snaps playback back to
 * 0:00 instead of starting from the scrubbed position. Safari works fine.
 *
 * ## Root Cause
 *
 * Chrome and Safari handle `audio.currentTime = X` differently:
 *
 * - **Safari**: Honors a `currentTime` assignment even before `play()` is
 *   called. The seek "sticks" through the paused→playing transition.
 *
 * - **Chrome**: Accepts the assignment, fires `seeked`, but then **resets
 *   `currentTime` back to 0** (or the previous position) once `play()`
 *   actually starts the media pipeline. The `seeked` event is a lie —
 *   it means "I processed the request" not "playback will start here."
 *
 * This also affects seeking while playing: Chrome fires `timeupdate` with
 * the OLD position one or more times after `audio.currentTime = X` is set,
 * before the seek actually takes effect in the media engine.
 *
 * ## Why Naive Fixes Fail
 *
 * 1. **Setting `currentTime` before `play()`** — Chrome ignores it.
 * 2. **Clearing pending seek on `seeked` event** — Chrome fires `seeked`
 *    but then resets the position anyway when playback begins.
 * 3. **Setting `currentTime` once after `play()`** — Chrome may still
 *    emit `timeupdate` events with position 0 before the seek registers.
 * 4. **Trusting `timeupdate` values immediately** — The first several
 *    `timeupdate` events after play/seek report the wrong position.
 *
 * ## The Fix: Reconciled Playback Architecture
 *
 * The solution uses three refs to track seek state:
 *
 * - `desiredTimeRef`: The time the user wants. Set on scrub, cleared only
 *   after the audio element proves it's actually playing near that time.
 *
 * - `awaitingPlaybackSeekRef`: A flag indicating we're in the
 *   "seek requested but not yet confirmed" phase. While true, all
 *   `timeupdate` values that don't match the target are rejected and the
 *   seek is re-applied.
 *
 * - `seekRetryCountRef`: Safety valve to prevent infinite retry loops
 *   (limit: 8 retries).
 *
 * ### State Machine
 *
 * ```
 * ┌─────────────┐   seek(t) while paused    ┌──────────────────┐
 * │   IDLE       │ ────────────────────────► │ DESIRED_SET       │
 * │ desired=null │                           │ desired=t         │
 * │ awaiting=F   │                           │ awaiting=false    │
 * └─────────────┘                            └──────┬───────────┘
 *                                                   │ play()
 *                                                   ▼
 *                                            ┌──────────────────┐
 *                                            │ AWAITING_CONFIRM  │
 *                                            │ desired=t         │
 *                                            │ awaiting=true     │
 *                                            │ audio.currentTime │
 *                                            │   forced to t     │
 *                                            └──────┬───────────┘
 *                                                   │ timeupdate/playing
 *                                                   │ confirms |pos - t| < 0.5s
 *                                                   ▼
 *                                            ┌──────────────────┐
 *                                            │ CONFIRMED         │
 *                                            │ desired=null      │
 *                                            │ awaiting=false    │
 *                                            │ normal tracking   │
 *                                            └──────────────────┘
 * ```
 *
 * The same flow applies to seeking while playing — `desiredTimeRef` is
 * kept set and `awaitingPlaybackSeekRef` is true until Chrome's
 * `timeupdate` reports a position within tolerance of the target.
 *
 * ### Key Rules
 *
 * 1. **Never clear `desiredTimeRef` in `seeked`** — it's unreliable.
 * 2. **Never trust `timeupdate` while awaiting** — reject values that
 *    don't match the target and re-force `audio.currentTime`.
 * 3. **Re-apply the seek in `playing`** — Chrome resets position on play.
 * 4. **Re-apply in `requestAnimationFrame` after `play()`** — belt and
 *    suspenders for the Chrome race condition.
 * 5. **UI always shows `desiredTimeRef` while pending** — prevents the
 *    slider from flickering to 0 and back.
 *
 * ## Files Involved
 *
 * - `src/hooks/useAudioAnalyzer.ts` — All reconciliation logic lives here.
 * - `src/components/player/AudioControls.tsx` — Stateless; uses
 *   `currentTime` from state as single source of truth. No local scrub
 *   state needed.
 *
 * ## Testing
 *
 * Must test in Chrome specifically (Safari masks the bug). Test matrix:
 *
 * 1. Scrub while paused → press play → should start from scrubbed position
 * 2. Scrub while playing → should seek without snapping back
 * 3. Scrub to 0:00 while paused → play → should start from beginning
 * 4. Rapid successive scrubs while playing → should land on last position
 * 5. Let track end → scrub → play → should work from new position
 * 6. Test on mobile Chrome (same engine, same bug)
 */
export {};
