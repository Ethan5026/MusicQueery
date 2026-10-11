"""`mqc watch`: the idle rule and which request goes next (no Spotify or network)."""

from mqc.watch import IdleTracker, apply_recent, next_request, should_list


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


def test_what_this_watcher_just_finished_overrides_a_lagging_list():
    q = [{"id": "a", "state": "working"}, {"id": "b", "state": "queued"}, {"id": "c", "state": "queued"}]
    recent = {"a": ("failed", 100.0), "b": ("done", 100.0)}
    assert apply_recent(q, recent, now=150) == [{"id": "a", "state": "failed"}, {"id": "c", "state": "queued"}]
    assert apply_recent(q, recent, now=220) == q  # after 2 min the list is trusted again (e.g. a retry from the phone)


def test_the_queue_is_listed_sparingly():
    work = [{"id": "a", "state": "queued"}]
    assert should_list(True, work, 0)  # idle with work: every loop
    assert not should_list(True, [], 179) and should_list(True, [], 180)  # idle, nothing to do: every 3 min
    assert not should_list(False, work, 599) and should_list(False, work, 600)  # Spotify playing: every 10 min
