"""SP9 spike: pitch track -> notes by Viterbi over semitone states plus silence.

The path pays a Gaussian misfit per frame (so vibrato and drift stay on one semitone), a fixed cost to change note and
a smaller one to start or stop; tuning is taken from the whole track first. Runs shorter than `min_dur` (scoops, falls)
are given to the note they lead into, or the one before, rather than dropped, so onsets stay where the singer started.
"""

import numpy as np


def tuning_of(midi: np.ndarray) -> float:
    """Circular mean of the cents off the 12-TET grid, in semitones (-0.5..0.5)."""
    a = 2 * np.pi * midi
    return float(np.angle(np.mean(np.exp(1j * a))) / (2 * np.pi)) if len(midi) else 0.0


def f0_to_notes(
    f0: np.ndarray,
    conf: np.ndarray,
    hop: float = 0.01,
    sigma: float = 0.8,
    switch: float = 16.0,
    voice: float = 5.0,
    min_dur: float = 0.05,
    uv_weight: float = 4.0,
) -> np.ndarray:
    """(start s, end s, Hz) per note. Hz is the median of the note's frames, so out-of-tune singing stays measurable."""
    f0, conf = np.asarray(f0, float), np.clip(np.nan_to_num(np.asarray(conf, float)), 0, 1)
    voiced = f0 > 0
    if voiced.sum() < 3:
        return np.zeros((0, 3))
    midi = np.where(voiced, 69 + 12 * np.log2(np.where(voiced, f0, 440) / 440), 0.0)
    tune = tuning_of(midi[voiced & (conf > 0.5)] if (voiced & (conf > 0.5)).any() else midi[voiced])
    m = midi - tune
    lo, hi = int(np.floor(m[voiced].min())) - 1, int(np.ceil(m[voiced].max())) + 1
    states = np.arange(lo, hi + 1)
    n_t, n_s = len(f0), len(states) + 1  # state 0 = silence

    cost = np.empty((n_t, n_s))
    c = np.where(voiced, conf, 0.0)
    cost[:, 0] = uv_weight * c
    d = (m[:, None] - states[None, :]) / sigma
    cost[:, 1:] = np.minimum(0.5 * d * d, 12) + uv_weight * (1 - c[:, None])
    cost[~voiced, 1:] = uv_weight + 2

    acc = cost[0].copy()
    back = np.zeros((n_t, n_s), np.int32)
    for t in range(1, n_t):
        p_best = 1 + int(np.argmin(acc[1:]))
        stay = acc
        # into a note: stay, or come from another note (switch), or from silence (voice)
        from_note = acc[p_best] + switch
        from_sil = acc[0] + voice
        new = np.empty(n_s)
        b = np.arange(n_s)
        alt = np.where(from_sil < from_note, from_sil, from_note)
        alt_i = 0 if from_sil < from_note else p_best
        new[1:] = np.minimum(stay[1:], alt)
        b[1:] = np.where(stay[1:] <= alt, b[1:], alt_i)
        # into silence: stay, or stop a note
        if acc[0] <= acc[p_best] + voice:
            new[0], b[0] = acc[0], 0
        else:
            new[0], b[0] = acc[p_best] + voice, p_best
        back[t] = b
        acc = new + cost[t]
    path = np.empty(n_t, np.int32)
    path[-1] = int(np.argmin(acc))
    for t in range(n_t - 1, 0, -1):
        path[t - 1] = back[t, path[t]]

    # runs of one state
    edges = np.flatnonzero(np.diff(path)) + 1
    starts, ends = np.r_[0, edges], np.r_[edges, n_t]
    runs = [[s, e, path[s]] for s, e in zip(starts, ends, strict=True) if path[s] != 0]
    min_f = max(1, round(min_dur / hop))
    out: list[list[int]] = []
    pending: int | None = None  # start frame of short runs waiting for the note they lead into
    for i, (s, e, k) in enumerate(runs):
        if e - s >= min_f:
            out.append([s if pending is None else pending, e, k])
            pending = None
            continue
        nxt = runs[i + 1] if i + 1 < len(runs) else None
        if nxt is not None and nxt[0] == e:
            pending = s if pending is None else pending
        elif out and out[-1][1] == s:
            out[-1][1] = e
            pending = None
        else:
            pending = None
    notes = []
    for s, e, _k in out:
        seg = f0[s:e][voiced[s:e]]
        notes.append((s * hop, e * hop, float(np.median(seg)) if len(seg) else 0.0))
    return np.array([n for n in notes if n[2] > 0]).reshape(-1, 3)
