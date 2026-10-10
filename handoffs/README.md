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
| M1 | Sync spike | `M1-sync.md` | PWA on the iPhone, measured playhead drift |
| M2 | Theory engine + chart model | `M2-theory.md` | Tested packages: chords, transposition, scales, guide tones, iReal parser |
| M3 | Companion + timeline store | `M3-analysis.md` | Timeline JSON produced for real tracks, served by the Worker |
| M4 | App shell + Stand | `M4-stand.md` | Portrait Stand screen running on a recorded timeline |
| M5 | Live wiring + Lead sheet | `M5-live.md` | Live sync + timeline, landscape lead sheet |
| M6 | Backing tracks | `M6-backing.md` | In-app band plays a chart, iReal import, drills, Spotify play-along |
| M7 | Listening live + Predicted | `M7-listen.md` | Mic chord detection, predicted chords, chart alignment, chord fixes |
| M8 | Map, Coach, polish | `M8-polish.md` | All five tabs used in a week of real practice |

Milestones were finalised in S2 (D-22). Later stages may split or reorder them, and update this table if they do.


## Rules for writing a handoff

- Use `_template.md`. 120 lines max. Use links and paths instead of pasted code.
- **Decisions** get an ID and are appended to `DECISIONS.md`. The handoff only lists new IDs.
- **Verified** means a command was run and its result is quoted. Anything unverified goes
  under Open.
- **Skip** names files the next session can safely leave unread, such as generated output
  or spike code that has been superseded.
- **Next prompt** is a single paste-ready message that starts the next stage from a fresh session.
- Finish with a commit and a push (see `CLAUDE.md`, step 3).
