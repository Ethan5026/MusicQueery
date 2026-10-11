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
