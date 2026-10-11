# M5 · Live wiring + Lead sheet

**Status:** done · 2026-10-11 · **Next:** M5b
**Commit:** see `git log` for "S5|M5:" (pushed to origin/main)

## Goal of this stage
Stand follows whatever Spotify plays (SpotifyClock → screens, timelines fetched and cached by track ID, the 4 sync states and the
empty state), the landscape lead sheet with tap-to-seek, and calibration. Added by the user: analyse a track from the phone, a
redesigned landscape play panel (Now/Next staves), and an instrument switch on both Stand screens.

## Decisions
- D-46 analysis queue (phone → Worker → `mqc watch`, only while Spotify is idle) · D-47 new milestone M5b Playlist inbox
- D-48 new milestone M9 Melody + Solo view · D-49 spotify/manual drivers · D-50 sync badge rules (no freeze while re-syncing)
- D-51 tap-along calibration · D-52 landscape lead sheet + Now/Next play panel, instrument switch · D-53 live e2e method, fit test

## Built
- `apps/web/src/services.ts` — `Transport` (spotify | manual): toggle, seek, duration; `follow()` on lock/track/play; idle → hold
  on the manual clock; background refresh of cached timelines; session saved for either driver; wake lock follows the active clock
- `apps/web/src/clock/sync.ts` (+ `sync.test.ts`) — `syncState()`; `SpotifyClock` gained `lastOkAt` and `quality()`
- `apps/web/src/clock/calibrate.ts` — `fitTaps()`, `nearestBeat()`; `clock/offsets.ts` now in memory + device names + `clearOffset`
- `apps/web/src/ui/stand/live.ts` — `useMoment` on the active transport, `frameBus` (per-frame refs), `useSync`, `useLandscape`
- `apps/web/src/ui/stand/Stand.tsx` — header on the active transport, `LiveSyncBadge` (tap → calibrate or log in), not-analysed
  and nothing-playing states; Spotify seek on slider release
- `apps/web/src/ui/stand/LeadSheet.tsx` + `sheet.ts` (+ test) — landscape chart and play panel; `next.ts` (+ test) — next change of notes
- `apps/web/src/ui/stand/Calibrate.tsx` — tap pad, Apply, Earlier/Later/Reset; `InstrumentSeg.tsx` — Concert/Alto/Tenor
- `apps/web/src/ui/stand/play.ts` — `playView(m, mode, { preview: false })` keeps Now on the current key
- `apps/web/src/timeline/queue.ts`, `ui/AnalyseButton.tsx` — "Analyse on the PC" on the not-analysed screen and in Tracks
- `apps/web/src/ui/settings/Settings.tsx` — Speakers card (offsets per device), "Next scale (landscape)" setting
- `apps/worker/src/index.ts` (+ tests) — `/api/queue` (list, secret), `/api/queue/:id` (GET public; POST with `X-Spotify-Token`
  checked against `ALLOWED_SPOTIFY_USERS` in `wrangler.toml`; PUT/DELETE secret); a timeline PUT clears its request
- `companion/src/mqc/watch.py` (+ `tests/test_watch.py`) — `mqc watch [--idle-minutes 10] [--interval 60] [--once]`, `mqc queue`
- `apps/web/e2e/live.e2e.ts` — fake Spotify player: follow, sync states, seek, not analysed + queue, empty state, landscape, calibrate
- `handoffs/02-dev-plan.md` — new rows M5b (playlist inbox) and M9 (melody + Solo view), spike SP9, melody risk

## Verified
- `pnpm test` → 1082 passed · `pnpm lint`, `pnpm typecheck` clean · companion `pytest tests/test_watch.py` → 3 passed
- `pnpm e2e` → 15 passed (WebKit, 402×778 and 874×402): 5 live tests with a mocked `/me/player`, the 8 M4 tests, landscape Now/Next,
  and "portrait Stand fits without scrolling in every Play mode"
- Deployed queue: no token → 401, the user's Spotify token → 201; a new request reached `GET /api/queue` after ~15 s (KV is
  eventually consistent), a deleted one read 404 after the same delay
- iPhone, live (remote log, builds `4f7d102`–`e1fbd80`): 28 tracks followed from Spotify (7 with chords: 4 from the phone's cache,
  3 from the store; 21 not analysed); play/pause/seek commands all 200; 82 of 91 perf windows with no frame over 50 ms, 9 with one;
  1 failed poll ("Load failed"), recovered. 3 tracks queued from the phone; the PC analysed and uploaded 2 (Jason's Song, Stiletto)
- User looked at landscape after the redesign: "looks great". Screenshots checked in Stage and Paper, Simple/Integrated/Advanced,
  Staff/Keys, with the iPhone's landscape safe areas simulated (62 px sides, 21 px bottom)

## Open
- [ ] user: the exit criterion "stays on the right chord for a whole tune on the Fire TV (≤ 1 visible lag per chorus)" was not
      reported explicitly, and the log has no calibration. Play Let It Be on the Fire TV, calibrate once from the sync badge, and say
      if the chords feel early or late; also from the PC, and in airplane mode with a cached track
- [ ] user: "What Is Hip?" is still queued; run `pnpm companion watch` on the PC (it waits for 10 min of Spotify idle)
- [ ] `mqc watch` leaves the PC as Spotify's active device after a capture; pick the Fire TV again in Spotify Connect
- [ ] queue status on the phone can lag ~15–60 s behind (KV); "Check again" re-fetches
- [ ] portrait has no Next staff (it would push past the screen); a one-line "Next" could go in if wanted
- [ ] Integrated in portrait still previews the new key in the last 4 beats; landscape doesn't (Next staff shows it)
- [ ] no live chord fallback for unanalysed tracks until M7; M5b makes analysing them easy
- [ ] carried: P-05 sections (deferred to M7/M8), P-06 key regions; Paper status-bar strip on the phone; repo not Prettier-clean

## Skip
- `apps/web/src/ui/settings/Diagnostics.tsx`, `apps/web/src/probe/*` — M1 tools, unchanged
- `apps/web/e2e/fixtures/*.json` — data · `design/sketchbook.html` — the landscape panel now departs from it by design (D-52)
- `apps/web/src/ui/stand/Staff.tsx`, `Keyboard.tsx` — unchanged renderers

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/M5-live.md, then the M5b row in handoffs/02-dev-plan.md. Then do M5b:
a Spotify playlist inbox. Adding a song to it queues it for analysis (mqc watch checks the playlist's snapshot_id, D-35 quota
care), analysed songs stay in it, and Tracks on the phone lists it with each song's state. Use the M5 queue (D-46).
```
