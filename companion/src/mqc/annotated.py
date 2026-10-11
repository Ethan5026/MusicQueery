"""Human-annotated, time-aligned chord truth from ChoCo (Isophonics, McGill Billboard, …) for the M3 evaluation.

The annotations were made on CD/LP audio, so the Spotify release can start a little earlier or later. The offset is
found by sliding the annotation ±4 s against our own root estimates and taking the best agreement (reported, with
the runner-up, so a flat or ambiguous peak is visible). Chords keep their Harte labels (`harte` on each chord), so
nothing is lost converting to our symbols; labels mir_eval cannot read are left out (scored as excluded).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import mir_eval
import numpy as np

from .spotify import Spotify

PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def load_jams(path: Path) -> dict:
    d = json.loads(path.read_text(encoding="utf8"))
    chords = next(a for a in d["annotations"] if a["namespace"].startswith("chord"))
    segs = []
    for o in chords["data"]:
        lab = str(o["value"])
        try:
            mir_eval.chord.encode(lab)
        except Exception:  # noqa: BLE001  unreadable label → excluded
            lab = "X"
        segs.append((float(o["time"]), float(o["time"]) + float(o["duration"]), lab))
    keys = [a for a in d["annotations"] if a["namespace"].startswith("key")]
    meta = d["file_metadata"]
    return {
        "title": meta.get("title", ""),
        "artist": meta.get("artist", ""),
        "duration": float(meta.get("duration") or segs[-1][1]),
        "segs": segs,
        "key": keys[0]["data"][0]["value"] if keys and keys[0]["data"] else None,
        "corpus": chords.get("annotation_metadata", {}).get("corpus", ""),
    }


def find_on_spotify(sp: Spotify, title: str, artist: str, duration_s: float) -> dict | None:
    """The search hit for title + artist whose length is closest to the annotated audio (within 8 s)."""
    t = re.sub(r"\s*\(.*?\)", "", title)
    best = None
    for q in (f"track:{t} artist:{artist}", f"{t} {artist}"):
        r = sp.call("GET", "/search", params={"q": q, "type": "track", "limit": 10})
        if r.status_code != 200:
            continue
        for x in r.json()["tracks"]["items"]:
            if t.lower()[:12] not in x["name"].lower():
                continue
            dd = abs(x["duration_ms"] / 1000 - duration_s)
            if dd <= 8 and (best is None or dd < best[0]):
                best = (dd, x)
        if best:
            break
    return best[1] if best else None


def _root(label: str) -> int:
    if label in ("N", "X"):
        return -1
    root = label.split(":")[0].split("/")[0]
    return (PC[root[0]] + root.count("#") - root.count("b")) % 12


def best_offset(segs: list[tuple[float, float, str]], est: list[tuple[float, float, str]], span_s: float = 4.0):
    """Shift (s) to add to annotation times that maximises root agreement with `est` (Harte segments in track
    time), sampled every 50 ms; returns (shift, agreement, runner-up agreement ≥ 0.5 s away)."""
    t = np.arange(0, max(e for _, e, _ in est), 0.05)

    def roots(sg, times):
        out = np.full(len(times), -1)
        for s, e, lab in sg:
            out[(times >= s) & (times < e)] = _root(lab)
        return out

    re_ = roots(est, t)
    shifts = np.arange(-span_s, span_s + 1e-9, 0.02)
    scores = []
    for sh in shifts:
        ra = roots([(s + sh, e + sh, lab) for s, e, lab in segs], t)
        ok = (ra >= 0) & (re_ >= 0)
        scores.append(float((ra[ok] == re_[ok]).mean()) if ok.any() else 0.0)
    scores = np.array(scores)
    i = int(scores.argmax())
    far = np.abs(shifts - shifts[i]) >= 0.5
    return float(shifts[i]), float(scores[i]), float(scores[far].max()) if far.any() else 0.0


def truth_timeline(rec: dict, ann: dict, shift_s: float, beats_ms: np.ndarray) -> dict:
    chords = []
    for s, e, lab in ann["segs"]:
        a, b = (s + shift_s) * 1000, (e + shift_s) * 1000
        if lab == "X" or b <= 0 or a >= rec["durationMs"]:
            continue
        chords.append(
            {
                "startMs": round(max(a, 0), 1),
                "endMs": round(min(b, rec["durationMs"]), 1),
                "symbol": "N.C." if lab == "N" else lab,
                "harte": lab,
            }
        )
    return {
        "schema": "mq.timeline/1",
        "id": f"spotify:track:{rec['trackId']}",
        "source": "exact",
        "durationMs": rec["durationMs"],
        "createdAt": "2026-10-11T00:00:00.000Z",
        "generator": f"{ann['corpus'] or 'ChoCo'} human annotation, shifted {shift_s * 1000:+.0f} ms",
        "meter": {"num": 4, "den": 4},
        "beats": [round(float(b), 1) for b in beats_ms],
        "bars": [],
        "chords": chords,
        "keys": [],
        "tempo": [{"startMs": 0, "bpm": round(60000 / float(np.median(np.diff(beats_ms))), 1)}],
        "edits": [],
    }
