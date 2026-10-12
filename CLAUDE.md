# MusicQueery

iPhone app: a live lead-sheet dashboard synced to Spotify playback (chords, key, tempo,
key changes, suggested scales) for practising piano and saxophone improvisation.

## Current stage

**M9 built (Melody + Solo view), awaiting the user's tests.** M8 and M9 are not yet deployed (`pnpm ship`); the M8 exit
is a week of real practice, the M9 exit playing melodies along on alto from the Solo view. Restart `mqc watch` and run
`pnpm companion requeue-melody` so stored songs get melodies. Read `handoffs/DECISIONS.md`, then
`handoffs/M9-melody.md`; its Next prompt says what to do.

## Session protocol (keeps context small)

1. Start: read this file → `handoffs/DECISIONS.md` → the handoff named under "Current stage".
   Do not open older handoffs or the design HTML unless the current handoff says to.
2. Work only on the current stage. If a frozen decision (D-xx) looks wrong, raise it with
   the user instead of quietly changing course.
3. End of every stage, in this order:
   - Write the next handoff from `handoffs/_template.md` (120 lines max).
   - Append new decisions to `handoffs/DECISIONS.md`, and move resolved P-xx items into D-xx.
   - Update "Current stage" above.
   - `git add -A && git commit` with the subject `S<n>|M<n>: <summary>`, then `git push origin main`.
     The user has approved committing and pushing at every stage boundary. Commit mid-stage
     too if the work is large, but push at least at the end of the stage.
4. Recommend the user runs `/clear` before the next stage, then pastes the handoff's "Next prompt".

## Layout

- `apps/web` — the PWA (Vite + React). `apps/worker` — Cloudflare Worker: serves the PWA and `/api/*` (D-23)
- `packages/theory`, `packages/model` — pure TS packages (M2). iReal corpus: `pnpm --filter @mq/theory corpus`
- `packages/band` — the backing band's arranger, built-in tunes and drills (M6); `apps/web/src/audio` plays it
- `packages/listen` — live chord decoder, chart alignment, scoring (M7): `pnpm --filter @mq/listen eval --live` on the truth audio
- `companion/src/mqc/melody.py` — lead melody (M9): htdemucs + CREPE-tiny + Viterbi notes; Solo view in `apps/web/src/ui/stand/Solo.tsx`
- `companion/` — Windows companion, Python 3.12 + uv (M3): `pnpm companion <cmd>` (`analyse`, `watch`, `queue`, `inbox`, `login`…)
- Commands: `pnpm dev`, `pnpm test`, `pnpm e2e` (Playwright WebKit), `pnpm lint`, `pnpm typecheck`, `pnpm ship` (deploy), `pnpm tail` (live device logs)
- `design/sketchbook.html` — approved design source (published as an artifact; URL in 01-design.md)
- `handoffs/` — stage handoffs, decision log, template (see `handoffs/README.md`)
