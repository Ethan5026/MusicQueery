# M7 · Listening live + Predicted

**Status:** done (built, tested offline, deployed; the over-speaker test on the iPhone (SP7) waits on the user, see Open) · 2026-10-11 · **Next:** M8 or M9
**Commit:** see `git log` for "S7|M7:" (pushed to origin/main)

## Goal of this stage
The phone's mic hears what plays on any speaker and shows the chord live (with confidence), predicts what comes next
from the song's own repeats or an earlier listen, saves what it heard per track (D-09), lets the player fix chords,
and lines an iReal chart up with a recording so its chord names replace the heard ones. Pop first (D-36).

## Decisions
- D-64 `@mq/listen`: pure-TS decoder (NNLS chroma, online beat tracker, 61-state beat HMM, chorus consensus)
- D-65 live display + mic chain: 0.2 s window, Predicted bias; worklet → Worker, anchors via SpotifyClock; segments
- D-66 live timelines apart from analysed ones (`live:`/`lv:`), "Heard live", Predicted = everything ahead, prior
- D-67 chord fixes: own IndexedDB store + `/api/edits/:id`, by time span over any timeline, written-pitch picker
- D-68 chart link: Jump Alignment on labels, all keys × tempo ratios, trusted only if roots agree and few jumps
- D-69 SP7 tooling: Mic test card (agreement with the analysis as it plays), `score-live` on the PC, fake mic e2e
- P-05 updated: harmony-only sections measured, not shown; a linked chart's rehearsal marks are M7's sections

## Built
- `packages/listen/src/`: `fft.ts`, `frontend.ts` (decimate → STFT 4096/512 → log-freq, tuning, whitening, NNLS
  notes → bass/treble chroma; onset flux at ~86 Hz), `beats.ts` (`BeatTracker`, `beatF`), `chords.ts` (vocabulary,
  emissions, change prior by key, Viterbi, `stateOfSymbol`), `keys.ts`, `repeats.ts` (beat SSM diagonals →
  consensus), `live.ts` (`LiveDecoder`: now/settled/predicted/finish), `offline.ts`, `score.ts` (MIREX per beat,
  TS port of evaluate.py), `timeline.ts` (`liveTimeline`, `mergeLive`, `barPhase`), `align.ts` (`alignChart`),
  `sections.ts` (`findSections`, `boundaryF`; not used by the app), `room.ts` (speaker + room + mic simulation)
- `packages/listen/scripts/`: `eval.ts` (`pnpm --filter @mq/listen eval [--oracle] [--room] [--live] [--chart]
  [--wrong-chart]`), `sweep.ts` (parameter grid on cached frames), `score-live.ts`, `sections.ts`; `reports/m7-*.txt`
- `apps/web/src/listen/`: `mic-processor.js` (worklet, 2048-sample chunks over a MessagePort), `decoder.worker.ts`,
  `listener.ts` (`useListen`, start/stop, anchors, live view, save on segment end, SP7 test scoring)
- `apps/web/src/timeline/`: `live.ts` (load/save/upload live timelines), `edits.ts`, `link.ts`; `library.ts` falls back
  to a saved live timeline; `store/idb.ts` v3 adds `edits`
- `apps/web/src/services.ts`: session `live`, `edits`, `linked`, `setEdits`, `linkChart`, `relink`
- `apps/web/src/ui/stand/`: `Listen.tsx` (Listen button, Mic chip, confidence, waiting state), `FixChord.tsx`,
  `LinkChart.tsx`; `Stand.tsx` (shown = live ?? linked ?? timeline, + fixes; Up next · Predicted in grey; tap the
  chord to fix it); `atoms.tsx` ("Heard live"); `ui/settings/MicTest.tsx` (SP7 card in Diagnostics)
- `apps/worker/src/index.ts`: `GET|PUT /api/live/:id` (KV `lv:`), `GET|PUT /api/edits/:id` (KV `ed:`); `@mq/model`
  adds `TimelineEdits`
- Tests: `packages/listen/src/listen.test.ts` (13), worker +2, `e2e/fake-mic.ts` + `live.e2e.ts` +2

## Verified
- `pnpm test` → 1149 passed · `pnpm lint`, `pnpm typecheck` clean · `pnpm e2e` → 25 passed (listening runs the real
  decoder Worker on a fake mic: live chords, confidence, Predicted after the loop repeats, upload on stop; a fix shows,
  is PUT, survives a reload, undoes)
- Truth set (7 human-annotated pop songs, D-39), per beat, majmin / sevenths, mean (`reports/m7-live-*.txt`):
  - offline, truth beats, clean: 65.7 / 46.9; + chorus consensus 70.5 / 52.3 (simulated room 58.4 → 60.6 majmin)
  - **live as shown** (what the phone displays at each moment): clean 61.2 / 42.5, median 291 ms behind a change,
    84% within a beat; simulated room 50.8 / 33.5, 386 ms, 75%. Room per song: Let It Be 77.3, Human Nature 57.4,
    Something 57.5, It's Too Late 59.9 (four ≥ 55%), Don't Stop Me Now 49.1, Just the Way You Are 43.7, Higher Ground
    11.0 (E♭ bass below the simulated speaker's 110 Hz)
  - live saved (final re-decode): clean 65.9 / 48.4, room 55.5 / 39.4. Beat F: 0.97 on steady pop; ballads lock at
    double time (Let It Be, Something), funk slips phase (Higher Ground 0.32)
  - **linked chart** (iReal Pop 400, 5 songs): clean 69.7 → 80.4 majmin, 50.5 → 64.8 sevenths; room 63.7 → 68.9,
    46.0 → 54.9. Wrong chart (each song given another's): 5/5 refused (right charts 0.03–0.14 jumps a bar, wrong 0.17–0.48)
  - sections (P-05), boundary F at ±3 s vs Isophonics segments (4 songs): human chords 0.65, PC analysis 0.43, live 0.23
  - decoder speed in Node ≈ 100× real time; Worker bundle 27 kB
- Deployed (version de486c92): `/api/live/bad` → `bad id`, unauthenticated PUT → 401, `/api/health` ok
- Not verified: the iPhone's mic over real speakers (SP7), raw-constraint honouring on iOS 27, decoder CPU on the phone

## Open
- [ ] user (SP7): Settings → Show sync tools → Mic test. Play Let It Be (or Something, Human Nature, It's Too Late)
      on the Fire TV, Start, leave the phone where you practise for the whole song, Stop, Send. Then I run
      `pnpm --filter @mq/listen score-live` (per-beat score vs the human truth + the best time shift = mic offset).
      Exit: 3 tracks ≥ 55% per beat, confidence visible. Note what the card says for echo cancel / noise supp. / gain
- [ ] user: a song with no analysis: Stand → "Listen with the mic". Look for confidence, grey Predicted after the
      first chorus, landscape lead sheet while listening, and that the next play opens "Heard live" with look-ahead
- [ ] user: fix a chord (tap it), and link a chart (fix sheet → "Link an iReal chart…", after importing Pop 400)
- [ ] unverified: listening while Spotify plays on the phone itself (`play-and-record` may route output to the earpiece)
- [ ] known: double-time beats on ballads halve the live bars; bass below the speaker's range defeats the root; a
      mic offset (if score-live finds one) needs a constant in `listener.ts` `sendAnchor`
- [ ] carried from M6: SP5 audio test, Fire TV loop gap, iPhone Jazz 1460 import; M5b live inbox check; P-05, P-06
- [ ] next stage: M8 (Map, Coach, polish; P-05 sections: `findSections` + chart rehearsal marks) or M9 (Melody)

## Skip
- `companion/`: unchanged (truth audio in `%LOCALAPPDATA%\MusicQueery\work\truth` is what `eval` reads)
- `packages/band`, `packages/theory`: unchanged (listen uses `finishAnalysis`, `expandChart`, `effectiveChords`)
- `packages/listen/src/room.ts`, `scripts/sweep.ts`: evaluation only

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/M7-listen.md, then the M8 row in handoffs/02-dev-plan.md.
Then do M8: Map, Coach, polish (Song map with sections — P-05: chart rehearsal marks, then findSections on analysed
timelines; Scale coach). First run `pnpm --filter @mq/listen score-live` and fold any SP7 results into DECISIONS.
```
