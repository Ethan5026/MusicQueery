"""Beat, chord and key analysis of one track's audio → Timeline v1 (SP4 picks the chord recogniser).

Everything takes mono float32 audio at `sr` that starts at track position 0. Chord recognisers return Harte
labels as (start_s, end_s, label); `beat_sync` snaps them to the beat grid; the theory bridge spells them
and finds key regions.
"""

from __future__ import annotations

import os
import statistics
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import cache
from pathlib import Path

import numpy as np
import soxr

from . import bridge

Segments = list[tuple[float, float, str]]
LOCAL = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "MusicQueery"
VAMP_DIR = LOCAL / "vamp"
BTC_DIR = LOCAL / "dl" / "BTC-ISMIR19-master"


def resample(audio: np.ndarray, sr: int, to: int) -> np.ndarray:
    return audio if sr == to else soxr.resample(audio, sr, to).astype(np.float32)


# ---------------------------------------------------------------- beats


@dataclass
class Beats:
    beats: np.ndarray  # seconds
    downbeats: np.ndarray  # seconds, a subset of beats


@cache
def _beat_model():
    from beat_this.inference import Audio2Beats

    return Audio2Beats(checkpoint_path="final0", device="cpu", dbn=False)


def track_beats(audio: np.ndarray, sr: int) -> Beats:
    beats, downbeats = _beat_model()(audio, sr)
    return Beats(np.asarray(beats, dtype=float), np.asarray(downbeats, dtype=float))


def meter_of(b: Beats) -> int:
    """Beats per bar: the most common count of beats between downbeats (4 if unclear)."""
    if len(b.downbeats) < 3:
        return 4
    idx = np.searchsorted(b.beats, b.downbeats - 1e-3)
    counts = Counter(int(n) for n in np.diff(idx) if 2 <= n <= 7)
    return counts.most_common(1)[0][0] if counts else 4


def tempo_map(b: Beats, window: int = 16, step_bpm: float = 3.0) -> list[dict]:
    """Tempo changes: median BPM over `window` beats, a new entry when it moves by `step_bpm` or more."""
    if len(b.beats) < 4:
        return [{"startMs": 0, "bpm": 120}]
    ibi = np.diff(b.beats)
    out: list[dict] = []
    for i in range(0, len(ibi), window):
        bpm = 60 / float(np.median(ibi[i : i + window]))
        if not out or abs(bpm - out[-1]["bpm"]) >= step_bpm:
            out.append({"startMs": 0 if not out else round(float(b.beats[i]) * 1000, 1), "bpm": round(bpm, 1)})
    return out


# ---------------------------------------------------------------- chord recognisers


def chords_chordino(audio: np.ndarray, sr: int) -> Segments:
    os.environ.setdefault("VAMP_PATH", str(VAMP_DIR))
    import vamp

    a = resample(audio, sr, 44100)
    res = vamp.collect(a, 44100, "nnls-chroma:chordino", output="simplechord", parameters={"usehartesyntax": 1})
    events = [(float(e["timestamp"]), e["label"]) for e in res["list"]]
    end = len(a) / 44100
    return [(t, events[i + 1][0] if i + 1 < len(events) else end, lab) for i, (t, lab) in enumerate(events)]


def chords_madmom(audio: np.ndarray, sr: int, model: str = "deepchroma") -> Segments:
    """madmom's maj/min baselines: deep chroma + CRF, or the CNN feature + CRF."""
    from madmom.audio.signal import Signal

    sig = Signal(resample(audio, sr, 44100), sample_rate=44100, num_channels=1)
    if model == "deepchroma":
        from madmom.audio.chroma import DeepChromaProcessor
        from madmom.features.chords import DeepChromaChordRecognitionProcessor

        labels = DeepChromaChordRecognitionProcessor()(DeepChromaProcessor()(sig))
    else:
        from madmom.features.chords import CNNChordFeatureProcessor, CRFChordRecognitionProcessor

        labels = CRFChordRecognitionProcessor()(CNNChordFeatureProcessor()(sig))
    return [(float(s), float(e), str(lab)) for s, e, lab in labels]


@cache
def _btc():
    import torch
    import yaml

    if not BTC_DIR.exists():
        raise RuntimeError(f"BTC not found at {BTC_DIR}: run `mqc fetch-btc`")
    sys.path.insert(0, str(BTC_DIR))
    if not hasattr(np, "float"):
        np.float = float  # type: ignore[attr-defined]  # BTC's code predates numpy 2
    from btc_model import BTC_model  # type: ignore[import-not-found]
    from utils.hparams import HParams  # type: ignore[import-not-found]

    cfg = HParams(**yaml.safe_load((BTC_DIR / "run_config.yaml").read_text()))
    cfg.feature["large_voca"] = True
    cfg.model["num_chords"] = 170
    ckpt = torch.load(BTC_DIR / "test" / "btc_model_large_voca.pt", map_location="cpu", weights_only=False)
    model = BTC_model(config=cfg.model)
    model.load_state_dict(ckpt["model"])
    model.eval()
    return model, cfg, ckpt["mean"], ckpt["std"]


BTC_QUALITIES = [
    "min",
    "maj",
    "dim",
    "aug",
    "min6",
    "maj6",
    "min7",
    "minmaj7",
    "maj7",
    "7",
    "dim7",
    "hdim7",
    "sus2",
    "sus4",
]
BTC_ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _btc_label(i: int) -> str:
    if i == 169:
        return "N"
    if i == 168:
        return "X"
    return f"{BTC_ROOTS[i // 14]}:{BTC_QUALITIES[i % 14]}"


def chords_btc(audio: np.ndarray, sr: int) -> Segments:
    """BTC large-vocabulary transformer (Park et al., ISMIR 2019), same features as its test.py."""
    import librosa
    import torch

    model, cfg, mean, std = _btc()
    hz = cfg.mp3["song_hz"]
    a = resample(audio, sr, hz)
    inst = int(hz * cfg.mp3["inst_len"])
    parts = [a[i : i + inst] for i in range(0, len(a), inst)]
    feat = np.concatenate(
        [
            librosa.cqt(
                p,
                sr=hz,
                n_bins=cfg.feature["n_bins"],
                bins_per_octave=cfg.feature["bins_per_octave"],
                hop_length=cfg.feature["hop_length"],
            )
            for p in parts
            if len(p) > cfg.feature["hop_length"]
        ],
        axis=1,
    )
    feat = (np.log(np.abs(feat) + 1e-6).T - mean) / std
    frame_s = cfg.mp3["inst_len"] / cfg.model["timestep"]
    n_t = cfg.model["timestep"]
    n_frames = feat.shape[0]
    feat = np.pad(feat, ((0, (-n_frames) % n_t), (0, 0)))
    preds: list[int] = []
    with torch.no_grad():
        x = torch.tensor(feat, dtype=torch.float32).unsqueeze(0)
        for t in range(feat.shape[0] // n_t):
            out, _ = model.self_attn_layers(x[:, n_t * t : n_t * (t + 1), :])
            p, _ = model.output_layer(out)
            preds += p.squeeze(0).tolist()
    preds = preds[:n_frames]
    segs: Segments = []
    start = 0
    for i in range(1, len(preds) + 1):
        if i == len(preds) or preds[i] != preds[start]:
            segs.append((start * frame_s, i * frame_s, _btc_label(preds[start])))
            start = i
    return segs


RECOGNISERS = {
    "chordino": chords_chordino,
    "btc": chords_btc,
    "madmom": chords_madmom,
}


# ---------------------------------------------------------------- beat sync + timeline


def beat_sync(segs: Segments, beats: np.ndarray, end_s: float, min_beats: int = 1) -> Segments:
    """One label per beat (most overlap wins), merged; changes only on beats. Runs shorter than `min_beats`
    are absorbed by their longer neighbour."""
    if len(beats) < 2:
        return segs
    edges = np.concatenate([[0.0], beats, [end_s]]) if beats[0] > 0.05 else np.concatenate([beats, [end_s]])
    labels: list[str] = []
    j = 0
    for a, b in zip(edges[:-1], edges[1:], strict=True):
        while j < len(segs) and segs[j][1] <= a:
            j += 1
        best, best_ov = "N", 0.0
        k = j
        while k < len(segs) and segs[k][0] < b:
            ov = min(b, segs[k][1]) - max(a, segs[k][0])
            if ov > best_ov:
                best, best_ov = segs[k][2], ov
            k += 1
        labels.append(best)
    runs: list[list] = []  # [label, first edge index, count]
    for i, lab in enumerate(labels):
        if runs and runs[-1][0] == lab:
            runs[-1][2] += 1
        else:
            runs.append([lab, i, 1])
    if min_beats > 1:
        changed = True
        while changed:
            changed = False
            for r in range(len(runs)):
                if runs[r][2] < min_beats and len(runs) > 1:
                    left = runs[r - 1] if r > 0 else None
                    right = runs[r + 1] if r + 1 < len(runs) else None
                    tgt = left if right is None or (left is not None and left[2] >= right[2]) else right
                    if tgt is left:
                        left[2] += runs[r][2]
                    else:
                        right[1] = runs[r][1]
                        right[2] += runs[r][2]
                    del runs[r]
                    changed = True
                    break
            merged: list[list] = []
            for run in runs:
                if merged and merged[-1][0] == run[0]:
                    merged[-1][2] += run[2]
                else:
                    merged.append(run)
            runs = merged
    return [(float(edges[i]), float(edges[i + n]), lab) for lab, i, n in runs]


def build_timeline(
    track_id: str,
    duration_ms: int,
    beats: Beats,
    segs: Segments,
    generator: str,
    source: str = "analysed",
) -> tuple[dict, list[str]]:
    """Timeline v1 dict (validate with `validate_timeline`) and the labels the bridge could not read."""
    beats_ms = [round(float(t) * 1000, 1) for t in beats.beats]
    raw = [{"startMs": round(s * 1000, 1), "endMs": round(e * 1000, 1), "symbol": lab} for s, e, lab in segs]
    fin = bridge.finish(raw, beats_ms, harte=True)
    num = meter_of(beats)
    bars = [{"startMs": round(float(t) * 1000, 1), "number": i + 1} for i, t in enumerate(beats.downbeats)]
    chords = [c for c in fin["chords"] if c["startMs"] < duration_ms]
    for c in chords:
        c["endMs"] = min(c["endMs"], duration_ms)
    tl = {
        "schema": "mq.timeline/1",
        "id": f"spotify:track:{track_id}",
        "source": source,
        "durationMs": duration_ms,
        "createdAt": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "generator": generator,
        "meter": {"num": num, "den": 4},
        "beats": beats_ms,
        "bars": bars,
        "chords": chords,
        "keys": fin["keys"],
        "tempo": tempo_map(beats),
        "edits": [],
    }
    return tl, fin["unparsed"]


@cache
def _validator():
    import json

    from jsonschema import Draft202012Validator

    from .config import TIMELINE_SCHEMA

    return Draft202012Validator(json.loads(TIMELINE_SCHEMA.read_text(encoding="utf8")))


def validate_timeline(tl: dict) -> list[str]:
    """Errors against packages/model/schema/timeline.v1.json, plus ordering checks the schema can't express."""
    errs = [f"{'/'.join(map(str, e.path))}: {e.message}" for e in _validator().iter_errors(tl)]
    if errs:
        return errs
    if any(b <= a for a, b in zip(tl["beats"], tl["beats"][1:], strict=False)):
        errs.append("beats not ascending")
    for c in tl["chords"]:
        if c["endMs"] <= c["startMs"]:
            errs.append(f"empty chord span {c}")
    if any(b["startMs"] < a["endMs"] - 1 for a, b in zip(tl["chords"], tl["chords"][1:], strict=False)):
        errs.append("chords overlap")
    return errs


def summary(tl: dict) -> str:
    bpm = statistics.median(t["bpm"] for t in tl["tempo"])
    keys = ", ".join(f"{k['tonic']} {k['mode']}" for k in tl["keys"][:6])
    return f"{len(tl['chords'])} chords, {len(tl['beats'])} beats, ~{bpm:.0f} bpm, {tl['meter']['num']}/4, keys: {keys}"
