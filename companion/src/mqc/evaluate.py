"""Scores an analysed timeline against a hand-aligned truth timeline (M3 exit criteria, SP4).

Chords are compared per beat: the label sounding at the middle of every truth beat, as Harte labels from
@mq/theory's `toHarte` (reduced to seventh chords). `sevenths` is mir_eval's MIREX rule: truth beats whose chord
is not maj/min/7/maj7/min7/N (6, ø, °, sus…) are excluded. `majmin` and `root` are reported alongside.
`jazz` maps 6→maj7, m6→min7 and scores ø and °7 too, which is closer to how a player reads a chart.
"""

from __future__ import annotations

import mir_eval
import numpy as np

from . import bridge

JAZZ_MAP = {"maj6": "maj7", "min6": "min7", "minmaj7": "min7", "aug(b7)": "7", "sus4(b7)": "7"}
JAZZ_OK = {"maj", "min", "7", "maj7", "min7", "hdim7", "dim7", "dim", "aug"}


def labels_at(tl: dict, times_ms: np.ndarray) -> list[str]:
    """Harte label sounding at each time ('X' where the timeline has no chord)."""
    chords = tl["chords"]
    starts = np.array([c["startMs"] for c in chords]) if chords else np.zeros(0)
    if chords and all("harte" in c for c in chords):  # human annotations keep their own Harte labels
        harte = [c["harte"] for c in chords]
    else:
        harte = bridge.harte([c["symbol"] for c in chords]) if chords else []
    out = []
    for t in times_ms:
        i = int(np.searchsorted(starts, t, side="right")) - 1
        if i >= 0 and t < chords[i]["endMs"] and harte[i]:
            out.append(harte[i])
        else:
            out.append("X")
    return out


def _jazz(label: str) -> str:
    """Root:quality with 6→maj7 etc.; plain `C` (Harte shorthand for C:maj) and bass `/3` are normalised."""
    if label in ("N", "X"):
        return label
    root, _, q = label.partition(":")
    root = root.split("/")[0]
    q = (q or "maj").split("/")[0].split("(")[0] or "maj"
    return f"{root}:{JAZZ_MAP.get(q, q)}"


def chord_scores(truth: dict, est: dict) -> dict:
    beats = np.array(truth["beats"])
    out = _scores(truth, est, (beats[:-1] + beats[1:]) / 2)
    # MIREX-style time weighting: every 50 ms of the charted span
    t = np.arange(truth["chords"][0]["startMs"], truth["chords"][-1]["endMs"], 50.0) if truth["chords"] else beats
    timed = _scores(truth, est, t)
    out.update({f"{k}_time": v for k, v in timed.items() if k in ("root", "majmin", "sevenths")})
    return out


def _scores(truth: dict, est: dict, mids: np.ndarray) -> dict:
    ref = labels_at(truth, mids)
    hyp = labels_at(est, mids)
    keep = [i for i, r in enumerate(ref) if r != "X"]
    ref = [ref[i] for i in keep]
    hyp = [hyp[i] if hyp[i] != "X" else "N" for i in keep]
    out: dict = {"beats": len(ref)}
    for name, fn in (
        ("root", mir_eval.chord.root),
        ("majmin", mir_eval.chord.majmin),
        ("sevenths", mir_eval.chord.sevenths),
    ):
        s = fn(ref, hyp)
        valid = s >= 0
        out[name] = round(float(s[valid].mean()), 4) if valid.any() else None
        out[f"{name}_n"] = int(valid.sum())
    jr = [_jazz(r) for r in ref]
    jh = [_jazz(h) for h in hyp]
    ok = [i for i, r in enumerate(jr) if r == "N" or r.split(":")[1] in JAZZ_OK]
    hits = 0
    for i in ok:
        a, b = jr[i], jh[i]
        if a == "N" or b == "N":
            hits += a == b
        else:
            ra, qa = a.split(":")
            rb, qb = b.split(":")
            same_root = mir_eval.chord.pitch_class_to_semitone(ra) == mir_eval.chord.pitch_class_to_semitone(rb)
            hits += same_root and qa == qb
    out["jazz"] = round(hits / len(ok), 4) if ok else None
    out["jazz_n"] = len(ok)
    return out


def beat_f(truth: dict, est_beats_ms: list[float]) -> float:
    ref = mir_eval.beat.trim_beats(np.array(truth["beats"]) / 1000)
    hyp = mir_eval.beat.trim_beats(np.array(est_beats_ms) / 1000)
    return round(float(mir_eval.beat.f_measure(ref, hyp)), 4)


def beat_amlt(truth: dict, est_beats_ms: list[float]) -> float:
    """Continuity at any metrical level (double/half tempo and off-beat accepted): beat_this may count a
    65 bpm ballad in 8ths, which is musically fine."""
    ref = mir_eval.beat.trim_beats(np.array(truth["beats"]) / 1000)
    hyp = mir_eval.beat.trim_beats(np.array(est_beats_ms) / 1000)
    return round(float(mir_eval.beat.continuity(ref, hyp)[3]), 4)


def downbeat_f(truth: dict, est: dict) -> float:
    ref = np.array([b["startMs"] for b in truth["bars"]]) / 1000
    hyp = np.array([b["startMs"] for b in est["bars"]]) / 1000
    return round(float(mir_eval.beat.f_measure(ref, hyp)), 4)


def key_scores(truth: dict, est: dict) -> dict:
    """Fraction of the charted time where the analysed key equals the truth key (from detectKeys over the
    truth chords), and whether the longest key agrees."""

    def key_at(tl: dict, t: float) -> str | None:
        for k in tl["keys"]:
            if k["startMs"] <= t < k["endMs"]:
                return f"{k['tonic']} {k['mode']}"
        return None

    def main(tl: dict) -> str | None:
        acc: dict[str, float] = {}
        for k in tl["keys"]:
            name = f"{k['tonic']} {k['mode']}"
            acc[name] = acc.get(name, 0) + k["endMs"] - k["startMs"]
        return max(acc, key=lambda n: acc[n]) if acc else None

    if not truth["chords"]:
        return {}
    a, b = truth["chords"][0]["startMs"], truth["chords"][-1]["endMs"]
    ts = np.arange(a, b, 250.0)
    ref = [key_at(truth, t) for t in ts]
    hyp = [key_at(est, t) for t in ts]
    pairs = [(r, h) for r, h in zip(ref, hyp, strict=True) if r]
    agree = sum(_same_key(r, h) for r, h in pairs) / len(pairs) if pairs else 0.0
    return {
        "agree": round(agree, 3),
        "truthMain": main(truth),
        "estMain": main(est),
        "mainOk": _same_key(main(truth), main(est)),
    }


_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _key_pc(name: str) -> tuple[int, str]:
    tonic, mode = name.split(" ")
    p = _PC[tonic[0]] + tonic.count("♯") - tonic.count("♭")
    return p % 12, mode


def _same_key(a: str | None, b: str | None) -> bool:
    return bool(a and b) and _key_pc(a) == _key_pc(b)
