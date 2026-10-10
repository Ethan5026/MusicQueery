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

## Pending (resolve at the end of S1)

- **P-01** Approve the design direction (Stand, Lead sheet, Song map, Scale coach), or list changes.
- **P-02** Saxophone: alto, tenor, or both. Sets the default transposition.
- **P-03** Chord timeline source. Options in `00-brief.md` § Chord timeline options.
- **P-04** Build machine and stack: Mac available (native SwiftUI) or Windows only (Expo/React Native + EAS cloud builds).
