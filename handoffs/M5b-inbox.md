# M5b · Playlist inbox

**Status:** done (built, tested, deployed; live acceptance waits on the user, see Open) · 2026-10-11 · **Next:** M6
**Commit:** see `git log` for "S5b|M5b:" (pushed to origin/main)

## Goal of this stage
A Spotify playlist is the inbox and the practice set. Add a song to it in any Spotify app and it gets queued for analysis
automatically, still under the M5 idle rule. Analysed songs stay in the playlist. Tracks on the phone lists the playlist with
each song's state.

## Decisions
- D-54 inbox design: the PC checks `snapshot_id`, queues the new songs and mirrors the playlist to the Worker; the phone reads
  the mirror, never Spotify (a departure from the plan row, which had the phone read the playlist after a re-login)
- D-55 quota blocks: wait out Retry-After, record `blockedUntil` in the mirror, catch up afterwards
- D-56 `mqc watch` lists the KV queue sparingly; a 2-min local override stops a KV echo from starting an analysis twice

## Built
- `apps/worker/src/index.ts` (+ tests): `PUT/DELETE /api/inbox` (secret; validated by `parseInbox`, ≤ 300 songs) and
  `GET /api/inbox` (public), which adds each song's state from the `tl:`/`q:` keys
- `companion/src/mqc/inbox.py` (+ `tests/test_inbox.py`, 9 tests): `Inbox.check()` (snapshot → tracks → `to_queue` →
  `queue_add` → mirror), `parse_playlist_id`; never raises for Spotify, store or network errors
- `companion/src/mqc/spotify.py`: `RateLimited(SpotifyError)` carries `retry_after_s`; `playlist_snapshot()`;
  `playlist_tracks()` tries `/items` then `/tracks` and accepts `item` or `track` entries
- `companion/src/mqc/store.py`: `queue_add`, `inbox_get/put/delete` · `config.py`: `inbox_playlist`, `inbox_name`
- `companion/src/mqc/watch.py`: inbox check each loop when due (`--inbox-minutes 10`); `should_list`, `apply_recent` (+ tests)
- `companion/src/mqc/cli.py`: `mqc inbox [show|set <link>|check|clear]`
- `apps/web/src/timeline/inbox.ts`: `fetchInbox()` (cached in IndexedDB `settings/inbox` for offline use; seeds `tracks` titles),
  `blockedUntil()`
- `apps/web/src/ui/tracks/Tracks.tsx`: Inbox section (name, "n of m analysed", Refresh, also refreshed when the app returns to
  the foreground). Rows show Analysed / Working / Queued / Failed / Waiting. Tapping an analysed song opens it; tapping any other
  song opens a panel with `AnalyseButton` (status, "Try again on the PC"). Below that, "On this phone" lists the cached timelines
  that aren't in the inbox
- `apps/web/src/ui/AnalyseButton.tsx`: `onStatus` callback (via `useEffectEvent`), so a retry updates its row straight away
- `apps/web/e2e/live.e2e.ts`: inbox test (states, dedup with "On this phone", retry a failure, open an analysed song)

## Verified
- `pnpm test` → 1084 passed · `pnpm lint`, `pnpm typecheck` clean · companion `pytest tests` → 28 passed, `ruff check` clean
- `pnpm e2e` → 16 passed (the new inbox test included). Screenshot checked in Stage at 402 px
- Deployed (version 1a8e7562): `GET /api/inbox` → 404 before any inbox is set; PUT without the secret → 401; a live round trip
  from the companion (`inbox_put` → `inbox_get` → `inbox_delete`) returned Let It Be `analysed` and an unknown id `new`
- Fake-Spotify tests cover the exit criteria's logic: an unchanged playlist costs one light request; analysed or queued songs
  are skipped; a song removed and re-added isn't analysed twice; a failed song isn't re-queued on every edit; a simulated
  86 000 s 429 leaves the watcher running, waits it out, then queues what was added meanwhile and clears the note
- Not verified live: Spotify was refusing playlist reads (`/me/playlists` → 429, Retry-After 29 464 s, so until about 23:40 on
  2026-10-11), so no real snapshot or track read ran this stage. The `/items` vs `/tracks` endpoint name is still unconfirmed

## Open
- [ ] user: create (or pick) the inbox playlist, then on the PC run `pnpm companion inbox set <playlist link>` (this works during
      a quota block; it saves the playlist and warns)
- [ ] user (after the block lifts): add 3 songs from the phone's Spotify app, run `pnpm companion watch`, and check they show in
      `pnpm companion queue` within 15 min, get analysed once Spotify has been idle 10 min, and show in Tracks with the right
      states; then remove one analysed song, add it back, and check it isn't queued again. Then open one on the Fire TV
- [ ] next session: if `/playlists/{id}/items` and `/tracks` both fail on the first live read, look at Spotify's current
      playlist-items endpoint; `playlist_tracks()` is the only place to change
- [ ] the phone sees new songs only after the PC reads them (≤ 10 min, PC on). If that's too slow, a "not in the mirror yet"
      view would need the phone to read the playlist itself (D-54 explains why it doesn't)
- [ ] `GET /api/inbox` is public (playlist titles and artists, like the public timelines); say if it should need the Spotify token
- [ ] Cloudflare plan unknown: on the free plan KV allows 1000 lists a day; D-56 keeps the watcher to about 480 a day while idle
- [ ] carried from M5: Fire TV whole-tune sync report + calibration; `mqc watch` leaves the PC as the active Spotify device;
      P-05, P-06; Paper status-bar strip; repo not Prettier-clean

## Skip
- `companion/src/mqc/pipeline.py`, `capture.py`, `analysis.py`: unchanged by M5b
- `apps/web/src/ui/stand/*`: unchanged

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/M5b-inbox.md, then the M6 row in handoffs/02-dev-plan.md. Then do M6:
backing tracks (AudioClock, band engine after spike SP5, Generated tracks with key/tempo/style/mute/count-in, iReal playlist
import, Drills, On Spotify search + A–B loop). Generated and Drills tracks emit exact timelines (D-12, D-21, D-29).
```
