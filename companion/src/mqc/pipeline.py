"""One track end to end: capture on this PC → analyse → validate → upload; audio deleted afterwards (D-18)."""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np

from . import analysis as A
from .capture import CaptureError, capture_track
from .config import COMPANION, WORK_DIR
from .spotify import Spotify
from .store import Store

DEFAULT_RECOGNISER = "auto"  # vote of BTC/Chordino/madmom as heard (D-38; handoffs/M3-analysis.md)
OUT_DIR = COMPANION / "out"


def analyse_audio(
    track_id: str,
    duration_ms: int,
    audio: np.ndarray,
    sr: int,
    recogniser: str = DEFAULT_RECOGNISER,
    beats: A.Beats | None = None,
    log=print,
    sp=None,
    melody_audio: np.ndarray | None = None,
) -> dict:
    """With `sp` (a Spotify client), a published chart for the track supplies the chord names when its alignment
    agrees with what we hear (D-40). With `melody_audio` (the capture, stereo if possible) the lead melody is
    transcribed too (M9)."""
    t0 = time.time()
    beats = beats or A.track_beats(audio, sr)
    ch = A.recognise(audio, sr, beats, recogniser)
    named = chart_names(sp, track_id, audio, sr, beats, ch, log) if sp and ch.per and not ch.sevenths else None
    if named:
        segs, chart_id = named
        tl, unparsed = A.build_timeline(
            track_id, duration_ms, beats, segs, f"mqc/{ch.name}+chart-names+beat_this", sevenths=False, harte=False
        )
        tl["chartId"] = chart_id
    else:
        tl, unparsed = A.build_timeline(
            track_id, duration_ms, beats, ch.segs, f"mqc/{ch.name}+beat_this", sevenths=ch.sevenths
        )
    if unparsed:
        log(f"  unparsed labels (stored as N.C.): {sorted(set(unparsed))}")
    if melody_audio is not None:
        add_melody(tl, melody_audio, sr, beats.beats, log)
    errs = A.validate_timeline(tl)
    if errs:
        raise ValueError(f"timeline invalid: {errs[:5]}")
    log(f"  analysed in {time.time() - t0:.0f} s: {A.summary(tl)}")
    return tl


def add_melody(tl: dict, audio: np.ndarray, sr: int, beats_s: np.ndarray, log=print) -> None:
    """Puts the lead melody into the timeline (M9, SP9). A failure only costs the melody, never the chords."""
    from .melody import melody

    try:
        m = melody(audio, sr, beats_s, log=log)
    except Exception as e:  # noqa: BLE001  the melody is optional
        log(f"  melody failed: {e}")
        return
    end = tl["durationMs"]
    tl["melody"] = [n for n in m.notes if n["startMs"] < end]
    for n in tl["melody"]:
        n["endMs"] = min(n["endMs"], end)
    log(
        f"  melody: {len(tl['melody'])} notes from the {m.stem} stem, tuning {m.tuning * 100:+.0f} cents "
        f"(separate {m.seconds['separate']:.0f} s, transcribe {m.seconds['transcribe']:.0f} s)"
    )


CHART_MIN_AGREEMENT = 0.80  # D-40: Something's capo chart (0.74) and Fly Me's (0.71) fall below; good charts 0.87–0.97


def chart_names(sp, track_id: str, audio: np.ndarray, sr: int, beats: A.Beats, ch: A.Chords, log=print):
    """(renamed segments, chartId) when a Chordonomicon chart exists and its alignment agrees with the recognisers on
    at least CHART_MIN_AGREEMENT of the beats; else None."""
    from . import charts as C

    try:
        cands = C.lookup(sp, track_id)
    except Exception as e:  # noqa: BLE001  a chart is optional
        log(f"  chart lookup failed: {e}")
        return None
    if not cands:
        return None
    res = C.align_best(cands, audio, sr, beats.beats, ch.segs)
    if res is None:
        return None
    al = res.alignment
    if al.agreement < CHART_MIN_AGREEMENT:
        log(f"  chart {res.chart.row_id} rejected: agrees on {al.agreement:.0%} of beats (shift {al.shift})")
        return None
    vocab = C.chart_vocabulary(C.parse(res.chart.chords), al.shift)
    log(f"  chart {res.chart.row_id}: agrees on {al.agreement:.0%} of beats, names {len(vocab)} chords")
    return C.rename_with_vocabulary(ch.segs, vocab), f"chordonomicon:{res.chart.row_id}"


def analyse_track(
    sp: Spotify,
    store: Store | None,
    track_id: str,
    recogniser: str = DEFAULT_RECOGNISER,
    device_name: str = "",
    retries: int = 1,
    log=print,
    with_melody: bool = True,
) -> dict:
    meta = sp.track(track_id)
    log(f"{meta['name']} — {', '.join(a['name'] for a in meta['artists'])} [{track_id}]")
    for attempt in range(retries + 1):
        try:
            cap = capture_track(sp, track_id, WORK_DIR, device_name, log=log)
            break
        except CaptureError as e:
            log(f"  capture failed: {e}")
            if attempt == retries:
                raise
    try:
        stereo = cap.track_audio(mono=False)
        tl = analyse_audio(
            track_id,
            cap.duration_ms,
            stereo.mean(axis=1),
            cap.rate,
            recogniser,
            log=log,
            sp=sp,
            melody_audio=stereo if with_melody else None,
        )
    finally:
        cap.delete()
    tl["title"] = meta["name"]  # not in the schema; stripped below, kept in the local copy
    local = dict(tl)
    tl.pop("title")
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / f"{track_id}.json").write_text(json.dumps(local, ensure_ascii=False), encoding="utf8")
    if store:
        res = store.put(tl)
        log(f"  uploaded {res['id']} ({res['bytes']} bytes)")
        store.log(
            [
                {
                    "lvl": "info",
                    "msg": "companion.analysed",
                    "id": tl["id"],
                    "title": meta["name"],
                    "chords": len(tl["chords"]),
                    "melody": len(tl.get("melody", [])),
                }
            ]
        )
    return tl


def read_track_list(path: Path) -> list[str]:
    return [ln.split("#")[0].strip() for ln in path.read_text(encoding="utf8").splitlines() if ln.split("#")[0].strip()]
