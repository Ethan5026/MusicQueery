# MusicQueery

iPhone app: a live lead-sheet dashboard synced to Spotify playback (chords, key, tempo,
key changes, suggested scales) for practising piano and saxophone improvisation.

## Current stage

**S2 · Development plan — not started.**
Read `handoffs/DECISIONS.md`, then `handoffs/01-design.md`. Nothing else is needed to resume.

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

- `design/sketchbook.html` — approved design source (published as an artifact; URL in 01-design.md)
- `handoffs/` — stage handoffs, decision log, template (see `handoffs/README.md`)
