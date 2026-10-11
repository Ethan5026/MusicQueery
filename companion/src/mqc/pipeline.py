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

DEFAULT_RECOGNISER = "auto"  # SP4: vote of BTC/Chordino/madmom, sevenths gated on jazz (handoffs/M3-analysis.md)
OUT_DIR = COMPANION / "out"


def analyse_audio(
    track_id: str,
    duration_ms: int,
    audio: np.ndarray,
    sr: int,
    recogniser: str = DEFAULT_RECOGNISER,
    beats: A.Beats | None = None,
    log=print,
) -> dict:
    t0 = time.time()
    beats = beats or A.track_beats(audio, sr)
    ch = A.recognise(audio, sr, beats, recogniser)
    tl, unparsed = A.build_timeline(
        track_id, duration_ms, beats, ch.segs, f"mqc/{ch.name}+beat_this", sevenths=ch.sevenths
    )
    if unparsed:
        log(f"  unparsed labels (stored as N.C.): {sorted(set(unparsed))}")
    errs = A.validate_timeline(tl)
    if errs:
        raise ValueError(f"timeline invalid: {errs[:5]}")
    log(f"  analysed in {time.time() - t0:.0f} s: {A.summary(tl)}")
    return tl


def analyse_track(
    sp: Spotify,
    store: Store | None,
    track_id: str,
    recogniser: str = DEFAULT_RECOGNISER,
    device_name: str = "",
    retries: int = 1,
    log=print,
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
        audio = cap.track_audio(mono=True)
        tl = analyse_audio(track_id, cap.duration_ms, audio, cap.rate, recogniser, log=log)
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
                }
            ]
        )
    return tl


def read_track_list(path: Path) -> list[str]:
    return [ln.split("#")[0].strip() for ln in path.read_text(encoding="utf8").splitlines() if ln.split("#")[0].strip()]
