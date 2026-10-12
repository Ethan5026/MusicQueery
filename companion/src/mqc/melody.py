"""Lead melody (M9, SP9): separate the lead with htdemucs, track its pitch with CREPE-tiny, cut notes by Viterbi.

Notes are semitones (MIDI, concert pitch) on the track's own tuning, onsets and ends snapped to sixteenths of the beat
grid. SP9 on vocadito (40 solo-singing excerpts, Bittner et al. 2021): note F 0.70 clean against two annotators who
agree with each other at 0.74; mixed into pop backings at 0 dB and separated again, 0.6 (handoffs/M9-melody.md).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from functools import cache

import numpy as np

from .analysis import resample

PITCH_SR = 16000
HOP_S = 0.01
F_MIN, F_MAX = 60.0, 1100.0
MIN_SUNG_SHARE = 0.12  # under this share of the track voiced in the vocal stem, try the "other" stem (instrumentals)


@dataclass
class Melody:
    notes: list[dict]  # {startMs, endMs, midi, confidence, stem}
    stem: str
    tuning: float  # semitones off A440, -0.5..0.5
    seconds: dict[str, float]


@cache
def _separator():
    from demucs.api import Separator

    return Separator(model="htdemucs", shifts=0)


def separate(audio: np.ndarray, sr: int) -> dict[str, np.ndarray]:
    """Mono stems at PITCH_SR. `audio` is (n,) or (n, channels)."""
    import torch

    sep = _separator()
    x = audio if audio.ndim == 2 else audio[:, None]
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    x = resample(np.ascontiguousarray(x[:, :2], dtype=np.float32), sr, sep.samplerate)
    _, stems = sep.separate_tensor(torch.from_numpy(np.ascontiguousarray(x.T)), sep.samplerate)
    return {k: resample(v.mean(0).numpy().astype(np.float32), sep.samplerate, PITCH_SR) for k, v in stems.items()}


def pitch(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(f0 Hz, periodicity 0..1) per 10 ms frame of mono audio at PITCH_SR."""
    import torch
    import torchcrepe

    with torch.no_grad():
        f0, per = torchcrepe.predict(
            torch.from_numpy(x)[None],
            PITCH_SR,
            int(PITCH_SR * HOP_S),
            F_MIN,
            F_MAX,
            "tiny",
            batch_size=2048,
            device="cpu",
            return_periodicity=True,
        )
        per = torchcrepe.filter.median(per, 3)
    return f0.squeeze(0).numpy().astype(float), per.squeeze(0).numpy().astype(float)


def tuning_of(midi: np.ndarray) -> float:
    """Circular mean of the distance from the 12-TET grid, in semitones (-0.5..0.5)."""
    return float(np.angle(np.mean(np.exp(2j * np.pi * midi))) / (2 * np.pi)) if len(midi) else 0.0


def segment(
    f0: np.ndarray,
    conf: np.ndarray,
    hop: float = HOP_S,
    sigma: float = 0.8,
    switch: float = 16.0,
    voice: float = 5.0,
    min_dur: float = 0.05,
    uv_weight: float = 4.0,
    tune: float | None = None,
) -> tuple[np.ndarray, float]:
    """Notes as rows (start s, end s, midi int, confidence) and the tuning, by Viterbi over semitones plus silence.

    Each frame pays a Gaussian misfit to its semitone (so vibrato and drift stay on one note) and a voicing cost; the
    path pays `switch` to change note and `voice` to start or stop one. Runs shorter than `min_dur` (scoops, falls)
    join the note they lead into, or the one before. Costs swept on vocadito (SP9): a plateau around these values.
    """
    f0 = np.asarray(f0, float)
    conf = np.clip(np.nan_to_num(np.asarray(conf, float)), 0, 1)
    voiced = f0 > 0
    if voiced.sum() < 3:
        return np.zeros((0, 4)), 0.0
    midi = np.where(voiced, 69 + 12 * np.log2(np.where(voiced, f0, 440) / 440), 0.0)
    sure = voiced & (conf > 0.5)
    if tune is None:
        tune = tuning_of(midi[sure] if sure.any() else midi[voiced])
    m = midi - tune
    lo, hi = int(np.floor(m[voiced].min())) - 1, int(np.ceil(m[voiced].max())) + 1
    states = np.arange(lo, hi + 1)
    n_t, n_s = len(f0), len(states) + 1  # state 0 = silence

    c = np.where(voiced, conf, 0.0)
    cost = np.empty((n_t, n_s))
    cost[:, 0] = uv_weight * c
    d = (m[:, None] - states[None, :]) / sigma
    cost[:, 1:] = np.minimum(0.5 * d * d, 12) + uv_weight * (1 - c[:, None])
    cost[~voiced, 1:] = uv_weight + 2

    acc = cost[0].copy()
    back = np.zeros((n_t, n_s), np.int32)
    idx = np.arange(n_s)
    for t in range(1, n_t):
        p = 1 + int(np.argmin(acc[1:]))
        from_note, from_sil = acc[p] + switch, acc[0] + voice
        alt, alt_i = (from_sil, 0) if from_sil < from_note else (from_note, p)
        new = np.empty(n_s)
        b = idx.copy()
        keep = acc[1:] <= alt
        new[1:] = np.where(keep, acc[1:], alt)
        b[1:] = np.where(keep, idx[1:], alt_i)
        if acc[0] <= acc[p] + voice:
            new[0], b[0] = acc[0], 0
        else:
            new[0], b[0] = acc[p] + voice, p
        back[t] = b
        acc = new + cost[t]
    path = np.empty(n_t, np.int32)
    path[-1] = int(np.argmin(acc))
    for t in range(n_t - 1, 0, -1):
        path[t - 1] = back[t, path[t]]

    edges = np.flatnonzero(np.diff(path)) + 1
    runs = [[s, e, path[s]] for s, e in zip(np.r_[0, edges], np.r_[edges, n_t], strict=True) if path[s] != 0]
    min_f = max(1, round(min_dur / hop))
    out: list[list[int]] = []
    pending: int | None = None  # start of short runs waiting for the note they lead into
    for i, (s, e, k) in enumerate(runs):
        if e - s >= min_f:
            out.append([s if pending is None else pending, e, k])
            pending = None
        elif i + 1 < len(runs) and runs[i + 1][0] == e:
            pending = s if pending is None else pending
        else:
            if out and out[-1][1] == s:
                out[-1][1] = e
            pending = None
    rows = [
        (s * hop, e * hop, core_pitch(m, voiced, s, e, int(states[k - 1])), float(np.mean(conf[s:e])))
        for s, e, k in out
    ]
    return np.array(rows, dtype=float).reshape(-1, 4), tune


def core_pitch(m: np.ndarray, voiced: np.ndarray, s: int, e: int, fallback: int) -> int:
    """The semitone of the middle of a note (its first and last fifth left out): the path keeps the semitone that fits
    the whole span, so a fall at the end of a note drags it down a semitone; the sung core does not."""
    n = e - s
    cut = n // 5
    seg = m[s + cut : e - cut][voiced[s + cut : e - cut]]
    return int(np.round(np.median(seg))) if len(seg) else fallback


def merge_blips(notes: np.ndarray, max_dur: float = 0.12, touch: float = 0.02) -> np.ndarray:
    """Short notes touching a neighbour a semitone away are slides into or out of it (scoops, falls, blue-note bends):
    they join the neighbour, the longer one when both qualify, and the note keeps the neighbour's pitch."""
    rows = [list(r) for r in notes]
    changed = True
    while changed:
        changed = False
        for i, r in enumerate(rows):
            if r[1] - r[0] >= max_dur:
                continue
            prev = rows[i - 1] if i > 0 and r[0] - rows[i - 1][1] <= touch else None
            nxt = rows[i + 1] if i + 1 < len(rows) and rows[i + 1][0] - r[1] <= touch else None
            cands = [n for n in (prev, nxt) if n is not None and abs(n[2] - r[2]) == 1]
            if not cands:
                continue
            into = max(cands, key=lambda n: n[1] - n[0])
            into[0], into[1] = min(into[0], r[0]), max(into[1], r[1])
            del rows[i]
            changed = True
            break
    return np.array(rows, dtype=float).reshape(-1, notes.shape[1] if notes.ndim == 2 else 4)


def sixteenths(beats_s: np.ndarray, end_s: float) -> np.ndarray:
    """Grid of four points a beat, the last beat's period carried to the end of the track."""
    b = np.asarray(beats_s, float)
    if len(b) < 2:
        return np.arange(0, end_s + 0.125, 0.125)
    period = float(np.median(np.diff(b[-8:])))
    before = np.arange(b[0] - period, -period, -period)[::-1]
    after = np.arange(b[-1] + period, end_s + period, period)
    full = np.r_[before, b, after]
    pts = (full[:-1, None] + np.diff(full)[:, None] * np.arange(4)[None, :] / 4).ravel()
    return np.r_[pts, full[-1]]


def snap(notes: np.ndarray, grid: np.ndarray) -> np.ndarray:
    """Onsets and ends to the nearest grid point; a note keeps at least one step; overlaps end at the next onset."""
    if not len(notes):
        return notes
    out = notes.copy()
    si = np.clip(np.searchsorted(grid, notes[:, 0]), 1, len(grid) - 1)
    si -= notes[:, 0] - grid[si - 1] < grid[si] - notes[:, 0]
    ei = np.clip(np.searchsorted(grid, notes[:, 1]), 1, len(grid) - 1)
    ei -= notes[:, 1] - grid[ei - 1] < grid[ei] - notes[:, 1]
    ei = np.minimum(np.maximum(ei, si + 1), len(grid) - 1)
    # two notes on one grid point: keep the longer one
    keep = np.ones(len(out), bool)
    for i in range(1, len(out)):
        j = i - 1
        while j >= 0 and not keep[j]:
            j -= 1
        if j >= 0 and si[i] == si[j]:
            if notes[i, 1] - notes[i, 0] > notes[j, 1] - notes[j, 0]:
                keep[j] = False
            else:
                keep[i] = False
    si, ei, out = si[keep], ei[keep], out[keep]
    ei[:-1] = np.minimum(ei[:-1], si[1:])
    out[:, 0], out[:, 1] = grid[si], grid[ei]
    return out


def transcribe_stem(x: np.ndarray, beats_s: np.ndarray) -> tuple[np.ndarray, float]:
    f0, per = pitch(x)
    notes, tune = segment(f0, per)
    return snap(merge_blips(notes), sixteenths(beats_s, len(x) / PITCH_SR)), tune


def melody(audio: np.ndarray, sr: int, beats_s: np.ndarray, log=print) -> Melody:
    """The lead line of a track: the vocal stem, or the "other" stem when hardly anything is sung."""
    t0 = time.perf_counter()
    stems = separate(audio, sr)
    t1 = time.perf_counter()
    dur = len(stems["vocals"]) / PITCH_SR
    stem = "vocals"
    notes, tune = transcribe_stem(stems[stem], beats_s)
    sung = float((notes[:, 1] - notes[:, 0]).sum()) / dur if len(notes) else 0.0
    if sung < MIN_SUNG_SHARE:
        other, tune_o = transcribe_stem(stems["other"], beats_s)
        log(f"  melody: vocals cover {sung:.0%} of the track, using the other stem")
        stem, notes, tune = "other", other, tune_o
    t2 = time.perf_counter()
    rows = [
        {
            "startMs": round(max(s, 0) * 1000, 1),
            "endMs": round(e * 1000, 1),
            "midi": int(k),
            "confidence": round(c, 2),
            "stem": stem,
        }
        for s, e, k, c in notes
        if e > s
    ]
    return Melody(rows, stem, tune, {"separate": t1 - t0, "transcribe": t2 - t1})
