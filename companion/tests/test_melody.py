"""Melody notes from a pitch track (M9): segmentation, tuning, beat-grid snapping. No models are loaded."""

import numpy as np

from mqc import melody as M


def track(*parts):
    """f0 and confidence from (seconds, midi or None) parts at 10 ms frames; midi may be fractional."""
    f0, conf = [], []
    for sec, m in parts:
        n = round(sec / M.HOP_S)
        f0 += [0.0 if m is None else 440 * 2 ** ((m - 69) / 12)] * n
        conf += [0.0 if m is None else 0.9] * n
    return np.array(f0), np.array(conf)


def test_three_notes_with_rests():
    f0, conf = track((0.2, None), (0.5, 60), (0.1, None), (0.5, 62), (0.5, 64), (0.2, None))
    notes, tune = M.segment(f0, conf)
    assert [int(n[2]) for n in notes] == [60, 62, 64]
    assert abs(tune) < 0.01
    assert abs(notes[0, 0] - 0.2) < 0.02 and abs(notes[1, 0] - 0.8) < 0.02 and abs(notes[2, 0] - 1.3) < 0.02


def test_vibrato_stays_one_note():
    t = np.arange(0, 1.0, M.HOP_S)
    m = 67 + 0.6 * np.sin(2 * np.pi * 5.5 * t)
    f0 = 440 * 2 ** ((m - 69) / 12)
    notes, _ = M.segment(f0, np.full_like(f0, 0.9))
    assert len(notes) == 1 and int(notes[0, 2]) == 67


def test_scoop_joins_the_note_it_leads_into():
    f0, conf = track((0.2, None), (0.03, 58), (0.6, 60), (0.2, None))
    notes, _ = M.segment(f0, conf)
    assert len(notes) == 1 and int(notes[0, 2]) == 60
    assert abs(notes[0, 0] - 0.2) < 0.02


def test_flat_singer_keeps_semitones():
    f0, conf = track((0.5, 59.7), (0.5, 61.7), (0.5, 63.7))
    notes, tune = M.segment(f0, conf)
    assert abs(tune + 0.3) < 0.02
    assert [int(n[2]) for n in notes] == [60, 62, 64]


def test_sixteenths_and_snap():
    beats = np.array([1.0, 1.5, 2.0, 2.5])
    grid = M.sixteenths(beats, 3.2)
    assert np.allclose(grid[:5], [0.0, 0.125, 0.25, 0.375, 0.5])
    assert abs(grid[-1] - 3.5) < 1e-9
    notes = np.array([[1.02, 1.30, 60, 0.9], [1.30, 1.31, 61, 0.9], [1.6, 2.4, 62, 0.8]])
    out = M.snap(notes, grid)
    # the 10 ms note keeps one sixteenth; nothing overlaps
    assert np.allclose(out[0, :2], [1.0, 1.25])
    assert out[1, 0] >= out[0, 1]
    assert np.allclose(out[2, :2], [1.625, 2.375])
    assert np.all(out[1:, 0] >= out[:-1, 1])


def test_a_fall_at_the_end_keeps_the_note():
    # Let It Be at 18 s: a D sung 40 cents flat with a short fall; the path fits C♯ to the whole span, the core is D
    f0, conf = track((0.2, None), (0.25, 61.6), (0.06, 60.4), (0.2, None))
    notes, _ = M.segment(f0, conf)
    assert [int(n[2]) for n in notes] == [62]


def test_short_slides_join_their_neighbour():
    notes = np.array([[0.0, 0.1, 63, 0.9], [0.1, 0.6, 64, 0.9], [0.6, 1.0, 62, 0.9], [1.0, 1.05, 61, 0.9]])
    out = M.merge_blips(notes)
    assert [int(n[2]) for n in out] == [64, 62]
    assert out[0, 0] == 0.0 and out[1, 1] == 1.05
