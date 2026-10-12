"""SP9 spike: does merging short notes into a touching neighbour a semitone away cost note F on vocadito (clean)?"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from sp9_eval import WORK, ref_notes, score  # noqa: E402

from mqc import melody as M  # noqa: E402

tracks = list(np.load(WORK / "sp9" / "vocadito-crepe-tiny.npy", allow_pickle=True))
refs = [(ref_notes(i, "A1"), ref_notes(i, "A2")) for i in range(1, 41)]


def hz(notes: np.ndarray, tune: float) -> np.ndarray:
    return np.c_[notes[:, 0], notes[:, 1], 440 * 2 ** ((notes[:, 2] + tune - 69) / 12)]


for max_dur in [0.0, 0.08, 0.12, 0.16, 0.2]:
    fs, counts = [], []
    for (f0, c), rr in zip(tracks, refs, strict=True):
        notes, tune = M.segment(f0, c)
        notes = M.merge_blips(notes, max_dur) if max_dur else notes
        counts.append(len(notes))
        fs += [score(r, hz(notes, tune))["f"] for r in rr]
    print(f"max_dur {max_dur:.2f}: F {np.mean(fs):.3f} notes {sum(counts)}")

