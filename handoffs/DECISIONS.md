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

## Pending

(none)
