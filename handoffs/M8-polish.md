# M8 · Map, Coach, polish

**Status:** built, awaiting the user's week of practice on the iPhone (not yet deployed: run `pnpm ship`) · 2026-10-11 ·
**Next:** M9 Melody + Solo view, or fixes from the practice week
**Commit:** see `git log` for "S8|M8:" (pushed to origin/main)

## Goal of this stage
All five tabs work: a Song map of the whole recording (passes, key colours, seek, key totals, loop a span), a Scale coach for
the next eight changes (lenses, landing note, ii–V–I tip), plus polish: settings, error states, perf, export. Also closed
M7's SP7 follow-up, which the user parked (D-71).

## Decisions
- D-71 SP7 timing parked: mic lateness steady within a listen, different per start (0.8–3.75 s); Mic lag shown, never stored
- D-72 Song map: rows per pass (chart) or 16 bars (recording), circle-of-fifths key colour, key areas, tap to seek, loop card
- D-73 Scale coach: next 8 changes, shared lens, land on the 3rd, ii–V(–I) tip described from its own notes
- D-74 Polish: chord style (Δ7 · –7), per-tab error boundary, Map/Coach empty states, `useShown`, memoised map rows
- D-75 Export = Share chords: plain-text lead sheet to the iOS share sheet (clipboard fallback)
- P-05 updated: the map uses chart passes/letters where present, else time-named rows; automatic sections stay off

## Built
- `packages/listen/src/offset.ts`: `chirp`, `findEcho` (normalised cross-correlation), `bestShift` (±5 s, middle of the
  best plateau); `scripts/score-live.ts` uses it and adds `--track <id>` (score a listen against the store's analysis)
- `apps/web/src/listen/`: `mic-processor.js` records a window for the echo test; `listener.ts` echo test (3 chirps,
  median round trip kept in localStorage `mq.micRoundTrip`, taken off the anchors), Mic lag measured in test mode, wake
  lock held while listening; `ui/settings/MicTest.tsx` Echo + Mic lag rows (no Use button, D-71)
- `apps/web/src/ui/map/`: `map.ts` (`buildMap`, `keyHue`, `loopSpan`), `SongMap.tsx` (tab, playhead via `frameBus`, key
  areas, loop card, Share chords), `share.ts` (`chartText`, `shareText`)
- `apps/web/src/ui/coach/`: `plan.ts` (`coachRows`, `coachTip`, `describeLine`; not `coach.ts`: Windows would clash with
  `Coach.tsx`), `Coach.tsx`
- `apps/web/src/ui/`: `chordStyle.ts`, `Boundary.tsx`, `NoTrack.tsx`; `Shell.tsx` wires the tabs inside the boundary;
  `stand/live.ts` `useShown()`; `store/settings.ts` `chords`; `atoms.tsx` `ChordSym` applies the style; `app.css` M8 block
- Tests: `map.test.ts` (3), `plan.test.ts` (3), `share.test.ts` (2), `chordStyle.test.ts` (1), `listen.test.ts` +2;
  e2e `practice.e2e.ts` (4: map, coach, share, chord style), `live.e2e.ts` +2 (echo test on the fake mic; Map/Coach
  following Spotify)

## Verified
- `pnpm test` → 1160 passed · `pnpm lint`, `pnpm typecheck` clean · `pnpm e2e` → 31 passed
- Screens checked in WebKit at 402×778 (`E2E_SHOTS=1`): the map shows Intro, Chorus 1–5 and Ending of the demo with
  A1/A2/B/A3 ticks and A♭ home 18 bars of 36; the coach shows B♭m7 → B♭ melodic minor (Colour), land D♭, tip "ii–V–I into
  A♭ major … A♭ falls a half step to G, then G holds"
- SP7 data (`score-live --track`, 60 s windows): As 0.65–0.9 s late over 6½ min; Let It Be 1.9, 2.4, 3.75 s in other
  listens; recognition at the best shift 75–95% majmin
- Not verified on the iPhone: nothing from this session is deployed (the auto-mode classifier refused `pnpm ship`)

## Open
- [ ] user: `pnpm ship`, reopen the Home Screen app, then a week of real practice with all five tabs (the M8 exit);
      collect bugs as you go. Map/Coach on a Spotify song, a band tune and a drill; loop a section from the map; Share
      chords into Notes; try Δ7 · –7
- [ ] user (optional): the Mic test's Echo test, 3 starts, to say whether iOS's mic buffering is the 0.8–3.75 s (D-71)
- [ ] known: on analysed pop songs the map has time-named rows, not verse/chorus (P-05); the look-ahead count setting
      from the sketch is not built (D-74)
- [ ] carried: SP5 audio test, Fire TV loop gap, iPhone Jazz 1460 import (M6); M5b live inbox check; M7's user checks
      (fix a chord, link a chart, listen on an unanalysed song); P-05, P-06
- [ ] next stage: M9 (Melody + Solo view, SP9 first) or the practice-week bug list

## Skip
- `packages/listen/src/*` apart from `offset.ts`, `companion/`, `packages/band`: unchanged this stage
- `apps/web/src/listen/*`: parked (D-71); open only for the mic

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/M8-polish.md. If I bring a bug list from the practice week, triage and
fix it first. Then read the M9 row in handoffs/02-dev-plan.md and start M9 (Melody + Solo view) with spike SP9 on the PC.
```
