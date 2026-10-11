"""`mqc watch` (M5): analyse the tracks the phone queued (POST /api/queue/:id), one at a time.

Capture plays the track in this PC's Spotify app (D-33), and Spotify has one active device per account, so analysing
while the user listens on the Fire TV would take playback away from it. The watcher therefore waits until nothing
has played on any device for `idle_minutes`, then works through the queue. Uploading a timeline clears its request
in the Worker; a failure is marked `failed` with the error, and asking again from the phone retries it.
"""

from __future__ import annotations

import time
from collections.abc import Callable

from .store import Store, StoreError


class IdleTracker:
    """Spotify counts as idle once nothing has played for `idle_s` seconds. Starts as "just played" so a fresh
    watcher never grabs playback the moment it starts."""

    def __init__(self, idle_s: float, now: Callable[[], float] = time.monotonic) -> None:
        self.idle_s = idle_s
        self.now = now
        self.last_playing = now()

    def update(self, playing: bool) -> bool:
        if playing:
            self.last_playing = self.now()
        return self.now() - self.last_playing >= self.idle_s

    def wait_s(self) -> float:
        return max(0.0, self.idle_s - (self.now() - self.last_playing))


def next_request(queue: list[dict]) -> dict | None:
    """Oldest request still to do. `working` ones are left over from a watcher that stopped mid-track."""
    todo = [q for q in queue if q.get("state") in ("queued", "working")]
    return min(todo, key=lambda q: q.get("requestedAt", "")) if todo else None


def watch(idle_minutes: float = 10, interval_s: float = 60, once: bool = False, log=print) -> int:
    import httpx

    from .pipeline import DEFAULT_RECOGNISER, analyse_track
    from .spotify import Spotify, SpotifyError

    sp, store = Spotify(), Store()
    idle = IdleTracker(idle_minutes * 60)
    done = failed = 0
    waiting_note = ""
    log(f"watching the analysis queue: every {interval_s:.0f} s, after {idle_minutes:g} min of Spotify idle (Ctrl+C stops)")
    while True:
        req = None
        ready = False
        try:
            req = next_request(store.queue())
            st = sp.player()
            ready = idle.update(bool(st and st.is_playing))
            if req and not ready:
                note = f"{len(store.queue())} queued; waiting for Spotify to be idle ({idle.wait_s() / 60:.0f} min left)"
                if note != waiting_note:
                    log(note)
                    waiting_note = note
            elif req:
                waiting_note = ""
                tid = req["id"]
                if store.get(tid):
                    store.queue_delete(tid)
                    continue
                log(f"analysing {req.get('title') or tid} (asked {req.get('requestedAt', '?')})")
                store.queue_set(tid, "working")
                try:
                    analyse_track(sp, store, tid.split(":")[-1], DEFAULT_RECOGNISER)
                    store.queue_delete(tid)
                    done += 1
                except Exception as e:  # keep watching: unattended
                    log(f"  FAILED: {e}")
                    store.queue_set(tid, "failed", str(e))
                    failed += 1
                continue  # straight on to the next one while Spotify is still idle
        except (SpotifyError, StoreError, httpx.HTTPError) as e:
            log(f"watch: {e}")
        if once and not (req and ready):
            break
        time.sleep(interval_s)
    log(f"watch: {done} analysed, {failed} failed")
    return 1 if failed else 0
