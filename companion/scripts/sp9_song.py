"""SP9 spike: transcribe the vocal stem of a whole truth track and check it without a melody truth.

    .venv/Scripts/python.exe scripts/sp9_song.py beatles--let-it-be [--methods crepe-tiny,fcpe] [--from 0 --to 60]

Prints time per method and plausibility numbers: the share of sung time in the song's best major scale, on a tone of
the sounding chord (human chord truth), and the rate of leaps of 10+ semitones between neighbouring notes (octave
slips). Draws a piano roll of the chosen span with the chords to work/sp9/<name>.png.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from sp9_eval import SR, WORK, load, transcribe  # noqa: E402

TRUTH = Path(__file__).parents[1] / "truth"
PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
QUAL = {
    "maj": (0, 4, 7),
    "min": (0, 3, 7),
    "7": (0, 4, 7, 10),
    "maj7": (0, 4, 7, 11),
    "min7": (0, 3, 7, 10),
    "dim": (0, 3, 6),
    "aug": (0, 4, 8),
    "sus4": (0, 5, 7),
    "sus2": (0, 2, 7),
    "hdim7": (0, 3, 6, 10),
    "6": (0, 4, 7, 9),
    "min6": (0, 3, 7, 9),
    "9": (0, 4, 7, 10, 2),
    "maj6": (0, 4, 7, 9),
}


def harte_pcs(h: str) -> set[int]:
    if h in ("N", "X"):
        return set()
    root, _, rest = h.partition(":")
    r = PC[root[0]] + root[1:].count("#") - root[1:].count("b")
    q = rest.split("/")[0].split("(")[0] or "maj"
    return {(r + i) % 12 for i in QUAL.get(q, (0, 4, 7))}


def plausibility(notes: np.ndarray, chords: list[dict]) -> dict:
    if not len(notes):
        return {}
    midi = 69 + 12 * np.log2(notes[:, 2] / 440)
    pc = np.round(midi).astype(int) % 12
    dur = notes[:, 1] - notes[:, 0]
    major = np.array([0, 2, 4, 5, 7, 9, 11])
    scale = max(dur[np.isin(pc, (major + k) % 12)].sum() for k in range(12)) / dur.sum()
    on_chord = 0.0
    for (s, e, _), p, d in zip(notes, pc, dur, strict=True):
        mid = (s + e) / 2 * 1000
        c = next((c for c in chords if c["startMs"] <= mid < c["endMs"]), None)
        if c and p in harte_pcs(c.get("harte", "N")):
            on_chord += d
    near = np.diff(notes[:, 0]) < 0.4
    leaps = np.abs(np.diff(midi)) >= 10
    return {
        "notes/min": len(notes) / ((notes[-1, 1] - notes[0, 0]) / 60),
        "sung s": dur.sum(),
        "in scale": scale,
        "chord tone": on_chord / dur.sum(),
        "leaps%": 100 * (leaps & near).sum() / max(1, near.sum()),
        "range": f"{int(np.percentile(midi, 2))}-{int(np.percentile(midi, 98))}",
    }


def draw(path: Path, results: dict, chords: list[dict], t0: float, t1: float) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(len(results), 1, figsize=(18, 3.2 * len(results)), sharex=True, squeeze=False)
    for ax, (meth, notes) in zip(axes[:, 0], results.items(), strict=True):
        sel = notes[(notes[:, 1] > t0) & (notes[:, 0] < t1)]
        midi = 69 + 12 * np.log2(sel[:, 2] / 440)
        for (s, e, _), m in zip(sel, midi, strict=True):
            ax.add_patch(plt.Rectangle((s, round(m) - 0.4), e - s, 0.8, color="tab:blue"))
        for c in chords:
            s, e = c["startMs"] / 1000, c["endMs"] / 1000
            if e > t0 and s < t1:
                ax.axvline(s, color="0.8", lw=0.6)
                ax.text(max(s, t0), (midi.max() if len(midi) else 72) + 1.5, c["symbol"], fontsize=7)
        lo, hi = (midi.min() - 2, midi.max() + 3) if len(midi) else (48, 84)
        ax.set_ylim(lo, hi)
        ax.set_yticks(range(int(lo), int(hi) + 1, 1))
        ax.set_yticklabels([("C" + str(m // 12 - 1)) if m % 12 == 0 else "" for m in range(int(lo), int(hi) + 1)])
        ax.grid(axis="y", color="0.92")
        ax.set_title(meth, loc="left", fontsize=9)
    axes[-1, 0].set_xlim(t0, t1)
    fig.tight_layout()
    fig.savefig(path, dpi=80)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--methods", default="crepe-tiny,fcpe")
    ap.add_argument("--stem", default="vocals")
    ap.add_argument("--from", dest="t0", type=float, default=0)
    ap.add_argument("--to", dest="t1", type=float, default=40)
    args = ap.parse_args()
    x = load(WORK / "sp9" / "htdemucs" / args.name / f"{args.stem}.flac")
    chords = json.loads((TRUTH / f"{args.name}.timeline.json").read_text(encoding="utf8"))["chords"]
    dur = len(x) / SR
    results = {}
    for meth in args.methods.split(","):
        t = time.perf_counter()
        notes, _ = transcribe(meth, x)
        dt = time.perf_counter() - t
        results[meth] = notes
        p = plausibility(notes, chords)
        print(
            f"{args.name} {meth:10} {dt:6.1f}s ({dt / dur:.3f}x) "
            + " ".join(f"{k} {v:.2f}" if isinstance(v, float) else f"{k} {v}" for k, v in p.items())
        )
    out = WORK / "sp9" / f"{args.name}.png"
    draw(out, results, chords, args.t0, args.t1)
    print(out)
    np.save(WORK / "sp9" / f"{args.name}.notes.npy", results, allow_pickle=True)


if __name__ == "__main__":
    main()
