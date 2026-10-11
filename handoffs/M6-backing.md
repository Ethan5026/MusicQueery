# M6 · Backing tracks

**Status:** done (built, tested, deployed; the iPhone and Fire TV checks wait on the user, see Open) · 2026-10-11 · **Next:** M7
**Commit:** see `git log` for "S6|M6:" (pushed to origin/main)

## Goal of this stage
The app's own band (piano, bass, drums) plays a chart on the Web Audio clock, with exact chords on Stand: built-in tunes,
iReal Pro imports, and all-keys drills, with key/tempo/style/mute/count-in. Plus On Spotify (search play-alongs, play
on the active device) and an A–B loop on Stand for every clock.

## Decisions
- D-57 `packages/band`: pure-TS arranger, one bar at a time, seeded per bar; six styles + drone; tunes and drills are Chart v1
- D-58 own sampler on a self-hosted 1.7 MB mp3 kit (no Tone.js/smplr; supersedes D-21's choice), precached for offline
- D-59 `BandEngine` is the AudioClock: 25 ms timer, bars scheduled ≤ 250 ms + 1 bar ahead, position from getOutputTimestamp
- D-60 A–B loop on bar lines for all three drivers; Spotify seeks back early by a learned lead
- D-61 iReal import: Worker relay of irealpro.com's playlist page, or paste/file; charts stored 100 per IndexedDB record
- D-62 On Spotify: `/search` (limit 10) + `GET /api/status?ids=` + `PUT /me/player/play {uris}` on the last device
- D-63 Playwright's WebKit on Windows has no Web Audio: band e2e tests install a fake AudioContext

## Built
- `packages/band/src/`: `form.ts` (chart → playing-order bars in beats, same expansion as `chartTimeline`), `styles.ts`
  (`styleFor` iReal style → band style, `swingAt`), `bass.ts` (walking / two-feel / bossa / pop / funk), `piano.ts`
  (rootless A/B and close voicings, voice-led; comping rhythms per style), `drums.ts` (grooves, crash at section tops,
  fills, `countIn`), `arrange.ts` (`Arranger.bar(i)`), `sheet.ts` (`lead()` mini-notation), `tunes.ts` (12 built-ins:
  6 standards-style + 4 pop progressions + funk vamp + jazz waltz), `drills.ts` (7 drills; `cycleOfKeys`), `band.test.ts` (40)
- `apps/web/public/samples/` (+ `CREDITS.md`), made by `apps/web/scripts/fetch-samples.mjs` (ffmpeg: mono, trimmed, faded)
- `apps/web/src/audio/`: `context.ts` (one AudioContext; `unlock()` sets `navigator.audioSession.type='playback'` so the
  silent switch doesn't mute it), `kit.ts` (decode, onset trim, peak normalise), `engine.ts` (`band`: scheduler, voices,
  mutes, loop, count-in, `update()` keeps the place on tempo/key/style change, SP5 stats; `engine.test.ts` 7 with a fake
  context), `library.ts` (`BandSpec`, `chartFor`, `importIreal`, `removePlaylist`, chunked `charts` store)
- `apps/web/src/services.ts`: driver `'audio'` + transport; `openBand`/`updateBand`/`playBand`/`ensureBand`; `useBand`
  (mutes, count-in; saved in `settings/band`); `useLoop`; a saved session can be a band spec (reopens paused)
- `apps/web/src/store/idb.ts`: DB v2 adds `charts`; `idbPutMany`, `idbDeleteMany`
- `apps/web/src/ui/tracks/`: `Tracks.tsx` (Songs | Generated | Drills | On Spotify), `Songs.tsx` (the old M5b screen),
  `Generated.tsx` (search, import panel), `Drills.tsx`, `OnSpotify.tsx`, `BandCard.tsx` (sketch's band card), `backing.tsx`
- `apps/web/src/ui/stand/Loop.tsx` (A–B button + span on the progress bar; also in the lead-sheet header); sync badge
  `band` state (Band / Count-in n / Paused); `ui/settings/AudioTest.tsx` (SP5 card in Diagnostics); sample credits in Settings
- `apps/worker/src/index.ts` (+3 tests): `GET /api/status?ids=` (≤ 10, public), `GET /api/ireal/playlists[/:n]` (edge-cached)
- `apps/web/e2e/band.e2e.ts` (5), `fake-audio.ts`; `live.e2e.ts` +2 (On Spotify search/play, Spotify A–B loop)

## Verified
- `pnpm test` → 1134 passed · `pnpm lint`, `pnpm typecheck` clean · `pnpm e2e` → 23 passed
- Arranger: every bar of every tune and drill in all 7 styles stays in range and inside its bar; the walking bass lands on
  each chord's root/slash bass; voicings keep 3rd + 7th and move < 2.5 semitones a voice through a ii–V–I chain
- Engine (fake context): count-in on the beat, chart held at the top during it, first downbeat exact; 300 BPM for 10 s →
  0 late voices; loop wraps clock and voices on the bar line; tempo change keeps the beat; pause stops future voices
- Offline renders of 6 styles (same arranger, kit, levels): RMS ≈ −19 dBFS (ballad −24 → lifted), peaks ≤ +0.5 dBFS before
  the compressor. Sent to the user to listen
- Import (WebKit, Windows): Jazz 1460 → 1460 charts in 2.1 s (was 24.5 s with a record per chart); search 0.36 s; Giant
  Steps opens and plays in 1.2 s. Parser over all 2237 corpus songs: 0.6 s in Node
- Deployed (version 304a02c9): `/api/ireal/playlists` lists Jazz 1460, Brazilian 220, Latin 50, Blues 50, Pop 400, Country
  50 straight from irealpro.com; `/api/status` answers; 44 samples in the service worker's precache
- Not verified: real audio on the iPhone (Playwright's WebKit has no AudioContext), the Spotify loop gap on the Fire TV

## Open
- [ ] user (SP5): on the iPhone, Settings → Show sync tools → Audio test: 300 BPM for 10 min with the screen on, then Send
      (and once with the silent switch on). Exit needs late voices 0 (max < 5 ms), stalls 0. I can read it with `pnpm tail`
      if live, else the numbers on the card. Also note `outputLatency`; Bluetooth/AirPlay latency isn't calibrated for the
      band yet (only Spotify devices have offsets, D-51): if Stand runs ahead of the band on headphones, add a band offset
- [ ] user: listen to the renders and the band on the phone; balance, feel and voicings are first guesses
- [ ] user: Spotify loop gap on the Fire TV (exit ≤ 500 ms): loop two bars of an analysed track; `loop.jump` logs `tookMs`
      and the learned lead (starts at 150 ms, capped 800 ms). If the Fire TV rebuffers on every seek, the gap can't go lower
- [ ] Jazz 1460 import time on the iPhone itself (Tracks → Generated → Import iReal Pro → Jazz 1460)
- [ ] band styles not covered: shuffle, samba vs bossa, 6/8 and 5/4 feels (iReal styles map onto the six by keyword)
- [ ] carried: M5b live inbox check (quota block until ~23:40 on 2026-10-11); Fire TV whole-tune sync + calibration; P-05,
      P-06; Paper status-bar strip; repo not Prettier-clean

## Skip
- `companion/`: unchanged by M6
- `packages/theory`: unchanged (the band uses `expandChart`, `chartTimeline`, `transposeChart`, `importPlaylist`)

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/M6-backing.md, then the M7 row in handoffs/02-dev-plan.md. Then do M7:
listening live + predicted (mic worklet → beat-synced chroma → decoder, spike SP7; chorus-consensus Predicted; chord fixes
as edits[]). Pop comes first (D-36).
```
