"""Chart-informed recognition (P-07 / D-40) on synthetic data; needs node for the theory bridge."""

import numpy as np

from mqc import charts as C


def test_ug_text_converts_chordonomicon_spellings():
    assert C.ug_text("Amin7") == "Am7"
    assert C.ug_text("Cs/Gs") == "C#/G#"
    assert C.ug_text("Bbmaj7") == "Bbmaj7"
    assert C.ug_text("<verse_1>") is None


def test_parse_keeps_section_starts():
    p = C.parse("<intro_1> C G <verse_1> Amin F C G <chorus_1> F G C")
    assert p.texts == ["C", "G", "Am", "F", "C", "G", "F", "G", "C"]
    assert p.starts == [0, 2, 6]
    assert C.parse("<intro_1> C G") is None


def test_vocabulary_and_rename():
    p = C.parse("<verse_1> Cmaj7 Amin7 Dmin7 G7 Cmaj7 Amin7 Dmin7 G7 F")
    vocab = C.chart_vocabulary(p)
    assert vocab[(0, 0)] == "Cmaj7" and vocab[(9, 1)] == "Am7" and vocab[(7, 0)] == "G7"
    segs = [(0, 1, "C:maj"), (1, 2, "A:min"), (2, 3, "E:min"), (3, 4, "N")]
    assert C.rename_with_vocabulary(segs, vocab) == [(0, 1, "Cmaj7"), (1, 2, "Am7"), (2, 3, "Em"), (3, 4, "N.C.")]
    # a capo chart written two semitones down, shifted back up
    assert C.chart_vocabulary(C.parse("<v_1> Bbmaj7 Gmin7 Bbmaj7 Gmin7"), shift=2)[(0, 0)] == "Cmaj7"


def test_align_follows_the_audio_and_repeats_a_section():
    # chart: verse C Am, chorus F G (written once); audio: verse, chorus, chorus again, 4 beats per chord
    p = C.parse("<verse_1> C Amin <chorus_1> F G")
    played = ["C:maj", "A:min", "F:maj", "G:maj", "F:maj", "G:maj"]
    chroma = np.array([C._template(h, 0)[0] for h in played for _ in range(4)])
    quiet = np.zeros(len(chroma), dtype=bool)
    edges = np.arange(len(chroma) + 1) * 0.5
    al = C.align(p, chroma, quiet, [h for h in played for _ in range(4)], edges)
    assert al.shift == 0 and al.agreement == 1.0
    assert [lab for _, _, lab in al.segs] == ["C", "Am", "F", "G", "F", "G"]
    # the same audio a whole step up is found by transposing the chart
    up = np.array([np.roll(c, 2) for c in chroma])
    assert C.align(p, up, quiet, ["N"] * len(up), edges).shift == 2
