# M10 · Lead sheet view (replaces Solo)

**Status:** approved on screenshots, deployed (Worker version dca3a8a6) · 2026-10-18 · **Next:** the user's visual verdict, then fixes
**Commit:** see `git log` for "S10|M10:" (pushed to origin/main)

## Goal of this stage
The user tried M9's Solo view and didn't like it. They asked for a new view in its place, called "Lead sheet" (Chart | Lead sheet switch).
It engraves the song on staves so they can improvise from sheet music, with the chords and progression shown faithfully
(no invented voicings or rhythms). Saxes get one treble staff with the scale. Piano (Concert) gets a grand staff: the chord in
the bass clef, the scale in the right hand. Lines wrap, with at most 3 systems in view (2 grand staves for piano). Time and key
signatures sit where they fall, every sharp/flat stays on its note, and upcoming changes are flagged.

## Decisions
- D-79 Lead sheet view replaces Solo (D-78); melody UI removed, the companion keeps making melodies (P-08)
- D-80 Engraving rules: runs of one scale, chord stacks, signatures, note values, layout, squeeze, repeats

## Built
- `apps/web/src/ui/stand/engrave.ts`: the pure engraver. `engrave()` turns a timeline + instrument + Play mode + lens into measures
  (meter from the beat grid, key signature, runs, treble blocks, bass stacks with ties, rests, bar repeats). `layout()` breaks
  lines at a width in staff spaces. Also `beatX` / `xBeat`, `noteValues`, `msAtBeat`, `fifthsOf`, `sigAccs`, `bassStack`,
  `trebleBlock` and `rotateTo`
- `apps/web/src/ui/stand/Score.tsx`: `StandSwitch` (Chart | Lead sheet), `ScoreView` (window, playhead, scroll, tap-to-seek),
  `SystemView` (SVG staves plus HTML chord symbols), `ScoreCard` (portrait), `ScoreSheet` (sideways, header shows the meter)
- `engrave.test.ts` (5): signatures, note values, stacks, and a measure walk on a synthetic E♭ → 2/4 → C minor + D7 timeline;
  Let It Be on alto
- `engrave.stress.test.ts`: all 11 truth timelines (Harte → chord text, bars from the beat grid), the demo, 11 tunes and 7 drills,
  × 3 instruments × 3 modes × widths 34/38/90. Checks the invariants and prints how dense each song gets
- `e2e/score.e2e.ts` (3): Let It Be alto/piano, ATTYA tenor key change, Human Nature (truth) portrait + sideways. `E2E_SHOTS=1` → `test-results/shot-score-*.png`
- Settings `stand`: 'chart' | 'score'. A saved 'solo' loads as 'score'. `app.css`: the Solo block became the M10 block
- Removed: `Solo.tsx`, `melody.ts`, `melody.test.ts`, `e2e/solo.e2e.ts`, `fixtures/let-it-be-melody.timeline.json` (all in
  git history at 6f8ec7b for the melody page, P-08)

## Verified
- `pnpm test` → 1167 passed · `pnpm lint`, `tsc` clean · `pnpm e2e` → 34 passed (WebKit 402×778 and 874×402)
- Stress, bars per line for alto, portrait (38 spaces), Integrated: pop 2.4–2.9 (Let It Be 2.7, Don't Stop Me Now 2.4), dense
  truths 1.2–1.9 (Something 1.2, Human Nature 1.9, Higher Ground 1.2), Coltrane changes 1.0. No line overflows in any song,
  instrument, mode or width
- Screenshots looked at: Let It Be alto/piano, ATTYA tenor and piano (→ D major flagged, signature changes), Human Nature
  alto portrait and piano sideways (13 bars a line with bar repeats)

## Open
- [ ] user: approve or deny the look (the screenshots). Questions to ask:
  - staff size: in portrait it is set by the width (≈ 2 bars a line), which leaves room under 3 systems; bigger staves mean
    fewer bars a line
  - chords with the same scale are stacked in the treble instead of rewriting the scale: OK on sax?
  - held chords get rhythm slashes; a repeated bar gets 𝄎
- [ ] user: `pnpm ship`, then try it on the phone with real practice. The render budget on the iPhone is unmeasured (all systems
      in a 4-line window re-render on an instrument/mode change; only the current one re-renders per chord)
- [ ] known: a key change inside a bar is signed from the next bar line; theoretical written keys (G♯ major) take the
      enharmonic signature while the notes keep their spelling; analysed timelines whose beat counts wobble show meter changes
      (true to the grid, D-80)
- [ ] loose end P-08: the melody page (from the PC's capture, not the mic)
- [ ] carried: M8 practice week; M9 melody exit (now moot for UI); SP5 audio, Fire TV loop gap, Jazz 1460 import; M5b inbox check;
      M7 user checks; P-05, P-06

## Skip
- `handoffs/M9-melody.md`: superseded for the UI; read it only for P-08
- `packages/*`, `companion/`: unchanged this stage

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/M10-lead-sheet.md. I'll say what I think of the Lead sheet view
(screenshots or phone): fix what I flag, re-shoot with E2E_SHOTS=1, and send me the screenshots.
```
