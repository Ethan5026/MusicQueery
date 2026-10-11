"""Playlist inbox (M5b): a Spotify playlist where adding a song queues it for analysis.

`mqc watch` asks for the playlist's `snapshot_id` every ~10 minutes (one light request) and reads its tracks only when
that changed. Every track not already stored or queued is queued in the Worker (the same queue the phone fills, D-46),
so analysis still waits for Spotify to be idle. Then the playlist is mirrored to the Worker (`PUT /api/inbox`), where
the phone lists it with each song's state; the phone never reads playlists from Spotify itself. Songs stay in the
playlist once analysed and removing one deletes nothing.

Development mode can refuse playlist reads for most of a day (D-35, `429` with a Retry-After of hours). The watcher
then waits that long, notes the block in the mirror so the phone can say so, and catches up on the next read.
"""

from __future__ import annotations

import time
import urllib.parse
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx

from .spotify import RateLimited, Spotify, SpotifyError
from .store import Store, StoreError


def parse_playlist_id(s: str) -> str:
    """Accepts a bare id, spotify:playlist:<id> or an open.spotify.com/playlist/<id> link."""
    s = s.strip()
    if s.startswith("spotify:playlist:"):
        s = s.split(":")[2]
    elif "open.spotify.com" in s:
        s = urllib.parse.urlparse(s).path.rstrip("/").split("/")[-1]
    if len(s) != 22 or not s.isalnum():
        raise ValueError(f"not a Spotify playlist link, URI or id: {s!r}")
    return s


def entry(track: dict[str, Any]) -> dict[str, str]:
    """A playlist track as the inbox mirror stores it."""
    artist = ", ".join(a["name"] for a in track.get("artists") or [] if a.get("name"))
    return {"id": f"spotify:track:{track['id']}", "title": track.get("name") or "", "artist": artist}


def to_queue(entries: list[dict[str, str]], stored: set[str], queue: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Songs to queue: not stored, and not in the queue in any state (a failed one is retried from the phone, not
    every time the playlist changes). A song in the playlist twice is queued once."""
    skip = stored | {q["id"] for q in queue}
    out: list[dict[str, str]] = []
    for e in entries:
        if e["id"] not in skip:
            out.append(e)
            skip.add(e["id"])
    return out


class Inbox:
    def __init__(
        self,
        playlist_id: str,
        sp: Spotify,
        store: Store,
        name: str = "",
        every_s: float = 600,
        now: Callable[[], float] = time.time,
        log: Callable[[str], None] = print,
    ) -> None:
        self.pid, self.sp, self.store, self.name = playlist_id, sp, store, name
        self.every_s, self.now, self.log = every_s, now, log
        self.next_at = 0.0
        self.doc: dict[str, Any] | None = None  # the mirror as last written (or read at start)
        self.started = False

    def due(self) -> bool:
        return self.now() >= self.next_at

    def _start(self) -> None:
        """The mirror holds the last snapshot seen, so a restarted watcher costs one light request, not a full read."""
        doc = self.store.inbox_get()
        if doc and doc.get("playlistId") == self.pid:
            self.doc = doc
        self.started = True

    @property
    def snapshot(self) -> str | None:
        return self.doc.get("snapshotId") if self.doc else None

    def _put(self, snapshot: str | None, tracks: list[dict[str, str]], blocked_until: str | None = None) -> None:
        doc: dict[str, Any] = {"playlistId": self.pid, "name": self.name, "tracks": tracks}
        if snapshot:
            doc["snapshotId"] = snapshot
        if blocked_until:
            doc["blockedUntil"] = blocked_until
        self.store.inbox_put(doc)
        self.doc = doc

    def check(self, force: bool = False) -> int:
        """One look at the playlist. Returns how many songs were queued. Never raises for Spotify, store or network
        errors: an unattended watcher logs them and tries again later."""
        self.next_at = self.now() + self.every_s
        try:
            if not self.started:
                self._start()
            meta = self.sp.playlist_snapshot(self.pid)
            self.name = meta.get("name") or self.name
            snap = meta.get("snapshot_id")
            if snap and snap == self.snapshot and not force:
                if self.doc and self.doc.get("blockedUntil"):  # the block is over; the phone can stop saying so
                    self._put(snap, [_bare(t) for t in self.doc["tracks"]])
                return 0
            entries = [entry(t) for t in self.sp.playlist_tracks(self.pid)]
            stored = {t["id"] for t in self.store.list()}
            new = to_queue(entries, stored, self.store.queue())
            for e in new:
                self.store.queue_add(e["id"], e["title"], e["artist"])
            self._put(snap, entries)
            self.log(
                f"inbox: {self.name or self.pid} has {len(entries)} songs; queued {len(new)}"
                + (": " + ", ".join(e["title"] for e in new[:5]) + (" …" if len(new) > 5 else "") if new else "")
            )
            return len(new)
        except RateLimited as e:
            wait = max(e.retry_after_s, self.every_s)
            self.next_at = self.now() + wait
            until = datetime.fromtimestamp(self.now() + wait, UTC)
            self.log(
                f"inbox: Spotify is refusing playlist reads for {wait / 3600:.1f} h (D-35);"
                f" next try {until.astimezone():%a %H:%M}"
            )
            try:
                tracks = [_bare(t) for t in self.doc["tracks"]] if self.doc else []
                self._put(self.snapshot, tracks, until.isoformat(timespec="seconds").replace("+00:00", "Z"))
            except (StoreError, httpx.HTTPError) as e2:
                self.log(f"inbox: couldn't note the block in the store: {e2}")
            return 0
        except (SpotifyError, StoreError, httpx.HTTPError) as e:
            self.log(f"inbox: {e}")
            return 0


def _bare(t: dict[str, Any]) -> dict[str, str]:
    """A mirror entry without the per-song state GET /api/inbox adds."""
    return {k: t[k] for k in ("id", "title", "artist") if t.get(k)}
