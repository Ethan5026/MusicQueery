"""Playlist inbox (M5b): snapshot checks, what gets queued, quota blocks (fake Spotify and store, no network)."""

from __future__ import annotations

import pytest

from mqc.inbox import Inbox, parse_playlist_id, to_queue
from mqc.spotify import RateLimited

PID = "37i9dQZF1DXcBWIGoYBM5M"


def track(n: int) -> dict:
    return {"id": f"{n:022d}", "name": f"Song {n}", "artists": [{"name": f"Artist {n}"}], "type": "track"}


def tid(n: int) -> str:
    return f"spotify:track:{n:022d}"


class FakeSpotify:
    def __init__(self) -> None:
        self.tracks = [track(1), track(2)]
        self.snap = 1
        self.blocked_s = 0.0
        self.snapshot_reads = self.track_reads = 0

    def playlist_snapshot(self, pid: str) -> dict:
        self.snapshot_reads += 1
        if self.blocked_s:
            raise RateLimited("GET /playlists: rate limited", self.blocked_s)
        return {"snapshot_id": f"s{self.snap}", "name": "Inbox"}

    def playlist_tracks(self, pid: str) -> list[dict]:
        self.track_reads += 1
        return list(self.tracks)

    def edit(self, tracks: list[dict]) -> None:
        self.tracks, self.snap = tracks, self.snap + 1


class FakeStore:
    """The Worker as the inbox sees it: timelines, the queue and the mirror."""

    def __init__(self) -> None:
        self.stored: set[str] = set()
        self.q: dict[str, dict] = {}
        self.mirror: dict | None = None
        self.added: list[str] = []

    def list(self) -> list[dict]:
        return [{"id": i} for i in self.stored]

    def queue(self) -> list[dict]:
        return list(self.q.values())

    def queue_add(self, i: str, title: str | None = None, artist: str | None = None) -> dict:
        self.added.append(i)
        self.q[i] = {"id": i, "title": title, "state": "queued"}
        return self.q[i]

    def inbox_get(self) -> dict | None:
        return self.mirror

    def inbox_put(self, doc: dict) -> None:
        self.mirror = {**doc, "updatedAt": "now"}

    def analyse(self, i: str) -> None:  # what `mqc watch` does once Spotify is idle
        self.q.pop(i, None)
        self.stored.add(i)


@pytest.fixture
def world():
    t = [1000.0]
    sp, store = FakeSpotify(), FakeStore()
    inbox = Inbox(PID, sp, store, every_s=600, now=lambda: t[0], log=lambda _m: None)
    return t, sp, store, inbox


def test_first_check_queues_new_songs_and_mirrors_the_playlist(world):
    t, sp, store, inbox = world
    store.stored.add(tid(2))  # already analysed
    assert inbox.check() == 1
    assert store.added == [tid(1)]
    assert store.mirror["snapshotId"] == "s1" and store.mirror["name"] == "Inbox"
    assert [x["id"] for x in store.mirror["tracks"]] == [tid(1), tid(2)]
    assert store.mirror["tracks"][0] == {"id": tid(1), "title": "Song 1", "artist": "Artist 1"}
    assert not inbox.due()
    t[0] += 600
    assert inbox.due()


def test_an_unchanged_playlist_costs_one_light_request(world):
    t, sp, store, inbox = world
    inbox.check()
    inbox.check()
    inbox.check()
    assert (sp.snapshot_reads, sp.track_reads) == (3, 1)


def test_analysed_or_queued_songs_are_skipped_and_a_readded_song_is_not_analysed_twice(world):
    t, sp, store, inbox = world
    inbox.check()
    store.analyse(tid(1))
    sp.edit([track(2), track(3)])  # 1 removed (its timeline stays), 3 added; 2 is still queued
    assert inbox.check() == 1
    assert store.added == [tid(1), tid(2), tid(3)]
    sp.edit([track(2), track(3), track(1)])  # 1 re-added
    assert inbox.check() == 0
    assert store.added == [tid(1), tid(2), tid(3)]


def test_a_failed_song_is_not_requeued_on_every_playlist_change(world):
    t, sp, store, inbox = world
    inbox.check()
    store.q[tid(1)]["state"] = "failed"
    sp.edit([track(1), track(2), track(4)])
    inbox.check()
    assert store.q[tid(1)]["state"] == "failed"
    assert store.added == [tid(1), tid(2), tid(4)]


def test_a_quota_block_backs_off_is_noted_and_catches_up_afterwards(world):
    t, sp, store, inbox = world
    inbox.check()
    sp.blocked_s = 86_000
    sp.edit([track(1), track(2), track(5)])
    assert inbox.check() == 0  # no exception: the watcher keeps running
    assert store.mirror["blockedUntil"].endswith("Z")
    assert [x["id"] for x in store.mirror["tracks"]] == [tid(1), tid(2)]  # last good list kept
    t[0] += 3600
    assert not inbox.due()  # waits out the Retry-After, not just the 10 minutes
    t[0] += 86_000
    sp.blocked_s = 0
    assert inbox.due()
    assert inbox.check() == 1
    assert store.added[-1] == tid(5)
    assert "blockedUntil" not in store.mirror


def test_the_block_note_clears_even_if_nothing_changed(world):
    t, sp, store, inbox = world
    inbox.check()
    sp.blocked_s = 700
    inbox.check()
    assert "blockedUntil" in store.mirror
    sp.blocked_s = 0
    inbox.check()
    assert "blockedUntil" not in store.mirror and sp.track_reads == 1


def test_a_restarted_watcher_takes_the_snapshot_from_the_mirror(world):
    t, sp, store, inbox = world
    inbox.check()
    again = Inbox(PID, sp, store, now=lambda: t[0], log=lambda _m: None)
    again.check()
    assert sp.track_reads == 1
    other = Inbox("0" * 22, sp, store, now=lambda: t[0], log=lambda _m: None)  # a different playlist: read it
    other.check()
    assert sp.track_reads == 2


def test_a_song_twice_in_the_playlist_is_queued_once():
    e = [{"id": "a"}, {"id": "b"}, {"id": "a"}]
    assert to_queue(e, set(), []) == [{"id": "a"}, {"id": "b"}]
    assert to_queue(e, {"b"}, [{"id": "a", "state": "working"}]) == []


def test_parse_playlist_id():
    assert parse_playlist_id(PID) == PID
    assert parse_playlist_id(f"spotify:playlist:{PID}") == PID
    assert parse_playlist_id(f"https://open.spotify.com/playlist/{PID}?si=abc123") == PID
    with pytest.raises(ValueError):
        parse_playlist_id("https://open.spotify.com/track/7iN1s7xHE4ifF5povM6A48x")
