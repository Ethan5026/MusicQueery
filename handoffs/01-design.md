# S1 · Design sketches

**Status:** done · 2026-10-10 · **Next:** S2
**Commit:** `S1: designs approved` (pushed to origin/main)

## Goal of this stage
Interactive sketches of every main screen, approved by the user before planning development.

## Artifact
- Source: `design/sketchbook.html` (single file, sample data and a working theory engine in JS)
- Published (private): https://claude.ai/code/artifact/f0e3b731-fb7f-47e5-8e13-b2525a475edb
- To update it, edit the file and republish from the same path (or pass the URL from a new session).

## Screens
| Screen | Orientation | Contents |
|---|---|---|
| Stand | Portrait | Now playing + sync badge, Home/Now key chips, BPM, metre, large current chord + Roman numeral + beat dots, Up next ×4 with beat countdown, key-change countdown card, Play card (scale + alternative, treble staff with chord stack then scale and note names, Staff/Keys switch, guide-tone motion), 5-tab bar |
| Lead sheet | Landscape | 4-bar-per-line chart, rehearsal letters, key-change marks, brass playhead, scrolls a line at a time. Right rail: chord, function, next, scale on staff (or keyboard) |
| Song map | Portrait | Row per pass (intro/head/solos/ending), key bands coloured by circle-of-fifths position, tap to seek, key-area totals, loop a span |
| Backing tracks | Portrait | Search, Generated / On Spotify / Drills tabs, rows with key swatch and source badge, band card (mute piano/bass/drums, tempo, key, style, count-in) |
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

## Decisions
- D-08 both saxes · D-09 companion + mic · D-10 Windows, Expo + EAS
- D-11 scale and chord on treble staff · D-12 Tracks tab, three sources · D-13 milestones M1–M7

## Open (next stage)
- [ ] S2: pick the audio engine for generated tracks in Expo (sampler or soundfont playback with sample-accurate scheduling)
- [ ] S2: check the iReal Pro playlist format and parsing; decide how charts are stored
- [ ] S2: Spotify playback control (start/seek for loops and play-alongs) needs Premium. Confirm the user has it.
- [ ] S2: Apple Developer Program membership ($99/yr) is needed for TestFlight

## Skip
- `design/sketchbook.html`: everything visual is summarised above. Open only its `<script>` block for the theory engine (port in M2) or `staffSVG()` (staff rendering).

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/01-design.md. Then do S2: write
handoffs/02-dev-plan.md (stack, architecture, final milestones with exit criteria, risks, spikes).
Don't open design/sketchbook.html except its <script> block if the theory engine needs to be referenced.
```
