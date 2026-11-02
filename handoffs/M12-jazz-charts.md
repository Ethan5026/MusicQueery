# M12 · Jazz-ready charts (audit fixes)

**Status:** done: deployed (Worker 779c97fc), mini PC on M12 (8b29b9a), all 33 songs re-analysed and checked · 2026-11-02 ·
**Next:** the user's call on P-09 / P-10, then M13 (a second chord namer, lv-chordia; see Open)
**Commit:** see `git log` for "S12|M12:" (pushed to origin/main)

## Goal of this stage
The user asked whether the analysed charts are good enough to solo over (audit: not for jazz, decent for pop), then for every fix
the audit suggested plus the useful ideas in `research/alternative-approaches.md`, automated for every future scan, and the
whole library re-analysed on the mini PC. Pop must not get worse (D-36).

## Decisions
- D-86 the soloist audit is the yardstick (`pnpm --filter @mq/web audit`); before → after numbers
- D-87 key regions: most-held-root prior + modal IV/♭VII (P-06 resolved); key sides; C♭7 → B7
- D-88 triads take the key's mode; Integrated swaps tensions too; ii–V on resolving triads
- D-89 `vote_smooth` (harmonic-rhythm Viterbi) is the default; `fix_double_time`
- D-90 BTC-PL names chords (pinned, checksummed, weights-only); stems rejected; sections not tried
- D-91 iReal charts in `timeline.charts`; the phone links jazz-side charts by itself; pop charts only offered
- D-92 chord detail per track: Triads · As heard · Jazz 7ths
- D-93 `mqc requeue-all`; "Bar n of N" with linked charts
- D-94 production check on the mini PC (numbers match the lab) + three companion fixes; P-09, P-10 opened

## Built
- `packages/theory/src/regions.ts` — `tonicPrior` (TONIC_PRIOR 1.5, floor 0.15), modal emission 1.2
- `packages/theory/src/analysed.ts` — `signature`, `conventionalTonic(k, side)`, awkward-root respelling
- `packages/theory/src/scales.ts` — `keyMode`; `guide.ts` — triad V in ii–V–I; `ireal.ts` — `songKey`
- `packages/theory/src/moment.ts` — `Moment.tensions`, `withChordDetail`, `ChordDetail`; tests in `leadsheet.test.ts`
- `packages/model/src/index.ts` + `schema/timeline.v1.json` — optional `charts[]`
- `packages/theory/scripts/bridge.ts` — `find` op (charts by title)
- `apps/web/src/timeline/link.ts` — `autoLink`, `linkCandidates`, `autoLinks` (jazz-side lists), `UNLINKED`, `tl:` refs
- `apps/web/src/services.ts` — `relink` tries charts once per analysis; session `detail` + `setDetail`
- `apps/web/src/timeline/detail.ts` — per-track chord detail (IndexedDB `detail:<id>`)
- `apps/web/src/ui/stand/{FixChord,LinkChart,live,play,view}.ts(x)` — detail switch, sent charts, tensions, bar count
- `apps/web/scripts/solo-audit.ts` — the soloist audit (`pnpm --filter @mq/web audit pairs.json`)
- `companion/src/mqc/analysis.py` — `vote_smooth`, `fix_double_time`, BTC-PL fetch (`btcpl_checkpoint`) and namer
- `companion/src/mqc/pipeline.py` — `add_charts` (iReal charts by the Spotify title); `bridge.py` — `find_charts`
- `companion/src/mqc/cli.py` — `requeue-all`; bakeoff shows `smooth` / `smooth+7`
- `companion/scripts/m12_cache.py`, `m12_eval.py` — recogniser cache on the truth audio and the post-processing harness
- `companion/linux/install.sh` — fetches the iReal corpus and builds the bridge
- `companion/src/mqc/charts.py` — `same_song`, `base_title`, cache `lookups2` (D-94); `watch.py` — SIGTERM exit,
  `leftover_capture` pause on Linux (D-94); tests in `test_pure.py`, `test_watch.py` (companion pytest 43)

## Verified
- `scripts/m12_eval.py` (cache in `work/m12/`), human pop per beat, M3 vote → M12: root .838 → .864, majmin .840 → .871,
  sevenths .677 → .732, jazz .651 → .713; iReal truths sevenths .478 → .544, changes per bar 1.27× → 1.06× the truth's
- Keys (`finishAnalysis` on stored + truth chords): 18 → 22 of 24 known keys; all 14 analysed recordings right
- Soloist audit, 11 truth songs: misleading bars 33.1% → 25.4%; Advanced scale lacking a chord tone 18.0% → 9.3%
- Production path on the Fly Me truth audio: BTC-PL fetched (35 MB, checksum OK, identical file), Jazz 1460 chart attached,
  96 chords (was 128), schema valid, 16 s
- `pnpm test` → 1177 passed; `pnpm e2e` → 38 passed (new: pop chart offered not linked; jazz chart links itself, unlink sticks;
  chord detail survives a reload); typecheck + eslint clean; companion `pytest` 40 passed, `ruff check` / `format --check` clean
- Production (D-94), 11 truth songs, M11 store → M12 captured on the mini PC: misleading bars 33.1% → 26.1% (lab 25.4%),
  7ths 43.7 → 55.4, Advanced lacking a chord tone 13.1 → 9.9; a deliberate mid-capture restart left no autoplay
- Screenshots (scratchpad, shown to the user): Fly Me auto-linked (Chart, link sheet, fix sheet with the detail switch), Human
  Nature as heard vs Jazz 7ths (landscape chart, alto lead sheet)

## Open
- [x] `pnpm ship` done 2026-11-01 (Worker version 779c97fc). On this laptop pnpm's cmd shell needs node first on PATH:
      `PATH="/c/nvm4w/nodejs:$PATH" pnpm ship`
- [x] mini PC on M12 (2026-11-01, ce77212): `git pull`, `install.sh`, `systemctl --user restart mqc-librespot mqc-watch`;
      BTC-PL fetched there, iReal lookup checked (Fly Me → Jazz 1460, Let It Be → Pop 400). `requeue-all --before 2026-11-02`
      queued all 33 + All for Leyna (failed at 18:58 UTC: `PUT /me/player/play` 404, librespot restarted since).
      SSH there needs the default key AND the password: the user types it into a mintty window holding a ControlMaster,
      then `ssh -o BatchMode=yes -o ControlPath=~/.ssh/cm-%C -O proxy gruman@192.168.40.46 '<cmd>'` (Git for Windows ssh
      cannot open normal mux sessions). `pnpm companion:linux` now passes `--frozen` (it failed on the Windows-only wheel)
- [x] re-analysis checked 2026-11-02 (D-94): 33/33 on `mqc/vote+smooth+pl+beat_this`; audit of the 11 truth songs matches
      the lab; Zanzibar now ~146 bpm (was 296). Inbox added 29 new songs (MusicQueery playlist), analysed after the 33
- [ ] user: P-09 (auto-link jump limit 0.22 for recordings: Mas Que Nada's right chart is refused at 0.192) and P-10 (Simple
      shows the mode heard: Dorian / Mixolydian) — both in DECISIONS.md with the numbers
- [ ] user: approve the screenshots (fix sheet detail switch, link sheet "Linked automatically", Jazz 7ths)
- [ ] M13 candidate (research idea, the one left with a real accuracy chance): lv-chordia (MIT, ISMIR 2019 large-vocabulary
      model) as a second namer beside BTC-PL; score with `scripts/m12_eval.py` + the soloist audit, keep only if pop holds
- [ ] seen, not fixed: It's a Man's Man's Man's World (live) is 6/4 at 136 bpm (eighths; truly a slow 12/8). `fix_double_time`
      acts only ≥ 200 bpm; no truth to tune a lower rule on
- [ ] Mas Que Nada: if the phone already opened it, it stored "no auto link" for this analysis (`for` = createdAt); after P-09
      it links again only by hand or after a re-analysis
- [ ] portrait Lead sheet still shows ~2 bars (D-81, user decision); a chord look-ahead strip there was not built
- [ ] later: stems helped Mas Que Nada's 7ths only; a jazz-only use could be retried with more jazz truth
- [ ] P-05 sections still open (allin1 not tried)

## Skip
- `companion/scripts/m12_*.py` — spikes; rerun only to re-tune
- `research/alternative-approaches.md` — already weighed in D-90

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/M12-jazz-charts.md. Apply the user's answers on P-09 and P-10 (tests,
screenshots for P-10, deploy), then start M13: lv-chordia as a second chord namer, measured with companion/scripts/m12_eval.py
and the soloist audit; pop must not get worse (D-36).
```
