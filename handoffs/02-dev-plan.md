# S2 · Development plan

**Status:** done · 2026-10-10 · **Next:** M1
**Commit:** `S2: dev plan` (pushed to origin/main)

## Goal of this stage
Fix the stack, architecture, milestone list with exit criteria, risks and spikes, so M1 can start coding.

## Decisions
- D-14 PWA replaces Expo (supersedes D-10) · D-15 stack · D-16 Timeline + Clock · D-17 Worker store
- D-18 Python companion · D-19 Premium: control in scope · D-20 own schemas, iReal import · D-21 Web Audio band
- D-22 milestones M1–M8 (supersedes D-13)

## Stack
| Part | Choice |
|---|---|
| Repo | pnpm workspaces, TypeScript strict, Vitest, ESLint + Prettier |
| `apps/web` | Vite + React 19 + Zustand, `vite-plugin-pwa` (offline), IndexedDB via `idb`, SVG staff/keyboard, self-hosted OFL fonts |
| Hosting | Cloudflare Pages from `main` (HTTPS is required for mic, service worker and the Spotify redirect) |
| `apps/worker` | Cloudflare Worker + KV, one bearer secret: timelines, `/log`, optional token broker (SP1) |
| `packages/` | `theory` (pure TS, no DOM) · `model` (zod Chart v1 / Timeline v1, exported as JSON Schema for Python) |
| App audio | Web Audio. Tone.js Transport + sampled instruments, or `smplr` (SP5). Mic: `getUserMedia` + AudioWorklet |
| `companion/` | Python 3.12 + uv, pytest, ruff. Native capture helper (SP3). Beats `beat_this`; chords by SP4; key/sections own code |
| Device debug | No Mac means no Web Inspector: Eruda overlay behind `?debug`, remote log to the Worker, Playwright WebKit on Windows |

## Architecture
```
 Windows PC                               Cloudflare                iPhone · PWA
 Spotify.exe ─loopback─▶ capture ─▶ analyse ─PUT─▶ Worker ─GET─▶ TimelineRepo ⇄ IndexedDB
 watcher ◀── Spotify Web API (track id, progress_ms)  /timelines/:id      │
                                                                   Clock: Spotify | Audio | Manual
 Mic ─▶ AudioWorklet ─▶ live decoder ─▶ Timeline(live) ──────▶ theory.moment(timeline, pos, prefs)
                                                         Stand · Lead sheet · Map · Coach · Tracks
```
- **Timeline v1** (per Spotify track ID or chart ID): `source` (analysed|live|predicted|exact), `durationMs`,
  `beats[]`, `bars[]` (downbeat, number, section, pass), `chords[]` (ms span, symbol, confidence), `keys[]`,
  `tempo[]`, `meter`, `edits[]` (user fixes). All screens derive from Timeline + position, so D-04 labels come free.
- **Clock** `{positionMs(), playing, onJump}`. `SpotifyClock` polls `GET /me/player` every 1 s (5 s paused, off when
  hidden), corrects by RTT/2, interpolates with `performance.now()`, treats jumps > 400 ms as seeks, adds a
  per-output-device offset (tap-along calibration). `AudioClock` = Web Audio clock (exact). `ManualClock` = demos/tests.
- **theory.moment()** (pure): current/next chords + beat countdowns, Roman numeral, key-change countdown, lens scale,
  staff note model, guide-tone moves, ii–V–I spans. React re-renders on chord/beat change; playhead is a CSS transform.
- **Generated tracks:** Chart → `band` (walking bass, rootless comping, drums by style) → Web Audio events, and
  Chart × tempo → exact Timeline. The screens need no special case.

## Milestones (handoff file in brackets)
| M | Scope | Exit criteria |
|---|---|---|
| **M1** Sync spike [`M1-sync.md`] | Monorepo scaffold; minimal PWA on Pages, installed on the iPhone; Spotify PKCE; `SpotifyClock`; debug overlay + remote log; drift probe (mic onsets of a metronome track vs predicted position). SP1, SP2, SP8 | Opened from the Home Screen icon, login survives a restart; 10 min after calibration: median \|drift\| ≤ 60 ms, p95 ≤ 150 ms (D-03); re-lock ≤ 1.5 s after seek/skip/pause; numbers quoted |
| **M2** Theory + chart model [`M2-theory.md`] | Port the sketch engine to `packages/theory` and extend: full chord grammar (6, 9/11/13, sus, alterations, add, slash, N.C.), secondary/borrowed numerals, key regions, lenses, guide tones, ii–V–I. `packages/model`. `irealb://` parser (SP6) | `pnpm test` green, ≥ 200 cases; every chord in a 1300-tune iReal playlist parses (target 0 failures, any listed); 12 keys × 3 instruments round-trip; snapshots match the sketch's tune |
| **M3** Companion + store [`M3-analysis.md`] | Capture helper (SP3), Spotify watcher, analysis (SP4), upload; Worker `PUT/GET /timelines/:id`, `/log`. Audio deleted after analysis | 10 real tracks (≥ 5 standards) analysed unattended; per-beat chord accuracy (MIREX sevenths) ≥ 65% on 3 hand-aligned charts; beat F ≥ 0.9; key regions right on 4/5; schema-valid; phone fetches it. *M3 (D-36): pop songs first, so the 10 came from the user's playlist and truth is 2 pop + 2 jazz/Latin; results in `M3-analysis.md`* |
| **M4** Shell + Stand [`M4-stand.md`] | 5 tabs, Stage/Paper tokens, fonts, Settings (instrument, lens, Staff/Keys, theme), IndexedDB, offline; portrait Stand on a recorded timeline (`ManualClock`); staff, keyboard, source and sync badges | User approves Stand next to the sketch; no task > 50 ms over 2 min on the iPhone; works in airplane mode; Playwright WebKit smoke tests pass |
| **M5** Live + Lead sheet [`M5-live.md`] | `SpotifyClock` → screens; fetch + cache by track ID; 4 sync states; empty state; landscape lead sheet + rail; tap-to-seek; calibration UI | An M3 track played from the iPhone and from the PC stays on the right chord for a whole tune (≤ 1 visible lag per chorus); rotation keeps position; cached timeline works offline |
| **M5b** Playlist inbox [`M5b-inbox.md`] (user, added during M5) | A Spotify playlist is the inbox and the library of analysed songs: add a song to it in any Spotify app and it is queued for analysis automatically. `mqc inbox set <playlist link>` saves the playlist id in the companion config. `mqc watch` checks the playlist's `snapshot_id` every ~10 min (one light request), reads the tracks only when it changed, and queues every track not already stored or queued (`POST /api/queue/:id` with the secret, title and artist from the playlist). Analysis then runs under the M5 idle rule, so it never takes playback from the Fire TV. Songs stay in the playlist once analysed, so playing it anywhere gives a set where every song has chords; removing a song deletes nothing. Phone: Tracks lists the playlist with Analysed / Queued / Working / Failed per song, a retry for failures, and tap to open (needs `playlist-read-private` on the PWA, so one re-login; this also answers D-43, the phone can't list the store). Quota blocks on playlist reads (D-35) back off and are logged, never crash the watcher, and the phone's "Analyse on the PC" button keeps working meanwhile | 3 songs added from the phone's Spotify app show in `mqc queue` within 15 min; with Spotify idle they are analysed unattended and open with chords on the Fire TV; songs already analysed are skipped; a song removed and re-added is not analysed twice; a simulated 429 on the playlist read leaves the watcher running and it catches up afterwards; Tracks shows the right state for each |
| **M6** Backing tracks [`M6-backing.md`] | Tracks tab, `AudioClock`, band engine (SP5), key/tempo/style/mute/count-in, iReal import, Drills, On Spotify search + play + A–B loop | 1300-tune playlist imports; 60–300 BPM, jitter < 5 ms, no dropouts in 10 min on the iPhone; screens show exact chords; Spotify loop gap ≤ 500 ms |
| **M7** Listening + Predicted [`M7-listen.md`] | Mic worklet → beat-synced chroma → decoder (templates + HMM; ONNX only if it wins SP7), biased by cached timelines; chorus-consensus Predicted; link + align an iReal chart (bonus for standards; pop comes first, D-36; pop charts often differ in bar structure from the recording, so alignment needs insert/delete, not only repeats); section detection if P-05 is still open; chord fixes (`edits[]`); upload live timelines (D-09) | 3 tracks over speakers: chord within 1 beat, ≥ 55% per-beat with the user silent, confidence shown while playing; linked chart raises accuracy (before/after quoted); fixes persist |
| **M8** Map, Coach, polish [`M8-polish.md`] | Song map (passes, key bands, seek, totals, loop span), Scale coach (next 8, lenses, landing note, ii–V–I tips), settings, error states, battery/perf, export | A week of real practice on the device; bug list triaged; all five tabs work |
| **M9** Melody + Solo view [`M9-melody.md`] (user, added during M5) | Follow the lead vocal or instrument with its notes in your key. **Companion:** during the same capture (no extra replay) separate the lead (vocals stem; the melodic "other" stem for instrumentals) and transcribe it to notes (SP9), onsets snapped to the beat grid, stored as an optional `melody[]` in Timeline v1 (`startMs`, `endMs`, `midi`, `confidence`, plus the stem it came from). Tracks analysed before M9 are re-queued through the M5 queue, since captured audio is deleted (D-18). **Phone:** a Solo view on Stand (Chart / Solo switch, both orientations, best sideways): the melody scrolls on a large staff in written pitch for the instrument (D-05), spelled in the current key and moved by octaves into the instrument's comfortable range, with a playhead, two bars of look-ahead, rests for gaps and names under the notes; the current chord above; and the scale below at full width with the melody's notes marked on it, so the scales get the space a solo needs. Low-confidence notes are drawn lighter | On 3 pop songs from the user's playlist the user can play the melody along on alto from the Solo view on at least 2; note F-measure (50 ms onsets, ±50 cents) quoted on any song with a reference transcription; separation + transcription add at most 2× the track length on the PC; the Solo view keeps the M4 render budget (no frame over 50 ms) |
M1–M5 already make a usable app for analysed tracks. M5b, M6, M7, M8 and M9 are independent of each other.

## Spikes (time-boxed inside the milestone named)
| ID | In | Question | Fallback |
|---|---|---|---|
| SP1 | M1 | Does the Spotify OAuth redirect come back into the standalone Home Screen app with its storage intact? | Worker token broker: log in once in Safari or on the PC, pair the PWA with a code |
| SP2 | M1 | Current Spotify dev-mode rules (user cap, Premium owner, endpoints); what `timestamp` means next to `progress_ms` | RTT/2 correction only |
| SP3 | M3 | Per-process loopback of Spotify.exe: Rust `wasapi` app-loopback vs Microsoft's C++ ApplicationLoopback sample | System loopback (`pyaudiowpatch`), other apps muted |
| SP4 | M3 | Chord bake-off: Chordino (NNLS), BTC large-vocab, madmom maj/min baseline, on 5 tracks with chart truth | Chordino + chart alignment |
| SP5 | M6 | iOS Web Audio: silent switch (`navigator.audioSession`), output latency, scheduler jitter, sample size offline | Smaller sample sets; `smplr` |
| SP6 | M2 | iReal `irealb://` format (obfuscated chord string, playlist HTML): reuse `ireal-reader` or write our own | Own parser tested on the corpus |
| SP7 | M7 | Mic in the standalone PWA: raw constraints (no AGC/NS/EC), worklet CPU, chroma quality over speakers | Coarser chroma, more timeline bias |
| SP8 | M1 | Screen Wake Lock in the standalone PWA on the iPhone's iOS version | Silent looping video |
| SP9 | M9 | Melody from a mix: vocal separation (Demucs-class) then transcription (basic-pitch vs pYIN/CREPE on the stem); note accuracy on pop vocals, octave errors, slides and vibrato, CPU time per track on the PC | Pitch contour only (no notes) drawn on the staff; melody shown for choruses only where it is clearest |

## Risks (likelihood / impact)
| Risk | L/I | Mitigation |
|---|---|---|
| Spotify restricts dev mode or player endpoints | M/H | Spotify isolated in `SpotifyClock`; backing tracks and drills don't need it. *Seen in M3: playlist reads hit a 24 h `QUOTA_EXCEEDED` while player endpoints kept working (D-35); M6's "On Spotify" browsing must cope* |
| Bluetooth/AirPlay latency breaks 150 ms | H/M | Per-device offset, tap-along calibration, "calibrate" badge |
| Jazz chord recognition too weak | H/H | Chart alignment, user fixes, confidence shown, Predicted from repeats. *M3: pop 0.70–0.85, jazz/Latin 0.54–0.64 MIREX sevenths (D-34)* |
| iOS PWA limits (no background work, audio session quirks) | M/M | Dashboard stays on screen (wake lock); SP5/SP8 run early |
| No remote Web Inspector | H/M | Debug overlay + remote log from M1 |
| Melody transcription wrong (octave jumps, slides, backing vocals) | H/M | Confidence shown, notes snapped to the key and beat grid, octave folding into the instrument's range; user fixes later (as `edits[]`) |
| Scope: 8 milestones for a solo user | M/M | Usable after M5; later milestones can be cut independently |
| Copyright | L/L | Personal use; captured audio deleted; only derived timelines kept |

## Built
- `handoffs/02-dev-plan.md` (this) · `handoffs/README.md` stage table → M1–M8 · `handoffs/DECISIONS.md` D-14..D-22 · `CLAUDE.md` stage → M1

## Verified
- No code this stage. From the sketch's `<script>` (lines 773–992): 7 chord types (maj, maj7, m7, 7, m7♭5, °7, 7♯5)
  and 17 scales, so M2 has to widen the chord grammar.

## Open
- [ ] user: create a Spotify app at developer.spotify.com (Web API) and have the client ID ready in M1 (redirect URI set once the Pages URL exists)
- [ ] user: free Cloudflare account, ready to connect the GitHub repo to Pages in M1
- [ ] user: check the iPhone's iOS version (Settings → General → About), needed for SP1/SP5/SP8
- [ ] user, by M2: download a "Jazz 1300" iReal Pro playlist from the iReal forum (the parser corpus)
- [ ] M1: SP1/SP2 results may change auth (token broker, D-17) · M3: accuracy targets are guesses until SP4

## Skip
- `handoffs/00-brief.md`, `handoffs/01-design.md` — summarised here and in DECISIONS.md
- `design/sketchbook.html` — open only its `<script>` block (M2 port) or `staffSVG()` (M4)

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/02-dev-plan.md. Then do M1: scaffold the monorepo,
deploy a minimal PWA to Cloudflare Pages, Spotify PKCE login and SpotifyClock, and measure drift on my
iPhone (spikes SP1, SP2, SP8). Ask me for the Spotify client ID when you need it.
```
