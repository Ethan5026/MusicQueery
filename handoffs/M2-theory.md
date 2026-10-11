# M2 · Theory + chart model

**Status:** done · 2026-10-10 · **Next:** M3
**Commit:** see `git log` for "M2:" (pushed to origin/main)

## Goal of this stage
Port the sketch's engine to `packages/theory` and widen it (full chord grammar, numerals, key regions, lenses,
guide tones, ii–V–I); `packages/model` with Chart v1 / Timeline v1; our own `irealb://` parser (SP6).
Exit: `pnpm test` green with ≥ 200 cases; every chord in a 1300-tune iReal playlist parses; 12 keys × 3
instruments round-trip; snapshots match the sketch's tune.

## Decisions
- D-29 Chart v1 / Timeline v1 shape: canonical chord text, score-order bars, ms timelines, `exact` source
- D-30 SP6: own iReal parser; the corpus is iReal's Essential Playlists (Jazz 1460 = today's Jazz 1300)
- D-31 `theory.moment()` returns the whole screen state; per-timeline analysis is cached

## Built
- `packages/model/src/index.ts` — zod `Chart` (`mq.chart/1`) and `Timeline` (`mq.timeline/1`) + types;
  `pnpm --filter @mq/model schema` writes `packages/model/schema/{chart,timeline}.v1.json` for the Python companion (M3)
- `packages/theory/src/` (all pure TS, no DOM; `index.ts` re-exports everything):
  - `pitch.ts` — spelled pitch (letter + accidentals), intervals, transpose
  - `chord.ts` — chord grammar: 6/7/9/11/13, sus2/4, alterations, add, no3, slash, N.C.; lead-sheet, Unicode and
    iReal spellings in; canonical text out (`formatChord`); chord tones and required pitch classes
  - `instrument.ts` — concert / E♭ alto (M6 up) / B♭ tenor (M9 up) written pitch (D-05, D-08)
  - `scales.ts` — 21 scales, `pickScale(chord, context, lens)` for Inside / Bebop / Colour (D-06)
  - `numeral.ts` — keys, Roman numerals, `harmonicFunction` (diatonic, secondary V and ii, tritone sub, borrowed, passing °)
  - `regions.ts` — `detectKeys`: Viterbi over 24 keys, scored by function, fixed change penalty
  - `guide.ts` — `guideTones(a, b)` (3rd/7th motion), `findTwoFives` (major, minor, tritone sub, unresolved)
  - `chart.ts` — `expandChart` (repeats, endings, D.C./D.S., coda, choruses → playing order), `transposeChart`,
    `chartTimeline` (exact Timeline from a chart at a tempo)
  - `moment.ts` — `moment(timeline, positionMs, { instrument, lens })` → chord, function, key, next chords,
    key change ahead, scales for all three lenses, tones, guide tones, next ii–V (D-16)
  - `ireal.ts` — `parsePlaylist`, `songToChart`, `importPlaylist`: unscrambling, cells → beats, sections, repeats,
    endings, jumps, simile bars, alternate chords, comments, meter changes; `issues[]` lists anything not understood
  - `demo.ts` — the sketch's tune (All the Things You Are in A♭) as a Chart
  - `__sketch__/engine.ts` — the sketch's engine copied unchanged, used only by `sketch.test.ts` for parity
- `packages/theory/scripts/fetch-corpus.ts` — `pnpm --filter @mq/theory corpus` downloads the six Essential Playlists
  into `packages/theory/corpus/` (gitignored)

## Verified
- `pnpm test` → 11 files, **1035 passed** (sketch parity 553, chord 269, theory 134, iReal 40 incl. 24 corpus,
  chart 10, moment 7, model + web + worker rest) · `pnpm typecheck`, `pnpm lint` → clean
- Sketch parity: every chord of the demo tune × 3 instruments × 3 lenses matches the sketch's own engine
- `12 keys × 3 instruments round-trip` (`index.test.ts`) passes
- Corpus (`ireal.test.ts`, `corpus *.txt`), fetched 2026-10-10 from https://www.irealpro.com/main-playlists/:
  - **Jazz 1460: 1460 songs import, 0 unparsed chords, 0 other issues**, all schema-valid and expandable
  - Brazilian 220, Latin 50, Blues 50 (54 songs), Pop 400 (403), Country 50: 0 unparsed chords
  - one known chart quirk: Casa Forte (Brazilian) ends on `ppD-` in 2/2 (3 cells, 2 beats) → bar split evenly
- The user's `pdfcoffee.com-jazz-1300.pdf` is iReal's printed charts with the chords drawn as shapes, not text, so it
  can't be parsed. 1267 of the 1460 titles appear in its text; the rest are retitled or added charts
- Bug found by the corpus and fixed: a meter change applied to its own bar only (Blackbird, Hellhound On My Trail);
  regression test `a meter change holds for the bars after it`

## Open
- [ ] M6: iReal styles (`Medium Swing`, `Bossa Nova`…) are kept as text; the band engine maps them to grooves
- [ ] M6: over-full bars (more chords than beats) split evenly; check how iReal itself plays them
- [ ] M3: the companion validates against `packages/model/schema/*.json`; re-run `pnpm --filter @mq/model schema` after any schema change
- [ ] M7: `Timeline.edits[]` exists, but nothing applies them except `effectiveChords` in `moment.ts`; the UI comes later
- [ ] still open from M1: first fresh start on a new device is ~300 ms off until its first resync; calibration UI (M5);
  `/api/report` and `/api/log` only check `Origin` (bearer secret arrives with `/api/timelines` in M3)
- [ ] Spotify refresh tokens die 6 months after first login (≈ 2027-04-10)

## Skip
- `packages/theory/src/__sketch__/engine.ts`, `sketch.test.ts` — parity check only; don't edit
- `packages/model/schema/*.json` — generated
- `design/sketchbook.html` — fully ported; M4 opens only `staffSVG()`
- `handoffs/M1-sync.md` — history; its open items are copied above

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/M2-theory.md, then the M3 row and SP3/SP4 in
handoffs/02-dev-plan.md. Then do M3: the Windows companion (per-process loopback capture of Spotify, SP3;
chord/beat/key analysis bake-off, SP4; upload) and the Worker timeline store (PUT/GET /api/timelines/:id with
a bearer secret). Timelines must validate against packages/model/schema/timeline.v1.json.
Ask me for 3 tracks with charts I trust when you need hand-aligned ground truth.
```
