# Handoffs

Each stage of the project runs in a fresh Claude Code session. Instead of carrying the whole
conversation forward, a stage ends by writing one short handoff file. The next session reads:

| Order | File | Purpose | Size |
|---|---|---|---|
| 1 | `CLAUDE.md` | Current stage pointer, session protocol | ~30 lines |
| 2 | `handoffs/DECISIONS.md` | Frozen decisions (D-xx) and pending ones (P-xx) | grows slowly |
| 3 | Latest handoff | What was built and verified, open questions, exact next step | ≤120 lines |

Older handoffs are history. Don't load them unless the current handoff points to a section.

## Stages

| ID | Stage | Handoff | Ends with |
|---|---|---|---|
| S0 | Brief and research | `00-brief.md` | Requirements and constraints written down |
| S1 | Design sketches | `01-design.md` | User approves designs and answers P-01..P-04 |
| S2 | Development plan | `02-dev-plan.md` | Stack, architecture, final milestone list, risks |
| M1 | Spotify sync spike | `M1-sync.md` | Measured playhead drift on a real device |
| M2 | Theory engine | `M2-theory.md` | Tested package: chords, transposition, scales, guide tones |
| M3 | Chord timeline source | `M3-analysis.md` | Timeline JSON produced for real tracks |
| M4 | App shell and Stand | `M4-stand.md` | Portrait Stand screen running on a recorded timeline |
| M5 | Live wiring and Lead sheet | `M5-live.md` | Live sync + timeline, landscape lead sheet |
| M6 | Backing tracks | `M6-backing.md` | In-app band plays a chart, chart import, drills, Spotify play-along search |
| M7 | Map, Coach, TestFlight | `M7-ship.md` | Installed on the user's iPhone |

S2 may rename, split or reorder M1–M7. If it does, it updates this table.

## Rules for writing a handoff

- Use `_template.md`. 120 lines max. Use links and paths instead of pasted code.
- **Decisions** get an ID and are appended to `DECISIONS.md`. The handoff only lists new IDs.
- **Verified** means a command was run and its result is quoted. Anything unverified goes
  under Open.
- **Skip** names files the next session can safely leave unread, such as generated output
  or spike code that has been superseded.
- **Next prompt** is a single paste-ready message that starts the next stage from a fresh session.
- Finish with a commit and a push (see `CLAUDE.md`, step 3).
