# S1 · Design sketches

**Status:** awaiting approval · 2026-10-10 · **Next:** S2
**Commit:** draft pushed with S0. The approval commit closes this stage.

## Goal of this stage
Interactive sketches of every main screen, approved by the user before planning development.

## Artifact
- Source: `design/sketchbook.html` (single file, sample data and a working theory engine in JS)
- Published (private): https://claude.ai/code/artifact/f0e3b731-fb7f-47e5-8e13-b2525a475edb
- To update it, edit the file and republish from the same path (or pass the URL from a new session).

## Screens
| Screen | Orientation | Contents |
|---|---|---|
| Stand | Portrait | Now playing + sync badge, Home/Now key chips, BPM, metre, large current chord + Roman numeral + beat dots, Up next ×4 with beat countdown, key-change countdown card, scale panel (scale, alternative, notes, 2-octave keyboard, guide-tone motion), tab bar |
| Lead sheet | Landscape | 4-bar-per-line chart, rehearsal letters, key-change marks, brass playhead, scrolls a line at a time. Right rail: chord, function, next, scale, keyboard |
| Song map | Portrait | Row per pass (intro/head/solos/ending), key bands coloured by circle-of-fifths position, tap to seek, key-area totals, loop a span |
| Scale coach | Portrait | Next 8 changes with scale under Inside/Bebop/Colour lens, note to land on (3rd), ii–V–I guide-tone tip |
| States | — | Sync: locked/re-syncing/paused/not connected. Source: Analysed/Live/Predicted. Empty state. Settings list |

## Visual system (carry into the app)
- Chord symbols: Kalam 700, Real Book style (raised quality, small accidentals in Noto Music).
- UI: Barlow. Labels: Barlow Condensed, uppercase and letter-spaced. Numbers: IBM Plex Mono.
- Colour roles: brass = now/current, steel = next/guide tones, rust = key change, green/amber = sync health.
- Themes: Stage (dark, default for gigs) and Paper (light). Tokens live at the top of the sketch's `<style>`.

## Theory logic already prototyped (port to M2)
Transposition by letter and semitone, chord-tone spelling, scale choice by quality and function,
Roman numerals, guide-tone nearest-move, ii–V–I detection. See the `<script>` block of the sketch.

## Open (user)
- [ ] P-01 approve / change list
- [ ] P-02 alto, tenor, both
- [ ] P-03 chord source (recommendation: A + B hybrid)
- [ ] P-04 Mac available?

## On approval
Move P-01..P-04 into D-xx, set Status to done, update CLAUDE.md to S2, commit `S1: designs approved`, push.

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/01-design.md. Then do S2: write
handoffs/02-dev-plan.md (stack, architecture, final milestones with exit criteria, risks, spikes).
Don't open design/sketchbook.html except its <script> block if the theory engine needs to be referenced.
```
