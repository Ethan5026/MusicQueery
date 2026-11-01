# M12 · Jazz-ready charts (audit fixes)

**Status:** built, tested, pushed, deployed (Worker version 779c97fc) · 2026-11-01 · **Next:** mini PC update, library re-analysis
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

## Verified
- `scripts/m12_eval.py` (cache in `work/m12/`), human pop per beat, M3 vote → M12: root .838 → .864, majmin .840 → .871,
  sevenths .677 → .732, jazz .651 → .713; iReal truths sevenths .478 → .544, changes per bar 1.27× → 1.06× the truth's
- Keys (`finishAnalysis` on stored + truth chords): 18 → 22 of 24 known keys; all 14 analysed recordings right
- Soloist audit, 11 truth songs: misleading bars 33.1% → 25.4%; Advanced scale lacking a chord tone 18.0% → 9.3%
- Production path on the Fly Me truth audio: BTC-PL fetched (35 MB, checksum OK, identical file), Jazz 1460 chart attached,
  96 chords (was 128), schema valid, 16 s
- `pnpm test` → 1177 passed; `pnpm e2e` → 38 passed (new: pop chart offered not linked; jazz chart links itself, unlink sticks;
  chord detail survives a reload); typecheck + eslint clean; companion `pytest` 40 passed, `ruff check` / `format --check` clean
- Screenshots (scratchpad, shown to the user): Fly Me auto-linked (Chart, link sheet, fix sheet with the detail switch), Human
  Nature as heard vs Jazz 7ths (landscape chart, alto lead sheet)

## Open
- [x] `pnpm ship` done 2026-11-01 (Worker version 779c97fc). On this laptop pnpm's cmd shell needs node first on PATH:
      `PATH="/c/nvm4w/nodejs:$PATH" pnpm ship`
- [ ] user/next: the mini PC must run this code before the re-analysis: `git pull`, `bash companion/linux/install.sh`
      (fetches the iReal corpus, rebuilds the bridge), `systemctl --user restart mqc-watch`; then
      `pnpm companion:linux requeue-all --before 2026-11-02` (33 tracks; each is played in full, ~4–6 h when Spotify is idle).
      Not done yet: the mini PC takes password logins only (BatchMode SSH can't), and `~/.ssh/mq_minipc.pub` isn't in
      its authorized_keys. Once it is: `ssh -i ~/.ssh/mq_minipc gruman@192.168.40.46`
- [ ] user: approve the screenshots (fix sheet detail switch, link sheet "Linked automatically", Jazz 7ths)
- [ ] next stage: watch the first re-analyses (`journalctl --user -u mqc-watch -f`): "fetched BTC-PL", "iReal charts titled like
      it", generator `mqc/vote+smooth+pl+beat_this`
- [ ] next stage: portrait Lead sheet still shows ~2 bars (D-81, user decision); a chord look-ahead strip there was not built
- [ ] later: stems helped Mas Que Nada's 7ths only; a jazz-only use could be retried with more jazz truth
- [ ] P-05 sections still open (allin1 not tried)

## Skip
- `companion/scripts/m12_*.py` — spikes; rerun only to re-tune
- `research/alternative-approaches.md` — already weighed in D-90

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/M12-jazz-charts.md. Check the mini PC runs M12 (journalctl --user -u mqc-watch),
then that the requeued library is being re-analysed; spot-check a few new timelines with the soloist audit or on the phone.
```
