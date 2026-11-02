"""Unit tests for the parts of the companion that need no audio, Spotify or network (node runs the bridge)."""

import numpy as np
import pytest

from mqc import analysis as A
from mqc import evaluate as E
from mqc import truth as T


def tl(chords, beats=None, keys=()):
    return {
        "schema": "mq.timeline/1",
        "id": "spotify:track:4uLU6hMCjMI75M1A2tKUQC",
        "source": "analysed",
        "durationMs": 8000,
        "createdAt": "2026-10-10T12:00:00.000Z",
        "meter": {"num": 4, "den": 4},
        "beats": beats if beats is not None else [i * 500.0 for i in range(16)],
        "bars": [{"startMs": i * 2000.0, "number": i + 1} for i in range(4)],
        "chords": [{"startMs": a, "endMs": b, "symbol": s} for a, b, s in chords],
        "keys": list(keys),
        "tempo": [{"startMs": 0, "bpm": 120}],
        "edits": [],
    }


def test_beat_sync_snaps_and_merges():
    beats = np.arange(0, 4, 0.5)
    segs = [(0, 1.1, "C:maj"), (1.1, 1.2, "G:7"), (1.2, 4.0, "A:min")]
    out = A.beat_sync(segs, beats, 4.0)
    assert [s[2] for s in out] == ["C:maj", "A:min"]
    assert out[0] == (0.0, 1.0, "C:maj")
    assert out[-1][1] == 4.0


def test_beat_sync_min_beats_absorbs_blips():
    beats = np.arange(0, 6, 0.5)
    segs = [(0, 2, "C:maj"), (2, 2.5, "E:min"), (2.5, 6, "F:maj")]
    assert [s[2] for s in A.beat_sync(segs, beats, 6.0, min_beats=1)] == ["C:maj", "E:min", "F:maj"]
    assert [s[2] for s in A.beat_sync(segs, beats, 6.0, min_beats=2)] == ["C:maj", "F:maj"]


def test_meter_and_tempo():
    beats = np.arange(0, 30, 0.5)
    b = A.Beats(beats, beats[::3])
    assert A.meter_of(b) == 3
    assert A.tempo_map(b) == [{"startMs": 0, "bpm": 120.0}]


def test_grid_from_taps_enter_only_interpolates():
    taps = [{"ms": 1000.0 + 2000 * i, "key": "bar"} for i in range(4)]
    beats, bars = T.grid_from_taps(taps, 4, latency_ms=100)
    assert bars.tolist() == [900, 2900, 4900, 6900]
    assert beats[:5].tolist() == [900, 1400, 1900, 2400, 2900]


def test_calibrate_finds_tap_lag():
    detected = np.arange(0, 20000, 500.0)
    tapped = detected[2:-2] + 40 + np.random.default_rng(1).normal(0, 10, len(detected) - 4)
    assert T.calibrate(tapped, detected) == pytest.approx(40, abs=5)


def test_chord_scores_per_beat():
    truth = tl([(0, 2000, "Cmaj7"), (2000, 4000, "Dm7"), (4000, 6000, "G7"), (6000, 8000, "C6")])
    est = tl([(0, 2000, "Cmaj7"), (2000, 4000, "Dm"), (4000, 6000, "G7"), (6000, 8000, "Cmaj7")])
    s = E.chord_scores(truth, est)
    # 15 beat midpoints; the 3 under C6 are excluded from MIREX sevenths, and Dm vs Dm7 misses 4 of the 12
    assert s["sevenths_n"] == 12
    assert s["sevenths"] == pytest.approx(8 / 12, abs=1e-3)
    assert s["root"] == 1.0
    assert s["jazz"] == pytest.approx(11 / 15, abs=1e-3)  # C6 ≈ Cmaj7 counts in the jazz view


def test_key_scores():
    truth = tl([(0, 8000, "C")], keys=[{"startMs": 0, "endMs": 8000, "tonic": "C", "mode": "major"}])
    est = tl(
        [(0, 8000, "C")],
        keys=[
            {"startMs": 0, "endMs": 4000, "tonic": "C", "mode": "major"},
            {"startMs": 4000, "endMs": 8000, "tonic": "B♯", "mode": "major"},
        ],
    )
    k = E.key_scores(truth, est)
    assert k["agree"] == 1.0 and k["mainOk"]


def test_validate_timeline():
    good = tl([(0, 2000, "Cmaj7"), (2000, 4000, "D♭7")])
    assert A.validate_timeline(good) == []
    bad = tl([(0, 2000, "Cmaj7"), (1500, 4000, "D♭7")])
    assert A.validate_timeline(bad) == ["chords overlap"]
    assert A.validate_timeline({**good, "source": "guessed"})


def test_regularise_merges_glitch_bars_and_fixes_beat_level():
    # 4/4 at 1 s per bar; beat_this counted half notes in bars 3-4 and put a glitch downbeat at 4.25 s
    beats = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 4.25, 4.5, 4.75, 5, 5.25, 5.5, 5.75, 6]
    b = A.Beats(np.array(beats), np.array([0, 1, 2, 3, 4, 4.25, 5, 6]))
    r = A.regularise(b)
    assert r.downbeats.tolist() == [0, 1, 2, 3, 4, 5, 6]
    assert np.allclose(r.beats[8:12], [2, 2.25, 2.5, 2.75])
    assert A.meter_of(r) == 4


def test_seventh_share_and_vote():
    segs = [(0, 2, "C:maj"), (2, 4, "G:7"), (4, 8, "N")]
    assert A.seventh_share(segs) == 0.5
    beats = np.arange(0, 4, 1.0)
    per = {
        "btc": [(0, 2, "C:maj7"), (2, 4, "E:min")],
        "chordino": [(0, 2, "C:maj"), (2, 4, "G:maj")],
        "madmom": [(0, 2, "A:min"), (2, 4, "G:maj")],
    }
    # beats 0-1: C wins (btc+chordino) and keeps BTC's quality; beats 2-3: G wins (chordino+madmom) over E
    assert A.vote(per, beats, 4.0) == [(0.0, 2.0, "C:maj7"), (2.0, 4.0, "G:maj")]


def test_vote_smooth_holds_through_a_walking_bass():
    # 4/4 at 2 s a bar. Bar 1 is Dm7, but on beat 2 the bass walks to F and two recognisers follow it for one beat;
    # bar 2 is G7. The plain vote flickers to F; the smoothed vote holds Dm7 and still changes on the downbeat.
    beats = A.Beats(np.arange(0, 4, 0.5), np.array([0.0, 2.0]))
    per = {
        "btc": [(0, 2, "D:min7"), (2, 4, "G:7")],
        "chordino": [(0, 0.5, "D:min"), (0.5, 1.0, "F:maj"), (1.0, 2, "D:min"), (2, 4, "G:maj")],
        "madmom": [(0, 0.5, "D:min"), (0.5, 1.0, "F:maj"), (1.0, 2, "D:min"), (2, 4, "G:maj")],
    }
    assert any(lab == "F:maj" for _, _, lab in A.vote(per, beats.beats, 4.0))
    assert A.vote_smooth(per, beats, 4.0) == [(0.0, 2.0, "D:min7"), (2.0, 4.0, "G:7")]


def test_vote_smooth_keeps_changes_on_the_half_bar():
    # Gmaj7 for two beats, Gm7 for two (Just the Way You Are): the third changes on the half bar and is kept
    beats = A.Beats(np.arange(0, 2, 0.5), np.array([0.0]))
    per = {
        "btc": [(0, 1, "G:maj7"), (1, 2, "G:min7")],
        "chordino": [(0, 1, "G:maj"), (1, 2, "G:min")],
        "madmom": [(0, 1, "G:maj"), (1, 2, "G:min")],
    }
    assert A.vote_smooth(per, beats, 2.0) == [(0.0, 1.0, "G:maj7"), (1.0, 2.0, "G:min7")]


def test_fix_double_time():
    # 8 beats a bar at 300 BPM (Zanzibar) → 4 beats a bar at 150 BPM
    step = 0.2
    b = A.Beats(np.arange(0, 32 * step, step), np.arange(0, 32 * step, 8 * step))
    f = A.fix_double_time(b)
    assert len(f.beats) == 16 and np.allclose(np.diff(f.beats), 0.4) and len(f.downbeats) == 4
    # 6 eighths a bar at 250 BPM (a slow 12/8) → dotted-quarter beats, 4 to a bar
    step = 0.24
    b = A.Beats(np.arange(0, 48 * step, step), np.arange(0, 48 * step, 6 * step))
    f = A.fix_double_time(b)
    assert np.allclose(np.diff(f.beats), 0.72) and len(f.downbeats) == 4 and A.meter_of(f) == 4
    # 4/4 at a real fast tempo stays
    b = A.Beats(np.arange(0, 32 * 0.25, 0.25), np.arange(0, 32 * 0.25, 1.0))
    assert A.fix_double_time(b) is b


def test_same_song_drops_versions_only():
    from mqc.charts import same_song

    assert same_song("Lover (Live)", "Lover")
    assert same_song("Let It Be - Remastered 2009", "let it be")
    assert same_song("Águas de Março", "Aguas De Março") is False  # accents differ: a different spelling, not dropped
    assert same_song("Águas de Março", "águas de março")
    assert not same_song("Just the Way You Are", "The Stranger")
    assert not same_song("(Live)", "(Live)")  # nothing left to compare


def test_chart_lookup_keeps_other_releases_of_the_same_song_only(tmp_path):
    import sqlite3

    from mqc import charts as C

    db = tmp_path / "c.sqlite"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE charts (song_id TEXT, artist_id TEXT, row_id TEXT, genres TEXT, chords TEXT)")
    con.executemany(
        "INSERT INTO charts VALUES (?,?,?,?,?)",
        [("live", "a", "1", "", "<verse_1> C"), ("jtwya", "a", "2", "", "<verse_1> D")],
    )
    con.commit()
    con.close()

    class Sp:
        def track(self, tid):
            return {"name": "The Stranger - Remastered", "artists": [{"name": "Billy Joel"}]}

        def call(self, method, path, params):
            class R:
                status_code = 200

                def json(self):
                    # Spotify's search also returns the album's other tracks
                    return {
                        "tracks": {
                            "items": [
                                {"id": "live", "name": "The Stranger (Live)"},
                                {"id": "jtwya", "name": "Just the Way You Are"},
                            ]
                        }
                    }

            return R()

    assert [c.row_id for c in C.lookup(Sp(), "orig", db)] == ["1"]
    assert [c.row_id for c in C.lookup(None, "orig", db)] == ["1"]  # cached: no second search
