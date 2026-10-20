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

import numpy as np
import soxr

from . import bridge
from .config import LOCAL

Segments = list[tuple[float, float, str]]
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


def track_beats(audio: np.ndarray, sr: int, regular: bool = True) -> Beats:
    beats, downbeats = _beat_model()(audio, sr)
    b = Beats(np.asarray(beats, dtype=float), np.asarray(downbeats, dtype=float))
    return regularise(b) if regular else b


def regularise(b: Beats, glitch: float = 0.6) -> Beats:
    """One consistent beat level and no glitch bars. beat_this sometimes inserts a downbeat a fraction of a bar
    after the last one, and on music felt in 2 (samba, bossa) flips between half and quarter notes from bar to
    bar. Bars shorter than `glitch` × the median bar are merged into the bar before; then every bar of normal
    length gets the most common beat count (the faster level when counts k and 2k both occur), evenly spaced."""
    if len(b.downbeats) < 4:
        return b
    db = [float(b.downbeats[0])]
    med = float(np.median(np.diff(b.downbeats)))
    for t in b.downbeats[1:]:
        if t - db[-1] >= glitch * med:
            db.append(float(t))
    dbs = np.array(db)
    med = float(np.median(np.diff(dbs)))
    edges = np.append(dbs, dbs[-1] + med)
    counts = [
        int(((b.beats >= a - 0.03) & (b.beats < e - 0.03)).sum()) for a, e in zip(edges[:-1], edges[1:], strict=True)
    ]
    common = Counter(c for c in counts if 2 <= c <= 8)
    n = common.most_common(1)[0][0] if common else 4
    if any(c == 2 * n for c in common) and common[2 * n] >= 0.1 * len(counts):
        n *= 2
    out: list[float] = list(b.beats[b.beats < dbs[0] - 0.03])
    for (a, e), c in zip(zip(edges[:-1], edges[1:], strict=True), counts, strict=True):
        last = e > b.beats[-1] + 0.5 * med  # final bar: keep what was detected
        if not last and 0.75 * med <= e - a <= 1.33 * med and c != n:
            out += [a + (e - a) * k / n for k in range(n)]
        else:
            out += list(b.beats[(b.beats >= a - 0.03) & (b.beats < e - 0.03)])
    return Beats(np.array(sorted(out)), dbs)


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

VOTE_WEIGHTS = {"btc": 1.2, "chordino": 1.0, "madmom": 0.8}
SEVENTH_QUALITIES = {"7", "maj7", "min7", "hdim7", "dim7", "min6", "maj6", "minmaj7"}
JAZZ_SEVENTH_SHARE = 0.18  # SP4: BTC hears 7ths in 26-42% of jazz, 0.4-8% of pop (4 tracks; provisional)


def seventh_share(segs: Segments) -> float:
    """Share of the chorded time that a recogniser labelled with a 7th or 6th chord."""
    total = sev = 0.0
    for s, e, lab in segs:
        if lab in ("N", "X"):
            continue
        q = lab.split(":")[1].split("/")[0].split("(")[0] if ":" in lab else "maj"
        total += e - s
        sev += (e - s) * (q in SEVENTH_QUALITIES)
    return sev / total if total else 0.0


def _root(label: str) -> int | str:
    if label in ("N", "X"):
        return "N"
    import mir_eval

    return int(mir_eval.chord.pitch_class_to_semitone(label.split(":")[0].split("/")[0]))


def vote(
    per: dict[str, Segments], beats: np.ndarray, end_s: float, weights: dict[str, float] = VOTE_WEIGHTS
) -> Segments:
    """Per beat, the root most recognisers agree on (weighted); its label comes from the heaviest recogniser
    that chose that root, so BTC's large vocabulary supplies the quality whenever it agrees."""
    synced = {r: beat_sync(per[r], beats, end_s) for r in weights}
    edges = np.concatenate([[0.0], beats, [end_s]]) if beats[0] > 0.05 else np.concatenate([beats, [end_s]])
    idx = dict.fromkeys(weights, 0)
    out: Segments = []
    for a, b in zip(edges[:-1], edges[1:], strict=True):
        m = (a + b) / 2
        score: dict[int | str, float] = {}
        best_label: dict[int | str, tuple[float, str]] = {}
        for r, w in weights.items():
            segs = synced[r]
            while idx[r] < len(segs) and segs[idx[r]][1] <= m:
                idx[r] += 1
            lab = segs[idx[r]][2] if idx[r] < len(segs) and segs[idx[r]][0] <= m else "N"
            key = _root(lab)
            score[key] = score.get(key, 0.0) + w
            if key not in best_label or w > best_label[key][0]:
                best_label[key] = (w, lab)
        win = max(score, key=lambda k: score[k])
        out.append((float(a), float(b), best_label[win][1]))
    return beat_sync(out, beats, end_s)


@dataclass
class Chords:
    segs: Segments  # beat-synced
    sevenths: bool  # apply lead-sheet sevenths (jazz detected)
    share: float
    name: str
    per: dict[str, Segments] | None = None  # each recogniser's raw output (for chart alignment)


def recognise(audio: np.ndarray, sr: int, beats: Beats, recogniser: str = "auto") -> Chords:
    """`auto` (default): 3-way vote as heard, no added sevenths (D-38). `auto+7ths`: the vote with lead-sheet sevenths
    when BTC hears enough 7ths (the M3 gate, D-34; hurt human-annotated pop, kept for jazz experiments).
    Any single recogniser name: that one alone."""
    end = len(audio) / sr
    if recogniser not in ("auto", "auto+7ths"):
        return Chords(beat_sync(RECOGNISERS[recogniser](audio, sr), beats.beats, end), False, 0.0, recogniser)
    per = {r: RECOGNISERS[r](audio, sr) for r in VOTE_WEIGHTS}
    share = seventh_share(per["btc"])
    jazz = recogniser == "auto+7ths" and share >= JAZZ_SEVENTH_SHARE
    return Chords(vote(per, beats.beats, end), jazz, share, "vote+7ths" if jazz else "vote", per)


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
    sevenths: bool = True,
    sections: list[tuple[int, int, str]] | None = None,
    harte: bool = True,
) -> tuple[dict, list[str]]:
    """Timeline v1 dict (validate with `validate_timeline`) and the labels the bridge could not read. Segment labels
    are Harte (recognisers) or, with `harte=False`, lead-sheet text (aligned charts)."""
    beats_ms = [round(float(t) * 1000, 1) for t in beats.beats]
    raw = [{"startMs": round(s * 1000, 1), "endMs": round(e * 1000, 1), "symbol": lab} for s, e, lab in segs]
    fin = bridge.finish(raw, beats_ms, harte=harte, sevenths=sevenths)
    num = meter_of(beats)
    bars = [{"startMs": round(float(t) * 1000, 1), "number": i + 1} for i, t in enumerate(beats.downbeats)]
    if sections:
        label_bars(bars, sections)
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


# ---------------------------------------------------------------- sections (experimental, not in the pipeline)
# M3 tried harmony-only segmentation: about half the boundaries right on standards, nothing on Let It Be (verse
# and chorus share chords). Timelines ship without section labels until this is solved (P-05, handoffs/M3).


def bar_features(audio: np.ndarray, sr: int, downbeats: np.ndarray, segs: Segments) -> np.ndarray:
    """Per bar: mean CQT chroma (12) plus the time share of each chord root (12), both L2-normalised."""
    import librosa

    a = resample(audio, sr, 22050)
    hop = 512
    chroma = librosa.feature.chroma_cqt(y=a, sr=22050, hop_length=hop)
    t = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=22050, hop_length=hop)
    edges = np.append(downbeats, downbeats[-1] + np.median(np.diff(downbeats)))
    feats = []
    for lo, hi in zip(edges[:-1], edges[1:], strict=True):
        c = chroma[:, (t >= lo) & (t < hi)]
        c = c.mean(axis=1) if c.size else np.zeros(12)
        r = np.zeros(12)
        for s, e, lab in segs:
            ov = min(e, hi) - max(s, lo)
            if ov > 0 and lab not in ("N", "X"):
                r[_root(lab)] += ov  # type: ignore[index]
        feats.append(np.concatenate([c / (np.linalg.norm(c) + 1e-9), r / (np.linalg.norm(r) + 1e-9)]))
    return np.array(feats)


def find_sections(
    feats: np.ndarray, kernel: int = 4, min_len: int = 4, same: float = 0.8
) -> list[tuple[int, int, str]]:
    """Segments [start bar, end bar) with labels. Boundaries are peaks of a checkerboard novelty curve over the
    bar self-similarity matrix (at least `min_len` bars apart, phrase lengths of 4 preferred); segments whose
    lagged similarity to an earlier one is >= `same` share its letter. An unrepeated first/last segment is
    Intro/Outro."""
    n = len(feats)
    if n < 2 * min_len:
        return [(0, n, "A")]
    S = np.clip(feats @ feats.T / 2, 0, 1)  # two normalised halves → cosine in [0, 1]
    k = kernel
    sign = np.outer(np.r_[-np.ones(k), np.ones(k)], np.r_[-np.ones(k), np.ones(k)])  # +1 within, -1 across
    pad = np.pad(S, k, mode="edge")
    nov = np.array([float((pad[i : i + 2 * k, i : i + 2 * k] * sign).sum()) for i in range(n)])
    nov = np.maximum(nov, 0)
    # greedy peak picking, preferring 4-bar phrase positions relative to bar 0
    order = sorted(range(1, n), key=lambda i: -(nov[i] * (1.25 if i % 4 == 0 else 1.0)))
    thresh = 0.35 * nov.max() if nov.max() > 0 else 1
    bounds = [0, n]
    for i in order:
        if nov[i] < thresh:
            break
        if all(abs(i - b) >= min_len for b in bounds):
            bounds.append(i)
    bounds.sort()
    spans = list(zip(bounds[:-1], bounds[1:], strict=True))

    def sim(a: tuple[int, int], b: tuple[int, int]) -> float:
        m = min(a[1] - a[0], b[1] - b[0])
        return float(np.mean([S[a[0] + j, b[0] + j] for j in range(m)]))

    labels: list[str] = []
    letters = iter("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    for i, sp in enumerate(spans):
        best = max(range(i), key=lambda j: sim(spans[j], sp), default=None)
        if best is not None and sim(spans[best], sp) >= same:
            labels.append(labels[best])
        else:
            labels.append(next(letters))
    counts = Counter(labels)
    if len(spans) > 2 and counts[labels[0]] == 1:
        labels[0] = "Intro"
    if len(spans) > 2 and counts[labels[-1]] == 1:
        labels[-1] = "Outro"
    return [(a, b, lab) for (a, b), lab in zip(spans, labels, strict=True)]


def label_bars(bars: list[dict], sections: list[tuple[int, int, str]]) -> None:
    """Writes `section` on the first bar of each segment and `pass` (nth time this letter is played) on all."""
    seen: Counter[str] = Counter()
    for a, b, lab in sections:
        seen[lab] += 1
        for i in range(a, min(b, len(bars))):
            bars[i]["pass"] = seen[lab]
        if a < len(bars):
            bars[a]["section"] = lab
