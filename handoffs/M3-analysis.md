# M3 · Companion + timeline store

**Status:** done · 2026-10-11 · **Next:** M4
**Commit:** see `git log` for "S3|M3:" (pushed to origin/main)

## Goal of this stage
Windows companion: capture Spotify per process (SP3), analyse beats/chords/keys (SP4 bake-off), upload Timeline v1;
Worker store `PUT/GET /api/timelines/:id` with a bearer secret; the phone fetches a timeline.

## Decisions
- D-32 store API (public GET, bearer for writes/list, zod-validated) · D-33 SP3 C++ process-loopback capture, album-context play
- D-34 SP4 pipeline: beat_this + regularise, 3-way root vote, jazz-gated lead-sheet 7ths · D-35 Spotify playlist quota
- D-36 user: pop songs first, test songs from "Swinging and Shredding" · D-37 truth = chart chords on a madmom grid
- P-01 sections (not shipped) · P-02 key-region errors

## Built
- `apps/worker/src/index.ts` — `/api/timelines` store (D-32); secret `API_SECRET` set with `wrangler secret put`
- `apps/web/src/timeline/fetch.ts` — `fetchTimeline`, `chordAt`; `ui/App.tsx` Timeline card (M1 debug page) logs `timeline.fetch`
- `packages/theory/src/analysed.ts` — `spellInKey`, `respellInKey`, `toHarte`/`fromHarte`, `leadSheetSeventh`, `finishAnalysis`
- `packages/theory/scripts/bridge.ts` — JSON stdin/stdout bridge for Python (`pnpm --filter @mq/theory bridge` → `dist/bridge.mjs`)
- `packages/theory/src/ireal.ts` — fix: `||` is a double barline, not an empty bar (149/403 Pop 400 and 81/1460 Jazz charts had a ghost bar)
- `companion/` (Python 3.12, uv; run from the root with `pnpm companion <cmd>`):
  - `capture/mqcapture.cpp` + `build.cmd` — the native capture helper (D-33); `bin/` is gitignored, rebuild with `build.cmd`
  - `scripts/build_chordino.py` — builds the NNLS-Chroma/Chordino DLL and a patched `vamp` wheel for MSVC (bake-off group)
  - `src/mqc/spotify.py` PKCE login on `http://127.0.0.1:5173/callback`, player control · `capture.py` capture + alignment
  - `analysis.py` beats, recognisers, vote, gate, Timeline v1 assembly + JSON Schema validation (sections code is experimental, unused)
  - `pipeline.py` capture → analyse → validate → upload → delete audio · `store.py` Worker client · `bridge.py`
  - `truth.py`, `evaluate.py` — truth building (`mqc tap`, `mqc truth`) and scoring (`mqc bakeoff`, mir_eval)
  - `truth/*.json` forms + `*.timeline.json` truth · `reports/sp4-bakeoff.json` · `tests/test_pure.py`
- Commands: `login`, `status`, `setup-secret`, `capture-test`, `align-check`, `analyse <ids|links|@file|playlist>`,
  `analyse-saved`, `tap`, `truth`, `bakeoff`, `get`, `list`, `upload`

## Verified
- `pnpm test` → 1052 passed (worker 8 incl. store, theory analysed 8 + iReal `||` regression, web timeline 2) · lint, typecheck clean
- `pnpm companion` pytest → 10 passed · ruff clean
- Live store (deployed): PUT 200, invalid tonic 422, anonymous PUT 401, anonymous GET 200, list, delete → 404
- SP3: per-process capture of Spotify with the PC muted (peak 0.99); two captures of one track correlate 1.000 and align
  within 12 ms; repeat runs within 1–45 ms (`mqc align-check`); /me/player offset MAD 3–14 ms per run
- SP4 (`mqc bakeoff`, per beat, truth = chart chords on madmom grid, D-37):

  | Track | Mode | MIREX 7ths | root | beat F | downbeat F | main key |
  |---|---|---|---|---|---|---|
  | Let It Be (Beatles) | pop, 7th-share 0.00 | **0.852** | 0.949 | 0.996 | 0.978 | C ✓ |
  | Imagine (Lennon) | pop, 0.08 | **0.705** | 0.932 | 0.998 | 0.991 | C ✓ |
  | Mas Que Nada (Mendes) | jazz, 0.42 | **0.639** | 0.733 | 0.977 | 0.886 | F minor ✓ |
  | Fly Me to the Moon (Sinatra/Basie) | jazz, 0.26 | **0.544** | 0.634 | 0.989 | 0.868 | A minor ✗ |

  Single recognisers without the vote/gate: BTC 0.12–0.82, Chordino 0.14–0.75, madmom 0–0.89 (maj/min only).
  Lead-sheet 7ths alone: jazz +0.33–0.43, pop −0.4 to −0.77 → hence the gate.
- Exit criteria: ≥ 65% on 3 charts → **2 of 4 pass** (mean 0.685); beat F ≥ 0.9 → **4/4**; main key → **3/4**; schema-valid → all;
  10 tracks unattended → **10/10** (below); phone fetch → **yes**: the iPhone Home Screen app (build `2a4d775·10-11 04:44`,
  standalone) logged `timeline.fetch` ok for Zanzibar, 235 chords, 28 KB, zod-validated, 150–170 ms (Worker log, 2026-10-11)
- Unattended run (`mqc analyse`, first 10 of "Swinging and Shredding", D-36): **10/10 uploaded**, all schema-valid
  (9 in one pass; Lover (Live) failed twice because Spotify started the wrong album track, then passed with the new
  start fallbacks). Capture offset MAD 5.8–9.5 ms per track, 12–30 s analysis per track. Gate: 7ths on for Zanzibar,
  Even Flow, As, Got to Get You Into My Life, Man's World; triads for Wake the Funk Up, Jedi, Cliffs of Dover,
  What Planet Is This, Lover (a standard, but this live version was gated pop: check). 16 timelines in the store.

## Open
- [ ] user: said the app shows no updates and "looks nothing like the artifact" (2026-10-11). Expected: it is still the M1 debug
      page; the designed screens start in M4. Yet they saw no Timeline card although the phone fetched (above) and logged no
      error. M4: check the first build on the phone with the user before going further (Playwright WebKit too, D-15)
- [ ] M5/M8: P-01 sections; P-02 keys (Fly Me → A minor; B♭m7–E♭7 stretches called E♭ major)
- [ ] the 7th-share gate (0.18) rests on 4 tracks; Lover (Live) came out as triads; judge the 10 by eye once Stand shows them
- [ ] Fly Me (big band + vocal) is the weak case: roots 0.63. Ideas: bass-weighted chroma, source separation, chart alignment (M7)
- [ ] truth grids are from madmom, not human taps; `mqc tap` is ready if a hand-tapped check is wanted
- [ ] Spotify: playlist endpoints quota-blocked until ≈ 2026-10-12 00:00 CDT (D-35); refresh tokens die ≈ 2027-04 (M1)
- [ ] captured truth audio sits in `%LOCALAPPDATA%\MusicQueery\work\truth` (6 FLACs, gitignored) for re-scoring; delete when done (D-18)
- [ ] the recognisers (madmom from git, the patched vamp wheel, librosa, BTC) are runtime deps of `auto`; a fresh PC needs
      `python companion/scripts/build_chordino.py`, `uv sync`, BTC unzipped at `%LOCALAPPDATA%\MusicQueery\dl\BTC-ISMIR19-master`
- [ ] from M1: `/api/report` still Origin-only; calibration UI (M5)

## Skip
- `companion/scripts/build_chordino.py`, `companion/capture/*` — done; rebuild only on a new PC
- `companion/reports/`, `companion/truth/*.timeline.json` — generated
- `handoffs/M2-theory.md`, `design/sketchbook.html` — M4 reads the sketch's Stand section only (see below)

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/M3-analysis.md, then the M4 row in handoffs/02-dev-plan.md and the
Stand section of design/sketchbook.html. Then do M4: the app shell (5 tabs, tokens, fonts, Settings, IndexedDB, offline)
and the portrait Stand screen on a recorded timeline (ManualClock). Use a real analysed timeline from the store
(e.g. spotify:track:7iN1s7xHE4ifF5povM6A48, Let It Be) as well as the demo chart. Remember D-36: pop songs first.
```
