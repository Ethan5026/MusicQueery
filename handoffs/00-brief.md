# S0 · Brief and research

**Status:** done · 2026-10-10 · **Next:** S1
**Commit:** first stage commit (see `git log`)

## Goal of this stage
Capture the request, the player, and the hard technical limits before any design or code.

## The ask
- An iPhone 17 app that works as "dashboard sheet music", in portrait or landscape.
- Live sync with whatever is playing on Spotify, accurate to the second.
- At the current point in the song: chords, key, tempo, upcoming key changes, and a suggested scale.
- Purpose: learn theory, play along, and learn to improvise on piano and saxophone.

## The player
- Intermediate. 10+ years of piano, 5+ years of saxophone, with a high-school jazz band background.
  Fluent in chord symbols, so the app can use real jazz vocabulary.
- Develops on Windows 11. Whether a Mac is available is unknown (P-04).

## Research findings
- **Playback position.** Web API `GET /me/player` returns `progress_ms`, `timestamp` and `is_playing`
  for any Spotify Connect device. The iOS SDK (App Remote) pushes player state with position, but only
  when the Spotify app runs on the same phone. Both need OAuth (PKCE). Plan: poll and interpolate (D-03).
- **No musical metadata.** Audio Features, Audio Analysis, Recommendations and 30-second previews closed
  to new apps on 2024-11-27. Spotify has never exposed chords.
- **No audio access.** Spotify streams are DRM-protected, and iOS doesn't let one app capture another
  app's audio output. Any chord detection has to hear the music some other way.
- **Quota.** Development-mode apps are fine for personal use. Check the current dev-mode rules
  (user cap, Premium requirement) during M1.

## Chord timeline options (decide in P-03)
- **A. Desktop companion (Windows).** Captures the Spotify desktop app's audio with per-process
  WASAPI loopback, runs beat, chord, key and section analysis, and uploads a timeline keyed by Spotify
  track ID. Clean digital audio and exact timing. Look-ahead works once the track has played through
  the PC.
- **B. Phone microphone, live.** On-device chord recognition from the speakers. Works anywhere, but
  has no look-ahead on first listen and degrades when the user plays loudly over it. Results are
  cached per track, so look-ahead works on repeat listens.
- **C. Metadata only.** Key and tempo from a third-party lookup, chords from charts typed in or drafted
  by an LLM. No time-aligned chords, so the live chord display is weak.
- **Recommendation:** A + B sharing one timeline cache, plus "Predicted" chords from repeated choruses
  (D-04). A gives exact data, B covers playback away from the PC.

## Analysis tools to evaluate (M3)
madmom (beats, downbeats, CNN chord recognition), Essentia (key, tempo), librosa (chroma),
Chordino/NNLS-Chroma. Check licences: madmom's pretrained models are believed to be non-commercial,
which is fine for personal use.

## Open
- [ ] P-01..P-04 in DECISIONS.md (user, at the end of S1)

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/01-design.md. Then resume S1.
```
