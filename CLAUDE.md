# MusicQueery

iPhone app: a live lead-sheet dashboard synced to Spotify playback (chords, key, tempo,
key changes, suggested scales) for practising piano and saxophone improvisation.

## Current stage

**M7 follow-up: SP7 offset fix, then M8 · Map, Coach, polish** (or M9 Melody + Solo view; they are independent). M7 is
built and deployed; on the iPhone the mic heard Let It Be well but stamped chords ~2.5 s late (D-70), which is the first
job. M6's SP5 audio test and M5b's live inbox check still wait on the user. Read `handoffs/DECISIONS.md`, then
`handoffs/M7-listen.md`; its Next prompt says what to do.

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
- `companion/` — Windows companion, Python 3.12 + uv (M3): `pnpm companion <cmd>` (`analyse`, `watch`, `queue`, `inbox`, `login`…)
- Commands: `pnpm dev`, `pnpm test`, `pnpm e2e` (Playwright WebKit), `pnpm lint`, `pnpm typecheck`, `pnpm ship` (deploy), `pnpm tail` (live device logs)
- `design/sketchbook.html` — approved design source (published as an artifact; URL in 01-design.md)
- `handoffs/` — stage handoffs, decision log, template (see `handoffs/README.md`)
