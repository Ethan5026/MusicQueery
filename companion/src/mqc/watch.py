"""`mqc watch` (M5): analyse the tracks the phone queued (POST /api/queue/:id), one at a time.

Capture plays the track in this PC's Spotify app (D-33), and Spotify has one active device per account, so analysing
while the user listens on the Fire TV would take playback away from it. The watcher therefore waits until nothing
has played on any device for `idle_minutes`, then works through the queue. Uploading a timeline clears its request
in the Worker; a failure is marked `failed` with the error, and asking again from the phone retries it.

M5b: with an inbox playlist set (`mqc inbox set`), the watcher also checks that playlist every `inbox_minutes` and
queues the songs added to it (inbox.py). Playing Spotify doesn't hold that up; only the analysis waits.

The queue is a KV list in the Worker, the scarce operation on Cloudflare's free plan (1000 a day), so it is listed
sparingly (`should_list`).
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


def apply_recent(
    queue: list[dict], recent: dict[str, tuple[str, float]], now: float, keep_s: float = 120
) -> list[dict]:
    """KV lists lag writes by up to a minute, so what this watcher just finished overrides the list for a while:
    a `done` request is dropped, a `failed` one stays failed instead of reappearing as `working`."""
    out = []
    for q in queue:
        st, at = recent.get(q["id"], ("", -1e9))
        if now - at >= keep_s:
            out.append(q)
        elif st != "done":
            out.append({**q, "state": st})
    return out


def should_list(ready: bool, queue: list[dict], since_s: float) -> bool:
    """List the queue every loop while there is work and Spotify is idle; every 3 min while idle with nothing to do
    (a phone request waits at most that long); every 10 min while Spotify plays, only for the waiting note."""
    if ready:
        return next_request(queue) is not None or since_s >= 180
    return since_s >= 600


def watch(
    idle_minutes: float = 10, interval_s: float = 60, once: bool = False, inbox_minutes: float = 10, log=print
) -> int:
    import httpx

    from .inbox import Inbox
    from .pipeline import DEFAULT_RECOGNISER, analyse_track
    from .spotify import Spotify, SpotifyError

    sp, store = Spotify(), Store()
    idle = IdleTracker(idle_minutes * 60)
    pid = store.s.inbox_playlist
    inbox = Inbox(pid, sp, store, store.s.inbox_name, inbox_minutes * 60, log=log) if pid else None
    done = failed = 0
    waiting_note = ""
    queue: list[dict] = []
    listed_at = -1e9
    recent: dict[str, tuple[str, float]] = {}
    log(f"watching the queue: every {interval_s:.0f} s, after {idle_minutes:g} min of Spotify idle (Ctrl+C stops)")
    log(
        f"inbox playlist: {store.s.inbox_name or pid}, checked every {inbox_minutes:g} min"
        if inbox
        else "no inbox playlist (`mqc inbox set <link>` to add one)"
    )
    while True:
        req = None
        ready = False
        try:
            if inbox and inbox.due() and inbox.check():
                listed_at = -1e9  # it queued something: list again
            st = sp.player()
            ready = idle.update(bool(st and st.is_playing))
            if should_list(ready, queue, time.monotonic() - listed_at):
                queue, listed_at = store.queue(), time.monotonic()
            queue = apply_recent(queue, recent, time.monotonic())
            req = next_request(queue)
            if req and not ready:
                todo = sum(q.get("state") in ("queued", "working") for q in queue)
                note = f"{todo} queued; waiting for Spotify to be idle ({idle.wait_s() / 60:.0f} min left)"
                if note != waiting_note:
                    log(note)
                    waiting_note = note
            elif req:
                waiting_note = ""
                tid = req["id"]
                if store.get(tid):
                    store.queue_delete(tid)
                    recent[tid] = ("done", time.monotonic())
                    continue
                log(f"analysing {req.get('title') or tid} (asked {req.get('requestedAt', '?')})")
                store.queue_set(tid, "working")
                try:
                    analyse_track(sp, store, tid.split(":")[-1], DEFAULT_RECOGNISER)
                    store.queue_delete(tid)
                    recent[tid] = ("done", time.monotonic())
                    done += 1
                except Exception as e:  # keep watching: unattended
                    log(f"  FAILED: {e}")
                    store.queue_set(tid, "failed", str(e))
                    recent[tid] = ("failed", time.monotonic())
                    failed += 1
                continue  # straight on to the next one while Spotify is still idle
        except (SpotifyError, StoreError, httpx.HTTPError) as e:
            log(f"watch: {e}")
        if once and not (req and ready):
            break
        time.sleep(interval_s)
    log(f"watch: {done} analysed, {failed} failed")
    return 1 if failed else 0
