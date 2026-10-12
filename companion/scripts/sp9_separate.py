"""SP9 spike: separate truth tracks into stems and time it.

    .venv/Scripts/python.exe scripts/sp9_separate.py let-it-be [--model htdemucs] [--shifts 0]

Reads %LOCALAPPDATA%/MusicQueery/work/truth/<name>.flac, writes work/sp9/<model>/<name>/<stem>.flac.
"""

import argparse
import os
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

WORK = Path(os.environ["LOCALAPPDATA"]) / "MusicQueery" / "work"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="+")
    ap.add_argument("--model", default="htdemucs")
    ap.add_argument("--shifts", type=int, default=0)
    ap.add_argument("--threads", type=int, default=0)
    args = ap.parse_args()
    if args.threads:
        torch.set_num_threads(args.threads)

    from demucs.api import Separator

    t0 = time.perf_counter()
    sep = Separator(model=args.model, shifts=args.shifts, progress=False)
    print(f"load {time.perf_counter() - t0:.1f}s threads={torch.get_num_threads()} sr={sep.samplerate}")
    for name in args.names:
        audio, sr = sf.read(WORK / "truth" / f"{name}.flac", dtype="float32", always_2d=True)
        if audio.shape[1] == 1:
            audio = np.repeat(audio, 2, axis=1)
        wav = torch.from_numpy(np.ascontiguousarray(audio.T))
        if sr != sep.samplerate:
            import julius

            wav = julius.resample_frac(wav, sr, sep.samplerate)
        t0 = time.perf_counter()
        _, stems = sep.separate_tensor(wav, sep.samplerate)
        dt = time.perf_counter() - t0
        dur = wav.shape[1] / sep.samplerate
        out = WORK / "sp9" / args.model / name
        out.mkdir(parents=True, exist_ok=True)
        for stem, x in stems.items():
            sf.write(out / f"{stem}.flac", x.numpy().T, sep.samplerate)
        print(f"{name}: {dur:.0f}s audio, separated in {dt:.1f}s ({dt / dur:.2f}x)")


if __name__ == "__main__":
    main()
