"""`mqc watch`: the idle rule and which request goes next (no Spotify or network)."""

from mqc.watch import IdleTracker, next_request


def test_idle_waits_from_start_and_from_the_last_play():
    t = [0.0]
    idle = IdleTracker(600, now=lambda: t[0])
    assert not idle.update(False)  # a fresh watcher waits the full idle time
    t[0] = 599
    assert not idle.update(False)
    t[0] = 600
    assert idle.update(False)
    assert idle.wait_s() == 0
    t[0] = 700
    assert not idle.update(True)  # someone plays: the clock starts again
    t[0] = 1299
    assert not idle.update(False)
    assert idle.wait_s() == 1
    t[0] = 1300
    assert idle.update(False)


def test_zero_minutes_is_immediately_idle_when_nothing_plays():
    idle = IdleTracker(0, now=lambda: 5.0)
    assert idle.update(False)


def test_next_request_is_the_oldest_unfinished():
    q = [
        {"id": "b", "state": "queued", "requestedAt": "2026-10-11T10:00:00Z"},
        {"id": "a", "state": "failed", "requestedAt": "2026-10-11T09:00:00Z"},
        {"id": "c", "state": "working", "requestedAt": "2026-10-11T09:30:00Z"},
    ]
    assert next_request(q)["id"] == "c"
    assert next_request([x for x in q if x["id"] != "c"])["id"] == "b"
    assert next_request([q[1]]) is None
    assert next_request([]) is None
