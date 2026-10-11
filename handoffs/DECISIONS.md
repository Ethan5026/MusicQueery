# Decisions

Append only. To reverse a decision, add a new one that supersedes it (e.g. "D-09 supersedes D-03").

## Frozen

- **D-01** (S0) Target device: iPhone 17 (402×874 pt), portrait and landscape. Personal use first.
- **D-02** (S0) Spotify supplies only track identity and playback state/position. It provides no
  key, tempo, sections or chords: Audio Features and Audio Analysis closed to new apps on 2024-11-27.
- **D-03** (S0) Sync method: poll playback about once a second and interpolate between polls on the
  device. Target: within 150 ms of audible playback.
- **D-04** (S1) Every screen shows where its chords came from: Analysed (saved timeline),
  Listening live, or Predicted. Look-ahead features need an Analysed timeline.
- **D-05** (S1) Instrument views: Concert, E♭ alto (written a M6 above concert), B♭ tenor (written a M9 above,
  shown as pitch class). Chords, keys, scales and keyboard transpose. Roman numerals don't.
- **D-06** (S1) Theory output: Roman numeral in the current key, scale per chord under three lenses
  (Inside, Bebop, Colour), chord tones, guide-tone (3rd/7th) motion into the next chord, ii–V–I detection.
- **D-07** (S0) Process: one session per stage, handoffs per `handoffs/README.md`, commit and push to
  origin/main at the end of every stage.

- **D-08** (S1, was P-02) Saxophone views: both E♭ alto and B♭ tenor in the quick toggle, alto first. Concert stays the piano view.
- **D-09** (S1, was P-03) Chord timeline source: Windows desktop companion (per-process WASAPI loopback of the
  Spotify app → analysis → timeline keyed by Spotify track ID) plus live detection from the phone mic,
  sharing one timeline cache. Predicted-from-form fills gaps (D-04).
- **D-10** (S1, was P-04) No Mac. Build with Expo/React Native from Windows, with EAS cloud builds and TestFlight.
  Native audio work goes in Expo native modules, kept small so they can be ported.
- **D-11** (S1, was P-01) Scale suggestions are drawn on a treble staff: the current chord stacked as whole
  notes, a barline, then the scale ascending through the octave with note names underneath. Accidentals
  are written on every note (no key signature). Brass = chord tones, steel = guide tones. Sax views
  show written pitch. A Staff/Keys switch swaps in the keyboard. Landscape rail uses the same setting.
- **D-12** (S1, was P-01) New Tracks tab (five tabs: Stand, Tracks, Map, Coach, Settings) with three
  backing-track sources: **Generated** (in-app piano/bass/drums from a chord chart, with key, tempo
  and style controls, per-instrument mute, and iReal Pro playlist import for a large standards library),
  **On Spotify** (search play-along and minus-one recordings, analysed like any track), and **Drills**
  (all-12-keys progressions, blues, Coltrane changes, modal vamps, drone). Generated and Drills tracks
  give exact chords with no analysis, using the app's own clock in place of Spotify sync.
- **D-13** (S1) Proposed milestones now M1–M7, with M6 = Backing tracks. S2 finalises.

- **D-14** (S2, supersedes D-10) No Mac and no Apple Developer membership, so the app is an installable PWA
  (Safari → Add to Home Screen), served over HTTPS from Cloudflare Pages. No Expo, EAS or TestFlight.
- **D-15** (S2) Stack: pnpm monorepo, TypeScript strict. `apps/web` is Vite + React 19 + Zustand + vite-plugin-pwa +
  IndexedDB. `packages/theory` (pure TS) and `packages/model` (zod schemas → JSON Schema). Vitest, Playwright WebKit.
- **D-16** (S2) Architecture: every screen is derived from a Timeline v1 and a position from a Clock
  (SpotifyClock | AudioClock | ManualClock) through a pure `theory.moment()`. No screen talks to Spotify directly.
- **D-17** (S2) Timeline store: Cloudflare Worker + KV keyed by Spotify track ID (or chart ID), one bearer secret.
  Also takes remote debug logs, and may act as the Spotify token broker if SP1 fails.
- **D-18** (S2) Companion: Python 3.12 (uv) analysis pipeline with a small native capture helper for per-process
  loopback (SP3). Captured audio is deleted after analysis; only timelines are stored.
- **D-19** (S2) The user has Spotify Premium, so playback control (play, seek, A–B loop, play-alongs) is in scope.
- **D-20** (S2) Charts and timelines use the project's own versioned JSON schemas. iReal Pro `irealb://` playlists
  are imported by a TS parser into Chart v1.
- **D-21** (S2) Band engine runs on Web Audio: a look-ahead scheduler on the audio clock with sampled piano, bass and
  drums (Tone.js or smplr, decided by SP5). Generated tracks emit an exact Timeline.
- **D-22** (S2, supersedes D-13) Milestones: M1 Sync spike · M2 Theory + chart model · M3 Companion + store ·
  M4 Shell + Stand · M5 Live wiring + Lead sheet · M6 Backing tracks · M7 Listening live + Predicted ·
  M8 Map, Coach, polish. Exit criteria in `handoffs/02-dev-plan.md`.

- **D-23** (M1, supersedes D-14's "Cloudflare Pages" and D-17's separate Worker) Cloudflare now creates Pages projects as
  Workers, so one Worker (`apps/worker`, name `musicqueery`) serves the PWA as static assets and the API under `/api/*`,
  same origin: https://musicqueery.ethangruening.workers.dev. Deployed from the dev machine with `pnpm ship`, not Git integration.
- **D-24** (M1, SP1) Spotify Authorization Code + PKCE runs in the Home Screen app itself: the redirect comes back into the
  standalone app with its storage intact, and login survives a force-quit. No token broker.
- **D-25** (M1, SP2) Spotify dev mode (since 2026-02): owner needs Premium, at most 5 allow-listed users; refresh tokens expire
  6 months after the first login; player endpoints are available. `/me/player` `timestamp` is when the playing device last
  reported; between reports the server extrapolates `progress_ms`.
- **D-26** (M1, refines D-03) SpotifyClock: RTT/2 correction, origin = median of the lowest-RTT third of samples since the last
  jump; a new `timestamp` re-anchors at once ('resync'). After a fresh start (seek, skip, or play from a new position) reports
  run ahead of the audio until the device resyncs, so a per-device start bias is learned from those resyncs and applied until
  the next one (Fire TV ≈ −310 ms). Measured: median |drift| 2.9 ms, p95 13.9 ms over 11 min.
- **D-27** (M1, SP8) Screen Wake Lock works in the standalone PWA on iOS 27; no silent-video fallback.
- **D-28** (M1) The user mostly plays through Fire TV devices (Spotify Connect). Sync acceptance tests (M5) run on a Fire TV.

- **D-29** (M2) Chart v1 (`mq.chart/1`) holds bars in score order with repeat, ending, segno, coda, jump and meter markers;
  `expandChart` produces playing order. Timeline v1 (`mq.timeline/1`) is in ms: beat grid, bars, chords, keys, tempo, `edits[]`.
  Chord symbols are stored as `@mq/theory`'s canonical text (Unicode ♭/♯, e.g. `B♭m7`, `C7♯5`, `F/A`, `N.C.`) and notes are
  spelled (E♭ ≠ D♯). Timeline `source` adds `exact` (charts, Generated and Drills tracks, D-12) to the three of D-04.
  JSON Schema goes to `packages/model/schema/` for the Python companion.
- **D-30** (M2, SP6) Our own `irealb://` parser in `packages/theory` (no `ireal-reader` dependency). The test corpus is iReal's
  official Essential Playlists (Jazz 1460, today's Jazz 1300, plus Brazilian, Latin, Blues, Pop, Country), fetched with
  `pnpm --filter @mq/theory corpus` into a gitignored folder. Anything not understood goes to `issues[]` and is never dropped silently.
- **D-31** (M2) `theory.moment(timeline, positionMs, { instrument, lens })` returns everything a screen shows at one instant.
  The per-timeline analysis (key regions by Viterbi over 24 keys, harmonic functions, ii–Vs) is computed once per timeline and cached.

- **D-32** (M3, refines D-17) Timeline store: `PUT/DELETE /api/timelines/:id` and the list `GET /api/timelines` need
  `Authorization: Bearer <API_SECRET>` (a Worker secret; the companion keeps it in `%APPDATA%\MusicQueery\companion\config.json`).
  `GET /api/timelines/:id` is public so the PWA needs no secret (timelines are derived data, not audio). PUT bodies are
  validated with `@mq/model`'s zod `Timeline`, and the id in the body must match the path (`spotify:track:<22>` or `chart:<slug>`).
  KV key `tl:<id>`, metadata = source, generator, counts. The companion may also POST `/api/log` with the secret.
- **D-33** (M3, SP3) Capture is `companion/capture/mqcapture.exe` (C++, MSVC Build Tools; Rust not installed so not tried):
  WASAPI process loopback of the Spotify.exe process tree, 44.1 kHz 16-bit, plus per-packet QPC times. It captures with the PC
  muted. The capture is lined up with track time by the median of `capture time − progress_ms` over the /me/player samples:
  repeat runs agree within 1–45 ms (constant bias left to M5's calibration). The Windows desktop client accepts
  `play {uris}` with a 204 but never loads the track, so the companion starts the track inside its album (offset by URI,
  then by position when Spotify picks the wrong album track, then queue + next) and waits for the player to confirm each try.
  A failed capture deletes its audio at once.
- **D-34** (M3, SP4) Analysis pipeline: beat_this, then `regularise` (merge glitch bars, one beat level); chords from a per-beat
  root vote of BTC large-vocab (1.2), Chordino (1.0), madmom maj/min (0.8), the label taken from the heaviest recogniser on the
  winning root; beat-synced; keys by `detectKeys` and roots spelled in key (`@mq/theory` via `scripts/bridge.ts`). Triads become
  lead-sheet 7ths (`leadSheetSeventh`) only when BTC labels ≥ 18% of the track with 7th/6th chords (jazz 26–42%, pop 0.4–8%).
  MIREX sevenths per beat: Let It Be 0.85, Imagine 0.70, Mas Que Nada 0.64, Fly Me to the Moon 0.54; beat F 0.977–0.998.
- **D-35** (M3) Spotify development mode can quota-block playlist reads (`/me/playlists`, `/playlists/*`) for ~24 h
  (`429 QUOTA_EXCEEDED`, Retry-After ≈ 86 000 s) while player and track endpoints keep working. Spotify calls cap Retry-After at
  30 s and fail instead of stalling; a playlist's tracks can be found by playing it at each position. Also seen: batch
  `GET /tracks?ids=` returns 403, and `/search` rejects `limit` > 10.
- **D-36** (M3, user) Popular songs come first: recognising chords and progressions in pop songs that are in no standards list
  is the main job; iReal charts and chart alignment are a bonus for standards. Evaluation weights pop at least equally and
  jazz-only priors must be gated. New test songs come from the user's Spotify playlist "Swinging and Shredding", only when needed.
- **D-37** (M3) Ground truth without taps: chart chords (iReal, transposed if needed) laid on madmom's 4/4 downbeat grid (independent
  of beat_this; agreement with regularised beat_this F = 0.976–0.998); the form is read from the recognisers and accepted only when
  root accuracy peaks at zero beat shift. `mqc tap` (ENTER on bar lines, SPACE on beats) exists for hand-tapped truth.
- **D-38** (M3, supersedes the sevenths gate in D-34) On 7 human-annotated pop songs (D-39) the lead-sheet-sevenths step
  cut MIREX sevenths from 0.677 to 0.390 (the gate chose it on 6 of 7 → 0.506); it only "helped" against iReal-chart truth,
  which writes 7ths everywhere. Default `auto` = the 3-way vote as heard; `auto+7ths` stays as an opt-in for jazz experiments.
  Human-annotated pop, per beat: vote 0.677 (time-weighted 0.651), majmin 0.840, root 0.838; BTC alone 0.680; beat F 0.978.
- **D-39** (M3, refines D-37) The evaluation yardstick is human, time-aligned annotation: ChoCo's Isophonics and McGill Billboard
  partitions (CC BY 4.0), imported with `mqc import-annotated` and shifted onto the Spotify release by the root-agreement peak
  (±4 s). iReal-chart truths are secondary: on Let It Be the iReal truth agrees with Isophonics at root 0.93, sevenths 0.85.
- **D-40** (M3 follow-up, resolves P-07) Chart names. Chordonomicon (Kantarelis et al. 2024, CC BY-NC 4.0; 440k charts with
  Spotify ids) is indexed on the PC (`pnpm companion chart-index`); a track's chart is found by its id, else by the ids of other
  releases (Spotify search). The chart is placed by Jump Alignment (McVicar et al. 2011) in all 12 keys, but only its chord
  *names* are used: each recognised root + third takes the chart's usual name for it (Fmaj7, Am7, G7sus4), and only when the
  aligned chart agrees with the recognisers' roots on ≥ 80% of beats. Timing and roots stay the recognisers'. Timeline
  `chartId` = `chordonomicon:<row>`. Human pop, MIREX 7ths per beat: Let It Be .856→.860, Just the Way You Are .708→.708,
  It's Too Late .874→.912; Something's capo chart (74%) and Fly Me's (71%) rejected. Placing the chart's chords themselves
  scored below recognition (Let It Be .749, Just the Way You Are .638), so that is not used.

- **D-41** (M4) App shell: five tabs (Stand, Tracks, Map, Coach, Settings; tab in the URL hash). Themes from the sketch's tokens:
  Stage (dark) is the default, Paper (light), Auto; Paper paints the status-bar strip ink-dark because the standalone status text is
  always white. Fonts are self-hosted (`@fontsource` latin subsets + Noto Music's music subset) and precached with the shell.
  IndexedDB `musicqueery` v1 holds `settings` (prefs, last session), `timelines` (cache by ID) and `tracks` (titles); settings
  load before the first render, and the last timeline reopens paused where it was left.
- **D-42** (M4, user) The Play card has three modes, switched on the card and in Settings, default **Integrated**.
  Simple = the scale of the current key centre (major / natural minor), its pentatonic highlighted. Integrated = Simple plus
  callouts: a chord with tones outside the key swaps them into the scale on the same letter (rust, "C major, but F♯ over D7"),
  and a key change is announced 8 beats ahead and shown on the staff for the last 4. Advanced = the per-chord scale under the
  lens with the chord stacked and guide tones (D-06, D-11). All in written pitch for the sax views.
- **D-43** (M4) The phone cannot list the store (D-32 keeps the list behind the secret), so Tracks → Recorded shows the demo chart,
  Let It Be, every timeline cached on the phone, and a box for a Spotify link/URI/ID. Titles come from Spotify `/tracks/{id}`
  (when logged in) and are cached.
- **D-44** (M4) Render budget: Stand re-renders only when the beat or the chord changes; the progress bar moves per frame through
  refs. `perf.ts` counts frame gaps > 50 ms (Safari has no Long Tasks API) and logs `perf.window` every 30 s. iPhone: 0 in 2 min.
- **D-45** (M4) `pnpm e2e` runs Playwright 1.63 WebKit at 402×778 against `vite preview`. The offline test starts its own preview
  server and stops it, because WebKit's `setOffline` fails navigations before the service worker sees them.

## Pending

- **P-05** (M3) Sections. Harmony-only segmentation (bar self-similarity of chroma + chord roots) found about half the boundaries
  on standards and none on Let It Be (verse and chorus share chords), so analysed timelines carry no section labels. Decide by
  M5 (lead-sheet rehearsal letters) or M8 (Song map): chord-repetition analysis, a structure model, or chart alignment.
- **P-06** (M3) Key regions: `detectKeys` gives A minor for Fly Me to the Moon (C major) and E♭ major stretches inside
  Mas Que Nada's F minor (B♭m7–E♭7 bars). Main key right on 3 of 4 truth tracks. Revisit the emission weights with the truth set.
