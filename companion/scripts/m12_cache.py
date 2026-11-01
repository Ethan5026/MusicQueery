"""M12 spike: cache every recogniser's raw output on the truth audio, so post-processing can be tuned in seconds.

    .venv/Scripts/python.exe scripts/m12_cache.py [names...] [--stems] [--btc-pl PATH]

Writes work/m12/<name>.json: beats (beat_this, raw and regularised), and per recogniser the Harte segments on the mix
and (with --stems) on htdemucs bass + other, the stems ChordCue feeds BTC (research/alternative-approaches.md §1).
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from mqc import analysis as A  # noqa: E402
from mqc.config import WORK_DIR  # noqa: E402
from mqc.truth import TRUTH_AUDIO  # noqa: E402

OUT = WORK_DIR / "m12"


def bass_other(audio: np.ndarray, sr: int) -> tuple[np.ndarray, int]:
    """htdemucs bass + other (no vocals, no drums), mono at the separator's rate."""
    import torch

    from mqc.melody import _separator

    sep = _separator()
    x = audio if audio.ndim == 2 else audio[:, None]
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    x = A.resample(np.ascontiguousarray(x[:, :2], dtype=np.float32), sr, sep.samplerate)
    _, stems = sep.separate_tensor(torch.from_numpy(np.ascontiguousarray(x.T)), sep.samplerate)
    mix = (stems["bass"] + stems["other"]).mean(0).numpy().astype(np.float32)
    return mix, sep.samplerate


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("names", nargs="*")
    p.add_argument("--stems", action="store_true")
    p.add_argument("--btc-pl", help="a BTC checkpoint to run as an extra recogniser 'btcpl'")
    a = p.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    names = a.names or sorted(f.stem for f in TRUTH_AUDIO.glob("*.flac"))
    for name in names:
        path = OUT / f"{name}.json"
        rec = json.loads(path.read_text(encoding="utf8")) if path.exists() else {}
        stereo, sr = sf.read(TRUTH_AUDIO / f"{name}.flac", dtype="float32", always_2d=True)
        audio = stereo.mean(axis=1)
        t0 = time.time()
        if "beats" not in rec:
            raw = A.track_beats(audio, sr, regular=False)
            reg = A.regularise(raw)
            rec["end"] = len(audio) / sr
            rec["beats"] = {
                "raw": [raw.beats.tolist(), raw.downbeats.tolist()],
                "reg": [reg.beats.tolist(), reg.downbeats.tolist()],
            }
        rec.setdefault("mix", {})
        for r in A.RECOGNISERS:
            if r not in rec["mix"]:
                rec["mix"][r] = A.RECOGNISERS[r](audio, sr)
        if a.btc_pl and "btcpl" not in rec["mix"]:
            rec["mix"]["btcpl"] = A.chords_btc(audio, sr, checkpoint=a.btc_pl)
        if a.stems and "stems" not in rec:
            mix, ssr = bass_other(stereo, sr)
            rec["stems"] = {r: A.RECOGNISERS[r](mix, ssr) for r in A.RECOGNISERS}
            if a.btc_pl:
                rec["stems"]["btcpl"] = A.chords_btc(mix, ssr, checkpoint=a.btc_pl)
        if a.stems and a.btc_pl and "btcpl" not in rec.get("stems", {}):
            mix, ssr = bass_other(stereo, sr)
            rec["stems"]["btcpl"] = A.chords_btc(mix, ssr, checkpoint=a.btc_pl)
        path.write_text(json.dumps(rec), encoding="utf8")
        print(f"{name}: {time.time() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    main()
