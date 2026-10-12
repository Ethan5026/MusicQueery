"""SP9 spike: sweep the note segmenter's costs on cached CREPE-tiny pitch of vocadito (clean)."""

import itertools
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from sp9_eval import VOC, WORK, f0_crepe, load, ref_notes, score  # noqa: E402
from sp9_notes import f0_to_notes  # noqa: E402

cache = WORK / "sp9" / "vocadito-crepe-tiny.npy"
if cache.exists():
    tracks = list(np.load(cache, allow_pickle=True))
else:
    tracks = [f0_crepe(load(VOC / "Audio" / f"vocadito_{i}.wav"), "tiny") for i in range(1, 41)]
    np.save(cache, np.array(tracks, dtype=object), allow_pickle=True)
refs = [(ref_notes(i, "A1"), ref_notes(i, "A2")) for i in range(1, 41)]
grid = dict(sigma=[0.6, 0.8, 1.0], switch=[11.0, 16.0, 24.0], voice=[5.0, 8.0], min_dur=[0.05], uv_weight=[4.0, 6.0])
res = []
for vals in itertools.product(*grid.values()):
    kw = dict(zip(grid, vals, strict=True))
    fs = np.array(
        [[score(r, f0_to_notes(f0, c, **kw))["f"] for r in rr] for (f0, c), rr in zip(tracks, refs, strict=True)]
    )
    res.append((fs.mean(), kw, fs[:20].mean(), fs[20:].mean()))
res.sort(key=lambda r: -r[0])
for f, kw, a, b in res[:10]:
    print(f"{f:.3f} halves {a:.3f} {b:.3f} {kw}")
