# M9 · Melody + Solo view

**Status:** built, awaiting the user's play-along test on the iPhone (not yet deployed: `pnpm ship`) · 2026-10-11 ·
**Next:** fixes from the M8 practice week and the M9 play-along, or a new stage the user picks
**Commit:** see `git log` for "S9|M9:" (pushed to origin/main)

## Goal of this stage
SP9 on the PC (can the lead melody be pulled out of a mix and turned into notes, fast enough?), then the companion
step that stores it in every analysis, and the Solo view on Stand: the melody in written pitch on a big staff with
the scale below. Exit: the user plays the melody along on alto from the Solo view on 2 of 3 pop songs.

## Decisions
- D-76 SP9: htdemucs vocals → CREPE-tiny → Viterbi notes (core pitch, blips merged, sixteenth grid); numbers below
- D-77 Timeline `melody[]`, Worker melody count, companion-only queue `redo`, `requeue-melody`, `melody-saved`
- D-78 Solo view: Chart/Solo switch, proportional scrolling staff, written pitch, key spelling, scale with marks

## Built
- `companion/src/mqc/melody.py`: `separate`, `pitch`, `segment` (Viterbi + `core_pitch`), `merge_blips`,
  `sixteenths`, `snap`, `melody()` (vocals, else the other stem); `tests/test_melody.py` (7)
- `companion/src/mqc/pipeline.py` `add_melody` (stereo capture, never fails the chords), `analyse_track(with_melody)`;
  `cli.py` `analyse --no-melody`, `melody-saved`, `requeue-melody`; `store.queue_add(redo)`; `watch.py` honours redo
- `companion/pyproject.toml`: demucs, torchcrepe; `tool.uv.environments` = win32 (D-77)
- `companion/scripts/sp9_*.py`: spike tools (`sp9_separate`, `sp9_eval` vocadito clean/mixed/separated,
  `sp9_sweep`, `sp9_song` real-song plausibility + piano roll, `sp9_blips`); data in `%LOCALAPPDATA%\MusicQueery\work\sp9`
  (vocadito from Zenodo 5578807, stems, f0 caches)
- `packages/model`: `MelodyNote`, `MelodyStem`, `Timeline.melody?`; schema JSON regenerated
- `apps/worker`: metadata `melody` count; queue POST `redo` (secret only); test +1
- `apps/web/src/ui/stand/melody.ts` (`soloLine`, `octaveShift`, `spellIn`, `staffPos`, `soloWindow`, `melodyPcs`;
  not `solo.ts`: Windows clashes with `Solo.tsx`) + `melody.test.ts` (5); `Solo.tsx` (`StandSwitch`, `SoloStaff`,
  `SoloScale`, `SoloCard` portrait, `SoloSheet` sideways); `Stand.tsx`/`LeadSheet.tsx` wire it; `store/settings.ts`
  `stand`; `app.css` M9 block
- `apps/web/e2e/solo.e2e.ts` (3) on `fixtures/let-it-be-melody.timeline.json` (397 notes from the truth audio)

## Verified
- Vocadito, note F vs annotators A1/A2 (annotators agree 0.740): CREPE-tiny + tuned Viterbi clean 0.724/0.687; in a
  pop backing at 0 dB and separated 0.676/0.655, at −6 dB 0.625/0.620; unseparated mix 0.546/0.555. Untuned
  segmenter: full CREPE 0.675/0.606, FCPE 0.631/0.553, basic-pitch (ONNX) 0.486/0.501, pYIN 0.445/0.426. Octave errors
  0.0–0.7%. Shipped integer-semitone notes score 0.652 mean on vocadito (its singers drift off the grid)
- Time on this PC (8 threads, CPU torch): htdemucs 126 s for Let It Be's 243 s (0.52×) alone, 0.57–1.10× while other
  jobs ran; CREPE-tiny 0.07–0.10× alone, 0.17× contended
- Real songs (vocal stems, CREPE-tiny): Let It Be, Don't Stop Me Now, Human Nature, It's Too Late: 81–91% of sung time
  in one major scale, 52–66% on chord tones, 0.5–1.4% leaps of 10+ semitones; contours agree across methods (piano
  rolls in `work/sp9/*.png`). Let It Be verse after `core_pitch`: C D C♯ E D D C, E♭ E E D E (the C♯ is sung at 60.85)
- `pnpm test` → 1166 passed · `pnpm lint`, `pnpm typecheck` clean · `pnpm e2e` → 34 passed · companion pytest 35, ruff
  clean · `mqc requeue-melody --dry-run` → 18 stored analyses without a melody
- WebKit 402×778 and 874×402 screenshots (`E2E_SHOTS=1`): Solo on Let It Be at 0:17, portrait fits without scrolling
- `mqc melody-saved` was uploading the truth songs' melodies to the store when this was written (check `mqc list`)

## Open
- [ ] user: `pnpm ship`; restart `mqc watch` (the running one has the old code: no melody); then
      `pnpm companion requeue-melody` and leave Spotify idle: ~18 songs re-captured (~4 min each + analysis)
- [ ] user (M9 exit): Solo view on 3 pop songs from "Swinging and Shredding" on alto; can you play the melody along
      on at least 2? Note wrong octaves, chromatic slips, crowding; whether proportional notation reads well enough or
      you want engraved rhythms (D-78)
- [ ] unverified: the render budget on the iPhone (no frame > 50 ms) with Solo on; the "other" stem on a real
      instrumental (Cliffs Of Dover, What Is Hip? are in the requeue list); Worker `redo` live (needs the deploy)
- [ ] known: sung pitches between semitones show as chromatic notes (Let It Be's C♯); no reference melody exists for
      the truth songs, so F is quoted on vocadito only; scoops ≥ 0.12 s stay as notes
- [ ] carried: M8 practice week and bug list; SP5 audio test, Fire TV loop gap, Jazz 1460 import (M6); M5b inbox
      check; M7 user checks; P-05, P-06

## Skip
- `companion/scripts/sp9_*.py`: spike tools; `sp9_notes.py` is superseded by `mqc/melody.py`
- `packages/listen`, `packages/band`, `apps/web/src/listen/*`: unchanged this stage

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/M9-melody.md. I'll bring what I found in the M8 practice week and
the M9 play-along on alto: triage the list, fix what's broken, and say which open items are left.
```
