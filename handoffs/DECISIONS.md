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

- **D-46** (M5, user asked where phone-triggered analysis fits) Analysis queue: the phone queues a Spotify track with
  `POST /api/queue/:id`, authorised by its Spotify token (the Worker checks `/v1/me` against `ALLOWED_SPOTIFY_USERS`), since the
  phone has no store secret (D-32). `GET /api/queue/:id` is public; listing, updating and deleting need the secret; uploading the
  timeline clears the request. `mqc watch` analyses only after Spotify has been idle on every device for `--idle-minutes`
  (default 10), because capture plays the track on the PC and Spotify has one active device per account, so it would take
  playback from the Fire TV. KV is eventually consistent: a new request reached the list after ~15 s.
- **D-47** (M5, user) New milestone **M5b Playlist inbox**: a Spotify playlist where adding a song queues it for analysis and
  analysed songs stay as the practice set; scope and exit criteria in `02-dev-plan.md`. Independent of M6–M8.

- **D-48** (M5, user) New milestone **M9 Melody + Solo view**, planned rather than started in M5: it needs a new analysis step on the
  PC (lead separation + note transcription, spike SP9), an optional `melody[]` in Timeline v1 (additive, so v1 stays valid), and a
  re-capture of tracks analysed before it (audio is deleted, D-18). The Solo view gives the melody in written pitch for the instrument
  and the scale at full width. Independent of M5b–M8.

- **D-49** (M5) Two drivers behind Stand: `spotify` (SpotifyClock) and `manual` (ManualClock). Spotify takes over on a lock, a
  track change, or play; it loads the timeline by track ID (IndexedDB, then the store, re-checked in the background so a
  re-analysed track replaces its cached copy). Opening a recorded track in Tracks hands back to the manual clock. When Spotify has
  nothing active the chart holds where it was on the manual clock, paused. A logged-in first run shows "Nothing playing"; a
  logged-out one opens the demo. Play/pause/seek on Stand go to Spotify on whatever device plays (seek aims for the chart position:
  minus offset and start bias).
- **D-50** (M5) Sync badge from `syncState()`: Not connected (logged out, or polls failing > 5 s), Re-syncing (first 1.2 s and two
  samples of a segment, or no answer for > 2.5 s while playing), Paused, Not playing (no active device), else ±ms = half the best
  RTT + median spread of the origins, rounded up to 10 ms. Departs from the sketch: the chart keeps moving while re-syncing rather
  than freezing, since the music doesn't stop for a network hiccup.
- **D-51** (M5) Calibration = tap-along on an analysed track: each tap's chart position against the nearest beat; after 2 warm-up
  taps, taps more than a third of a beat off are ignored; median of the last ≤ 24 (min 8) is the correction, half the IQR shown as
  steadiness. Earlier/Later nudge 10 ms. Offsets per Spotify device id in localStorage, with names, listed in Settings → Speakers.
  No fixed allowance for human tap anticipation; the nudges cover it.
- **D-52** (M5, user) Landscape Stand = lead sheet + play panel. Chart: 4 bars a line (new line at a rehearsal letter or pass),
  chords sized by duration, a chord carried over from the bar before drawn faded, key marks, double bar at the end of a pass,
  current row kept second from the top, tap a bar to seek. Panel: Play mode and Staff/Keys switches, the chord, and a two-staff
  system named in the margin: Now (the Play mode's view, no key-change preview) and Next = the first coming chord whose notes
  differ (16 chords ahead), muted with the changing notes in rust and a countdown that turns rust in the last 4 beats. Settings →
  "Next scale" hides it for one larger staff. Both Stand screens have a Concert / Alto / Tenor switch (replacing the cycling button).
- **D-53** (M5) Live e2e tests mock `/me/player` with a fake player and run with service workers blocked, because WebKit's
  Playwright stops routing fetches once a service worker controls the page (the smoke suite's offline test still covers the SW).
  A test fails if portrait Stand needs scrolling in any Play mode (it was already 6 px over before M5; the Play card was tightened).

- **D-54** (M5b, departs from the M5b plan's phone-side read) Playlist inbox. `mqc inbox set <link>` saves the playlist id in the
  companion config. `mqc watch` asks for `GET /playlists/{id}?fields=snapshot_id,name` every `--inbox-minutes` (10) and reads the
  tracks (`/items`, falling back to `/tracks`) only when the snapshot changed; it queues every song not stored and not in the queue
  in any state (`POST /api/queue/:id` with the secret; a failed one is retried from the phone, not on every playlist edit), then
  mirrors the playlist to the Worker: `PUT /api/inbox` (secret; ≤ 300 songs, duplicates listed once). `GET /api/inbox` is public,
  like timelines, and adds each song's state (analysed | queued | working | failed | new) from the `tl:`/`q:` keys, 2 KV reads a
  song. The phone lists that mirror and never reads playlists from Spotify, so it needs no new scope or re-login and adds nothing
  to the quota that gets blocked (D-35). The cost: a song shows on the phone only after the PC has seen it (≤ 10 min, PC on).
  A restarted watcher takes the last snapshot from the mirror (one light request, no full read).
- **D-55** (M5b) Quota blocks on playlist reads (`RateLimited`, Retry-After > 30 s) make the inbox wait out the Retry-After (at least
  the 10 min), log the next try, and write `blockedUntil` into the mirror with the last good list; the phone says so until the time
  passes, and the first successful read clears it. Seen on 2026-10-11: `/me/playlists` refused for 29 464 s (≈ 8 h).
- **D-56** (M5b) `mqc watch` lists the queue (a KV list, 1000 a day on Cloudflare's free plan) only when needed: every loop while
  Spotify is idle and there is work, every 3 min while idle with nothing to do, every 10 min while Spotify plays; and right after
  the inbox queued something. What the watcher just finished overrides the lagging list for 2 min (done → dropped, failed stays
  failed), so a KV echo can't start the same analysis twice.

- **D-57** (M6) `packages/band` (pure TS) turns a chart into band events. `formFromChart` uses the same expansion and chorus count
  as `chartTimeline`, so beat b is at b × 60000 / bpm ms on both. `Arranger.bar(i)` returns one bar of piano, bass and drums,
  seeded by (seed, bar) so a bar sounds the same after a seek; voice leading carries over only between consecutive bars.
  Styles: swing, ballad, bossa, waltz, pop, funk, plus drone, with iReal style text mapped by keyword (`styleFor`) and swing
  flattening from 2/3 at ≤ 120 BPM to 0.55 at 260. Bass walks (root on each chord, chord tones towards the next root, then an
  approach note) or plays the style's pattern. Piano uses rootless A/B voicings for 7th chords (5th → 13th on dominants) and
  close triads otherwise, nearest the last voicing; off-beat hits just before a change anticipate the next chord. Built-in
  tunes (12) and drills (7, all-keys ones cycling up a fourth from the user's key) are plain Chart v1, so they get exact timelines.
- **D-58** (M6, SP5, supersedes D-21's "Tone.js or smplr") Own sampler and scheduler on a self-hosted kit: Salamander piano
  every minor third A1–C7 (CC BY 3.0), Smolken double-bass pizz (CC0), 11 VCSL drum hits (CC0). 44 mono mp3s, 1.7 MB, precached
  by the service worker. At load each buffer's onset (first sample > 5% of peak, less 2 ms) is skipped, because mp3/AAC encoder
  padding would make every note late, and it is normalised to its peak. Credits are in Settings and `public/samples/CREDITS.md`.
- **D-59** (M6) `BandEngine` (`audio/engine.ts`) is the AudioClock and the third Stand driver, `'audio'`. A 25 ms timer
  schedules whole bars once they start within 250 ms. The audible position comes from `getOutputTimestamp()` (fallback:
  currentTime − outputLatency). A count-in (0–2 bars of cross-stick, on every start from pause) holds the chart at the top.
  Tempo, key, style and chorus changes keep the beat and apply while playing. The AudioContext uses `latencyHint: 'playback'`
  and is unlocked inside the Play tap with `navigator.audioSession.type = 'playback'`. While the band plays, Spotify takes over
  only when it starts playing (the band pauses); starting the band pauses Spotify. A saved session can be a `BandSpec`.
- **D-60** (M6) The A–B loop on Stand works on bar lines for every driver: tap on the first bar, then on the last, then again
  to clear. The band loops exactly in the scheduler; the manual clock seeks in its frame tick. Spotify sends the seek back to A
  `lead` ms before B; the lead starts at 150 ms and is learned from how long each jump took to land (80–800 ms, `loop.jump` log).
- **D-61** (M6) iReal import: `GET /api/ireal/playlists[/:n]` relays irealpro.com's official playlist page (one fixed URL,
  edge-cached a day; the PWA can't fetch it cross-origin), or the user pastes an irealb:// link or picks a file. Charts are
  stored 100 per IndexedDB `charts` record, with an index of every chart in `settings/chartIndex`: WebKit pays per record,
  and Jazz 1460 took 24.5 s as one record per chart against 2.1 s chunked (Playwright WebKit on Windows).
- **D-62** (M6) On Spotify: search with `/search?type=track&limit=10` (a player-side call, unaffected by D-35's playlist blocks).
  Each result's state comes from `GET /api/status?ids=` (≤ 10, public, 2 KV reads each, shared with the inbox's logic), and a
  pick plays with `PUT /me/player/play {uris}` on the last known device. Unanalysed picks get the M5 Analyse button.
- **D-63** (M6) Playwright's WebKit on Windows has no `AudioContext`, so band e2e tests install a fake one (clock on
  `performance.now()`, silent buffers). The real sound, latency and timing are checked by the SP5 card on the iPhone. Without
  Web Audio, Play explains why on the band card instead of opening a paused Stand.

- **D-64** (M7, SP7 offline) `packages/listen` (pure TS, Worker on the phone, Node for evaluation) decodes chords from audio:
  decimate to ~11 kHz → STFT 4096/hop 512 → log-frequency spectrum (3 bins a semitone, A1–C7), running tuning, whitening,
  NNLS note activations (Chordino-style) → bass + treble chroma; an online beat tracker (spectral-flux onsets ~86 Hz,
  autocorrelation tempo with a 110 BPM prior, Ellis DP, beats final one period late); 61 states (maj, min, 7, maj7, m7 × 12
  + N.C.), binary templates (treble 20 × cosine + bass 8 × log root share, 7ths −0.6), beat HMM stay 0.85 with a key-aware
  change prior; chorus consensus averages each beat's evidence with its repeats (beat-chroma self-similarity, diagonal
  window 12, threshold 0.8). Learned per-quality profiles scored no better (65.9 vs 65.7 majmin), so none are shipped.
  Measured on the 7 human-annotated pop songs per beat (majmin/sevenths): truth beats 65.7/46.9, + consensus 70.5/52.3.
  The yardstick is the companion's MIREX rules ported to TS (`score.ts`); `room.ts` simulates speaker + room + mic.
- **D-65** (M7) Live display: the shown chord is the forward filter carried over the last 0.2 s of frames, no hold, and the
  Predicted chord at that moment gets +8 × its confidence; beats 4 behind are settled by short Viterbi; a segment's end
  re-decodes it with two-way consensus for saving. Clean: shown 61.2% majmin, 291 ms behind a change (84% within a beat);
  simulated room 50.8%, 386 ms. Mic chain: raw `getUserMedia` (EC/NS/AGC off), its own AudioContext, `audioSession`
  'play-and-record' while listening; an AudioWorklet posts 2048-sample chunks straight to the decoder Worker over a
  MessagePort; the main thread sends anchors (context frame → `performance.now()` via `getOutputTimestamp` →
  `clock.positionMs`) 5×/s, so the Worker works in track ms. A seek, pause, track change or stop ends the segment; iOS
  stops the mic in the background, so hiding the app stops listening.
- **D-66** (M7, D-09) Live timelines are kept apart from analysed ones so a listen never replaces an analysis: IndexedDB
  `timelines/live:<id>`, store `PUT /api/live/:id` (KV `lv:`, Spotify-token auth like D-46, `source` must be 'live'),
  public GET. `loadTimeline` falls back to them when the store has no analysis; a later listen is laid over an earlier one
  (`mergeLive`), and the earlier one is the decoder's prior (+3 × confidence) and the look-ahead. On a live timeline
  everything ahead of now is a prediction: Up next reads "Up next · Predicted" in grey. The badge says "Listening live"
  while the mic is on and "Heard live" for a saved listen (a wording beyond D-04's three).
- **D-67** (M7) Chord fixes are stored per track apart from timelines (IndexedDB v3 `edits`, `PUT /api/edits/:id` → KV `ed:`,
  ≤ 500), so re-analysis and new listens keep them; they apply by time span over whatever is shown (`effectiveChords`).
  Tap the chord on Stand: the picker shows written pitch for the instrument and stores concert; "every <chord> in this
  song" fixes all of them at once; "Undo all my fixes".
- **D-68** (M7) Linking a chart: `alignChart` runs Jump Alignment of the chart's playing order on the timeline's chord labels
  (so it works on the phone, for analysed and live timelines): next beat 0, hold/skip −1.5, bar line → any bar line −3,
  form end → top −1, free (intro/solo) −0.4 a beat; 12 transpositions × tempo ratios ½, 1, 2. It is trusted only when
  roots agree on ≥ 50% of matched beats and it jumps ≤ 0.18 times a bar (right charts 0.03–0.14, another song's 0.17–0.48:
  5/5 refused). Where it matches, the chart's chord names and rehearsal marks replace the timeline's. iReal Pop 400 on
  5 truth songs, live decode: clean majmin 69.7 → 80.4, sevenths 50.5 → 64.8; simulated room 63.7 → 68.9, 46.0 → 54.9.
  The link (settings `link:<id>`) is re-aligned whenever the track opens.
- **D-69** (M7) SP7 tooling: Settings → Diagnostics → Mic test listens even on an analysed track and scores the shown chord
  against the analysis per beat as it plays (root + third), with mic settings, level and CPU; Stop saves and uploads the
  live timeline, and `pnpm --filter @mq/listen score-live` scores it on the PC against the human truth with the best time
  shift (the mic offset). Playwright gets a fake mic (`e2e/fake-mic.ts`) that streams a synthesised loop into the real
  decoder Worker, as D-63 did for the band.

- **D-70** (M7, SP7 on the iPhone, Let It Be on the Fire TV, test mode) Over real speakers the mic decodes well: shifted by
  −2.55 s the saved chords score majmin 89.7%, sevenths 77.9% per beat over 100–185 s (86–96% in each third, no drift;
  75% over 8–31 s at −2.05 s), above the simulated room (D-65). As saved they are ~2.5 s late (majmin 10%), so the
  exit is not met until the offset is found and corrected and 3 songs are re-tested. `score-live` searches ±5 s per
  stretch of listening.
- **D-71** (M7 follow-up, user) The mic's timing is parked. Scored against the analysis in 60 s windows (`score-live --track`),
  the saved chords' lateness holds steady within a listen but changes from one start to the next: As 0.8 s over 6½ min,
  Let It Be 1.9, 2.4 and 3.75 s (so it is not the speaker's lag, and probably iOS's mic buffering). The user stopped here:
  Spotify sync of analysed timelines is what matters. Kept: the echo test (phone round trip, taken off the anchors when
  measured), "Mic lag" shown on the Mic test card but never written into a speaker offset (that would move Stand's sync),
  screen kept on while listening. If it comes back: an inaudible 18–20 kHz probe measured at every start, then
  continuously. SP7's "3 tracks ≥ 55%" exit is not met for saved times; recognition itself is (D-70).

- **D-72** (M8) Song map tab. A chart-derived timeline (band, drills, linked chart) gets one row per pass: bars before the form
  are "Intro", each pass of the repeated chart bars "Chorus n" (a new row where the form restarts), bars after it "Ending";
  rehearsal letters are ticks above the rows. A recording without passes (P-05) gets rows of 16 bars named by start time.
  Strips are drawn to the longest row's scale. Each bar takes the key at its middle; colour = circle-of-fifths hue of the
  concert key, a minor key taking its relative major's hue; N.C. bars are grey. Key areas count bars per key over one chorus
  (form) or the track, the most held marked home, names in written pitch. Tap a strip to jump to that bar, a row name to its
  start. The loop card offers the rehearsal section under the playhead (else its 8-bar phrase) through Stand's A–B loop (D-60).
- **D-73** (M8) Scale coach tab: the next 8 changes from the one sounding (N.C. skipped), each with its scale under the lens
  (the same setting as Stand's), function in the key, and the 3rd to land on, all written pitch; a tap jumps there; on a live
  timeline the rows ahead are grey (predicted). The tip comes from the analysis' ii–V(–I)s within those 8 changes, and the
  guide-tone line is described from its own notes ("A♭ falls a half step to G, then G holds"), because the sketch's fixed
  sentence ("holds over as the 7th of the I") is wrong when the I is a triad, as in most pop.
- **D-74** (M8) Polish. Settings → Chord style: maj7 · m7 or Δ7 · –7 (ø7, –Δ7), display only, applied in `ChordSym`, so every
  screen follows; stored chords stay canonical (D-29). Every tab renders inside an error boundary that logs `ui.crash` and
  offers Try again / Reload. Map and Coach say why they are empty (nothing open, the playing song has no chords, opening).
  Stand, Map and Coach share `useShown()` (live ?? linked ?? timeline, plus fixes). Map rows re-render only when the playhead
  changes row. The sketch's "Look-ahead 4 changes" setting is not built: portrait Stand has no room for more (D-53).
- **D-75** (M8) Export = Share chords on the Map: the open song as a plain-text lead sheet (four bars a line from `buildSheet`,
  rehearsal letters, key changes, % for a repeated bar, written pitch and chord style) to the iOS share sheet, or the
  clipboard where there is none. Not a data backup: fixes and listens are already in the store; prefs, speaker offsets and
  links live only on the phone.

## Pending

- **P-05** (M3) Sections. Harmony-only segmentation (bar self-similarity of chroma + chord roots) found about half the boundaries
  on standards and none on Let It Be (verse and chorus share chords), so analysed timelines carry no section labels. Decide by
  M5 (lead-sheet rehearsal letters) or M8 (Song map): chord-repetition analysis, a structure model, or chart alignment.
  *M5: the lead sheet works without letters on analysed tracks (bar numbers, key marks); deferred to M7 or M8.*
  *M7: chord-repetition sections (`findSections`, bar self-similarity stripes) scored boundary F@3 s 0.65 on human chords,
  0.43 on the PC's analysis and 0.23 on live chords (4 songs, Isophonics segments), so automatic letters are not shown;
  a linked chart's rehearsal marks are the sections for now (D-68). Decide in M8 (Song map).*
  *M8: the Song map uses passes and rehearsal marks where a chart provides them, and 16-bar rows named by time otherwise
  (D-72); automatic sections stay off. Still open, for when the map is used on pop songs.*
- **P-06** (M3) Key regions: `detectKeys` gives A minor for Fly Me to the Moon (C major) and E♭ major stretches inside
  Mas Que Nada's F minor (B♭m7–E♭7 bars). Main key right on 3 of 4 truth tracks. Revisit the emission weights with the truth set.
