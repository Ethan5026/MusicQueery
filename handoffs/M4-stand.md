# M4 · App shell + Stand

**Status:** done · 2026-10-11 · **Next:** M5
**Commit:** see `git log` for "S4|M4:" (pushed to origin/main)

## Goal of this stage
The app shell (5 tabs, Stage/Paper tokens, fonts, Settings, IndexedDB, offline) and the portrait Stand from the sketch,
running on a recorded timeline under a `ManualClock`, with the demo chart and a real analysed pop timeline (Let It Be).

## Decisions
- D-41 shell: tabs, themes, bundled fonts, IndexedDB stores, session restore · D-42 Play modes Simple / Integrated / Advanced
- D-43 Tracks → Recorded (no store listing on the phone) · D-44 render budget + perf monitor · D-45 e2e offline method

## Built
- `apps/web/src/clock/ManualClock.ts` — Clock impl: load/play/pause/seek, stops at the end (+ tests)
- `apps/web/src/store/idb.ts` — IndexedDB `musicqueery` v1: `settings` (prefs, session), `timelines`, `tracks` (titles)
- `apps/web/src/store/settings.ts` — instrument, lens, Staff/Keys, theme, Play mode; `applyTheme` (data-theme + theme-color)
- `apps/web/src/timeline/library.ts` — demo timeline (built on device), `loadTimeline` (IDB → store → IDB), `trackMeta`
  (IDB → Spotify `/tracks/{id}` → seeds), `parseTrackRef` (links, URIs, IDs), `recordedList`
- `apps/web/src/services.ts` — `manual` clock, `useSession` (tab via `#hash`, open timeline), `restoreSession`, wake lock on play
- `apps/web/src/ui/Shell.tsx` — 5 tabs; Map and Coach are "Soon" placeholders (M8)
- `apps/web/src/ui/stand/Stand.tsx` — the portrait Stand: header (art tile = play/pause), progress/seek, chips (Home, Now,
  BPM, meter + style), hero chord, Up next ×4, Key change, Play card. `useMoment` recomputes per beat/chord change
- `apps/web/src/ui/stand/play.ts` — Play-card model per mode (D-42) (+ `play.test.ts`); `view.ts` — home key, tempo, bar
  and section labels (+ `view.test.ts`)
- `apps/web/src/ui/stand/Staff.tsx`, `Keyboard.tsx` — ports of the sketch's `staffSVG()` / `kb()`, notes carry roles
- `apps/web/src/ui/atoms.tsx` — `Acc`, `ChordSym`, `SourceBadge`, `SyncBadge`, `Seg`, tab icons
- `apps/web/src/ui/tracks/Tracks.tsx` — Recorded list + "open an analysed Spotify track" box
- `apps/web/src/ui/settings/Settings.tsx` — settings, Spotify login, storage, perf line; `Diagnostics.tsx` = the M1 cards
- `apps/web/src/ui/app.css` (tokens + components from the sketch), `ui/fonts.ts` (@fontsource latin subsets)
- `apps/web/src/perf.ts` — frame-gap / long-task monitor, `perf.window` to the remote log every 30 s
- `apps/web/e2e/smoke.e2e.ts`, `playwright.config.ts`, `e2e/fixtures/let-it-be.timeline.json` — `pnpm e2e`
- `spotify/api.ts` `fetchTrack`; `timeline/fetch.ts` `fetchTimelineById`; Eruda kept out of the precache (675 KB precache)

## Verified
- `pnpm test` → 1066 passed · `pnpm lint`, `pnpm typecheck` clean
- `pnpm e2e` (Playwright 1.63 WebKit, 402×778 = iPhone 17 minus safe areas) → 8 passed: boot + sketch frame (Cmaj7, Bar 7 / 36,
  A1 · ch 2, E♭ callout), play/pause, alto/tenor transposition, Let It Be from the (mocked) store, missing track message,
  modes + persistence, settings persist + Paper, offline (server stopped: Let It Be restored, all 5 font families loaded)
- iPhone (user, 2026-10-11, build `23085f4`): **0 frames over 50 ms in 2 min** of demo playback; airplane mode: app reopened
  on the last track (paused, as designed); **portrait Stand approved** next to the sketch (after the modes were added, `27057c8`)
- Screenshots compared with the sketch in both themes; Stand fits 729 pt of usable height without scrolling

## Open
- [ ] M5: landscape is the portrait Stand stretched; the user noticed. The lead sheet + rail is M5's job (user agreed to keep it there)
- [ ] M5: there is no sound. Stand follows Spotify in M5 (SpotifyClock → `useMoment`; `Stand` reads `manual` directly today,
      so generalise to "the active clock"); the band is M6. The user asked about this
- [ ] M5: sync badge only shows Manual/Paused; wire the 4 sync states (D-04/sketch) and the "Recorded · manual clock" subtitle
- [ ] M5: `trackMeta` needs Spotify login for titles of new tracks; with playback it comes from `/me/player` anyway
- [ ] user: Integrated is the default Play mode; Simple shows natural minor for minor keys (no harmonic/melodic choice yet)
- [ ] not built from the sketch's Settings card: chord style (maj7/m7 vs Δ/–), look-ahead count, backing band (M6)
- [ ] Paper theme paints the status-bar area ink-dark (iOS standalone text is always white); check it on the phone
- [ ] repo is not Prettier-clean (36 files, many pre-M4); `pnpm format` would touch unrelated files, so left alone
- [ ] from M3: P-05 sections (analysed timelines show "Now" instead of a section), P-06 key regions; `/api/report` Origin-only

## Skip
- `apps/web/src/ui/settings/Diagnostics.tsx`, `apps/web/src/probe/*` — M1 tools, unchanged
- `apps/web/e2e/fixtures/*.json` — data
- `design/sketchbook.html` — M5 reads only its Lead sheet section (`.lapp` CSS ~line 251, markup after "LEAD SHEET",
  `buildSheet` / `renderSheet` in the script)

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/M4-stand.md, then the M5 row in handoffs/02-dev-plan.md and the
Lead sheet section of design/sketchbook.html. Then do M5: Stand follows Spotify (SpotifyClock → screens, fetch + cache
by track ID, 4 sync states, empty state), the landscape lead sheet + rail, tap-to-seek, and the calibration UI. Test on
a Fire TV (D-28) with an analysed pop track first (D-36).
```
