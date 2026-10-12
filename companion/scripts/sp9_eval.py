"""SP9 spike: vocal note transcription on vocadito (Bittner et al. 2021, CC BY 4.0), clean and mixed into pop backings.

    .venv/Scripts/python.exe scripts/sp9_eval.py [--methods fcpe,crepe,pyin,bp] [--mix 0] [--limit 40]

Conditions: `clean` = the solo voice; `mix` = voice + a pop instrumental (drums+bass+other from htdemucs on a truth
track) at --mix dB voice-to-backing, then `sep` = that mix separated again by htdemucs, and `raw` = the mix untouched.
Note F-measure per mir_eval (onset 50 ms, pitch 50 cents, no offset) against both annotators, plus octave errors.
"""

import argparse
import os
import sys
import time
from pathlib import Path

import mir_eval
import numpy as np
import soundfile as sf
import soxr

sys.path.insert(0, str(Path(__file__).parent))
from sp9_notes import f0_to_notes  # noqa: E402

WORK = Path(os.environ["LOCALAPPDATA"]) / "MusicQueery" / "work"
VOC = WORK / "sp9" / "data" / "vocadito"
BACKINGS = [
    "beatles--let-it-be",
    "billy-joel--just-the-way-you-are",
    "carole-king--its-too-late",
    "michael-jackson--human-nature",
    "queen--dont-stop-me-now",
    "stevie-wonder--higher-ground",
]
SR = 16000


# ---- pitch trackers: audio at 16 kHz -> (f0 Hz per 10 ms frame, voicing confidence 0..1) ----

_models: dict = {}


def model(key, make):
    if key not in _models:
        _models[key] = make()
    return _models[key]


def f0_fcpe(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    import torch
    from torchfcpe import spawn_bundled_infer_model

    m = model("fcpe", lambda: spawn_bundled_infer_model(device="cpu"))
    with torch.no_grad():
        f0 = m.infer(
            torch.from_numpy(x)[None, :, None],
            sr=SR,
            decoder_mode="local_argmax",
            threshold=0.006,
            f0_min=60,
            f0_max=1100,
            interp_uv=False,
            output_interp_target_length=len(x) // 160 + 1,
        )
    f0 = f0.squeeze().numpy()
    return f0, (f0 > 0).astype(float)


def f0_crepe(x: np.ndarray, model: str = "full") -> tuple[np.ndarray, np.ndarray]:
    import torch
    import torchcrepe

    with torch.no_grad():
        f0, per = torchcrepe.predict(
            torch.from_numpy(x)[None], SR, 160, 60, 1100, model, batch_size=2048, device="cpu", return_periodicity=True
        )
    per = torchcrepe.filter.median(per, 3)
    return f0.squeeze().numpy(), per.squeeze().numpy()


def f0_pyin(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    import librosa

    f0, _, prob = librosa.pyin(x, fmin=60, fmax=1100, sr=SR, frame_length=1024, hop_length=160, center=True)
    return np.nan_to_num(f0), prob


def notes_bp(x: np.ndarray) -> np.ndarray:
    """basic-pitch notes (ONNX model), made monophonic: the loudest note wins an overlap."""
    import tempfile

    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    from basic_pitch.inference import Model, predict

    m = model("bp", lambda: Model(build_icassp_2022_model_path(FilenameSuffix.onnx)))
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "x.wav"
        sf.write(p, x, SR)
        _, _, ev = predict(p, m, minimum_frequency=60, maximum_frequency=1100, multiple_pitch_bends=False)
    ev = sorted(ev, key=lambda e: -e[3])
    kept: list = []
    for s, e, p, _amp, _ in ev:
        if all(e <= ks or s >= ke for ks, ke, *_ in kept):
            kept.append((s, e, 440 * 2 ** ((p - 69) / 12)))
    kept.sort()
    return np.array(kept).reshape(-1, 3)


TRACKERS = {"fcpe": f0_fcpe, "crepe": f0_crepe, "crepe-tiny": lambda x: f0_crepe(x, "tiny"), "pyin": f0_pyin}


def transcribe(method: str, x: np.ndarray) -> tuple[np.ndarray, float]:
    t0 = time.perf_counter()
    if method == "bp":
        notes = notes_bp(x)
    else:
        f0, conf = TRACKERS[method](x)
        notes = f0_to_notes(f0, conf, hop=0.01)
    return notes, time.perf_counter() - t0


# ---- data ----


def load(path: Path) -> np.ndarray:
    x, sr = sf.read(path, dtype="float32", always_2d=True)
    return soxr.resample(x.mean(axis=1), sr, SR).astype(np.float32)


def ref_notes(i: int, who: str) -> np.ndarray:
    return np.loadtxt(VOC / "Annotations" / "Notes" / f"vocadito_{i}_notes{who}.csv", delimiter=",", ndmin=2)


def backing(i: int, n: int) -> np.ndarray:
    """A stretch of a pop instrumental (htdemucs drums+bass+other) as long as the voice, chosen per excerpt."""
    name = BACKINGS[i % len(BACKINGS)]
    cache = WORK / "sp9" / "backing" / f"{name}.flac"
    if not cache.exists():
        d = WORK / "sp9" / "htdemucs" / name
        acc = sum(load(d / f"{s}.flac") for s in ("drums", "bass", "other"))
        cache.parent.mkdir(parents=True, exist_ok=True)
        sf.write(cache, acc, SR)
    acc = load(cache)
    start = (37 * i * SR) % max(1, len(acc) - n - 30 * SR) + 20 * SR
    return acc[start : start + n]


def mix(voice: np.ndarray, acc: np.ndarray, db: float) -> np.ndarray:
    rms = lambda a: np.sqrt(np.mean(a[np.abs(a) > 1e-4] ** 2))  # noqa: E731
    y = voice + acc * rms(voice) / rms(acc) * 10 ** (-db / 20)
    return (y / np.abs(y).max() * 0.9).astype(np.float32)


def separate(y: np.ndarray) -> np.ndarray:
    import torch
    from demucs.api import Separator

    sep = model("demucs", lambda: Separator(model="htdemucs", shifts=0))
    wav = torch.from_numpy(soxr.resample(y, SR, 44100).astype(np.float32))[None].repeat(2, 1)
    _, stems = sep.separate_tensor(wav, 44100)
    return soxr.resample(stems["vocals"].mean(0).numpy(), 44100, SR).astype(np.float32)


# ---- scoring ----


def score(ref: np.ndarray, est: np.ndarray) -> dict:
    ri, rp = np.c_[ref[:, 0], ref[:, 0] + ref[:, 2]], ref[:, 1]
    if len(est) == 0:
        return {"f": 0.0, "p": 0.0, "r": 0.0, "f_off": 0.0, "onset_f": 0.0, "oct": 0, "matched": 0}
    ei, ep = est[:, :2], est[:, 2]
    p, r, f, _ = mir_eval.transcription.precision_recall_f1_overlap(
        ri, rp, ei, ep, onset_tolerance=0.05, pitch_tolerance=50, offset_ratio=None
    )
    _, _, f_off, _ = mir_eval.transcription.precision_recall_f1_overlap(
        ri, rp, ei, ep, onset_tolerance=0.05, pitch_tolerance=50
    )
    m = mir_eval.transcription.match_note_onsets(ri, ei, onset_tolerance=0.05)
    onset_f = 2 * len(m) / (len(ri) + len(ei))
    d = np.array([12 * np.log2(ep[j] / rp[i]) for i, j in m]) if m else np.zeros(0)
    octave = int(np.sum((np.abs(d) > 6) & (np.abs(d - 12 * np.round(d / 12)) < 0.5)))
    return {"f": f, "p": p, "r": r, "f_off": f_off, "onset_f": onset_f, "oct": octave, "matched": len(m)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--methods", default="fcpe,crepe,pyin,bp")
    ap.add_argument("--conds", default="clean,sep,raw")
    ap.add_argument("--mix", type=float, default=0.0, help="voice-to-backing ratio in dB")
    ap.add_argument("--limit", type=int, default=40)
    args = ap.parse_args()
    methods, conds = args.methods.split(","), args.conds.split(",")

    agree = [
        score(
            ref_notes(i, "A1"),
            np.c_[
                ref_notes(i, "A2")[:, 0], ref_notes(i, "A2")[:, 0] + ref_notes(i, "A2")[:, 2], ref_notes(i, "A2")[:, 1]
            ],
        )["f"]
        for i in range(1, args.limit + 1)
    ]
    print(f"annotator agreement A1 vs A2: F {np.mean(agree):.3f}")

    rows: dict = {}
    audio_s = 0.0
    for i in range(1, args.limit + 1):
        voice = load(VOC / "Audio" / f"vocadito_{i}.wav")
        audio_s += len(voice) / SR
        inputs = {}
        if "clean" in conds:
            inputs["clean"] = voice
        if "raw" in conds or "sep" in conds:
            y = mix(voice, backing(i, len(voice)), args.mix)
            if "raw" in conds:
                inputs["raw"] = y
            if "sep" in conds:
                inputs["sep"] = separate(y)
        for cond, x in inputs.items():
            for meth in methods:
                est, dt = transcribe(meth, x)
                for who in ("A1", "A2"):
                    s = score(ref_notes(i, who), est)
                    s["t"] = dt
                    rows.setdefault((cond, meth, who), []).append(s)
        print(f"{i}", end=" ", flush=True)
    print()
    print(
        f"{'cond':6} {'method':10} {'ann':3}  {'F':>5} {'P':>5} {'R':>5} {'F+off':>6} {'onsetF':>6} "
        f"{'oct%':>5} {'xRT':>6}"
    )
    for (cond, meth, who), ss in sorted(rows.items()):
        mean = lambda k, ss=ss: np.mean([s[k] for s in ss])  # noqa: E731
        octp = 100 * sum(s["oct"] for s in ss) / max(1, sum(s["matched"] for s in ss))
        print(
            f"{cond:6} {meth:10} {who:3}  {mean('f'):.3f} {mean('p'):.3f} {mean('r'):.3f} {mean('f_off'):6.3f} "
            f"{mean('onset_f'):6.3f} {octp:5.1f} {sum(s['t'] for s in ss) / audio_s:6.3f}"
        )


if __name__ == "__main__":
    main()
