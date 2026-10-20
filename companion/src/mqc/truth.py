"""Hand-aligned ground truth for the SP4 bake-off and the M3 exit criteria.

`mqc tap` plays a track on this PC, captures it, and records key presses: ENTER on beat 1 of every bar,
SPACE on the other beats (or ENTER only, one per bar). Taps are stored in track milliseconds in
companion/truth/<name>.json; the captured audio stays in config.WORK_DIR/truth (never committed, deleted when M3
is done).

The same JSON then gets a `form` (written by hand) that says what is played over the tapped bars:
    "chart": {"playlist": "jazz1460", "title": "Autumn Leaves", "transpose": "F"},
    "form": [{"bars": 4}, {"chart": 6}, {"bars": 2}]
`{"bars": n}` is n bars nobody charted (excluded from scoring); `{"chart": k}` plays the expanded chart k times;
`{"bars": n, "chords": ["Cm7", "F7 B♭7", ...]}` gives the chords of each bar (split evenly);
`{"chartBars": n}` plays the first n bars of the chart once; any segment may carry `"atMs"` to start at the bar
nearest that time (skipped bars are uncharted). `mqc truth <name>` turns it into a
Timeline v1 (`source: exact`) in companion/truth/<name>.timeline.json.
"""

from __future__ import annotations

import json
import msvcrt
import threading
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from . import bridge
from .capture import capture_track
from .config import REPO, TRUTH_DIR, WORK_DIR
from .spotify import Spotify

TRUTH_AUDIO = WORK_DIR / "truth"


def truth_path(name: str) -> Path:
    return TRUTH_DIR / f"{name}.json"


def audio_path(name: str) -> Path:
    return TRUTH_AUDIO / f"{name}.flac"


def tap(sp: Spotify, track_id: str, name: str, device_name: str = "", keys: bool = True) -> dict:
    """Plays and captures the track while recording taps. Returns the saved truth record."""
    taps: list[tuple[int, str]] = []
    stop = threading.Event()

    def read_keys() -> None:
        while not stop.is_set():
            if msvcrt.kbhit():
                ch = msvcrt.getwch()
                t = time.perf_counter_ns()
                if ch in ("\r", "\n"):
                    taps.append((t, "bar"))
                elif ch == " ":
                    taps.append((t, "beat"))
                print("|" if ch in "\r\n" else ".", end="", flush=True)
            else:
                time.sleep(0.001)

    meta = sp.track(track_id)
    print(f"{meta['name']} — {', '.join(a['name'] for a in meta['artists'])} ({meta['duration_ms'] / 60000:.1f} min)")
    print("ENTER on beat 1 of every bar, SPACE on the other beats. Starting playback on this PC...")
    if keys:
        threading.Thread(target=read_keys, daemon=True).start()
    try:
        cap = capture_track(sp, track_id, TRUTH_AUDIO, device_name)
    finally:
        stop.set()
    print()
    qpc0 = cap.first_frame_ns
    tap_ms = [((t - qpc0) / 1e6 - cap.offset_ms, k) for t, k in taps]
    TRUTH_AUDIO.mkdir(parents=True, exist_ok=True)
    sf.write(audio_path(name), cap.track_audio(mono=True), cap.rate, format="FLAC")
    cap.delete()
    rec = load(name) if truth_path(name).exists() else {}
    rec.update(
        {
            "name": name,
            "trackId": track_id,
            "title": meta["name"],
            "artist": ", ".join(a["name"] for a in meta["artists"]),
            "durationMs": int(meta["duration_ms"]),
            "capture": {
                "offsetMs": round(cap.offset_ms, 1),
                "offsetMadMs": round(cap.offset_spread_ms, 1),
                "firstSoundMs": cap.first_sound_ms,
                "peak": round(cap.peak, 3),
            },
            **({"taps": [{"ms": round(ms, 1), "key": k} for ms, k in tap_ms if ms >= 0]} if keys else {}),
        }
    )
    rec.setdefault("chart", {"playlist": "jazz1460", "title": meta["name"]})
    rec.setdefault("form", [])
    rec.setdefault("taps", [])
    save(rec)
    n_bar = sum(1 for _, k in tap_ms if k == "bar")
    print(f"saved {truth_path(name)}: {len(tap_ms)} taps ({n_bar} bars)")
    return rec


def load(name: str) -> dict:
    return json.loads(truth_path(name).read_text(encoding="utf8"))


def save(rec: dict) -> None:
    TRUTH_DIR.mkdir(parents=True, exist_ok=True)
    truth_path(rec["name"]).write_text(json.dumps(rec, indent=1, ensure_ascii=False) + "\n", encoding="utf8")


def grid_from_taps(taps: list[dict], meter: int, latency_ms: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    """(beats_ms, downbeats_ms) from taps; `latency_ms` is subtracted (human + output delay, see calibrate).
    With ENTER-only tapping, beats are interpolated evenly inside each bar."""
    bars = np.array([t["ms"] for t in taps if t["key"] == "bar"]) - latency_ms
    all_taps = np.array([t["ms"] for t in taps]) - latency_ms
    if len(all_taps) > 1.5 * len(bars):  # both keys used
        return all_taps, bars
    beats = [b + (n - b) * k / meter for b, n in zip(bars[:-1], bars[1:], strict=True) for k in range(meter)]
    beats.append(bars[-1])
    return np.array(beats), bars


def calibrate(tapped_ms: np.ndarray, detected_ms: np.ndarray, window: float = 150) -> float:
    """Median lag of taps behind the nearest detected beat (only pairs within `window` ms)."""
    idx = np.clip(np.searchsorted(detected_ms, tapped_ms), 1, len(detected_ms) - 1)
    near = np.where(
        np.abs(detected_ms[idx] - tapped_ms) < np.abs(detected_ms[idx - 1] - tapped_ms),
        detected_ms[idx],
        detected_ms[idx - 1],
    )
    d = tapped_ms - near
    d = d[np.abs(d) < window]
    return float(np.median(d)) if len(d) else 0.0


def grid_from_madmom(audio: np.ndarray, sr: int, meter: int) -> tuple[np.ndarray, np.ndarray]:
    """(beats_ms, downbeats_ms) from madmom's RNN + DBN downbeat tracker: a grid independent of beat_this,
    used as truth when nobody tapped."""
    from madmom.audio.signal import Signal
    from madmom.features.downbeats import DBNDownBeatTrackingProcessor, RNNDownBeatProcessor

    from .analysis import resample

    act = RNNDownBeatProcessor()(Signal(resample(audio, sr, 44100), sample_rate=44100, num_channels=1))
    mm = DBNDownBeatTrackingProcessor(beats_per_bar=[meter], fps=100)(act)
    return mm[:, 0] * 1000, mm[mm[:, 1] == 1, 0] * 1000


def chart_meter(rec: dict) -> int:
    if not any("chart" in seg or "chartBars" in seg for seg in rec["form"]):
        return 4
    ch = rec["chart"]
    path = (
        ch["playlist"]
        if Path(ch["playlist"]).exists()
        else str(REPO / "packages" / "theory" / "corpus" / f"{ch['playlist']}.txt")
    )
    return bridge.call({"op": "chart", "playlist": path, "title": ch["title"]})["chart"]["meter"]["num"]


def build_truth(rec: dict, latency_ms: float, grid: tuple[np.ndarray, np.ndarray] | None = None) -> dict:
    """Timeline v1 of what was played, from the tapped grid and the form. Uncharted bars get no chord (gaps
    are scored as excluded)."""
    played_chart = None
    meter = 4
    if any("chart" in seg or "chartBars" in seg for seg in rec["form"]):
        ch = rec["chart"]
        playlist = ch["playlist"]
        path = playlist if Path(playlist).exists() else str(REPO / "packages" / "theory" / "corpus" / f"{playlist}.txt")
        res = bridge.call(
            {
                "op": "chart",
                "playlist": path,
                "title": ch["title"],
                **({"transpose": ch["transpose"]} if ch.get("transpose") else {}),
            }
        )
        played_chart = res["played"]
        meter = res["chart"]["meter"]["num"]
    beats, bars = grid if grid is not None else grid_from_taps(rec["taps"], meter, latency_ms)
    chords: list[dict] = []
    tl_bars: list[dict] = []
    bar_i = 0

    def bar_span(i: int) -> tuple[float, float] | None:
        if i + 1 < len(bars):
            return float(bars[i]), float(bars[i + 1])
        return None

    def put(symbol: str, a: float, b: float) -> None:
        if chords and chords[-1]["symbol"] == symbol and abs(chords[-1]["endMs"] - a) < 1:
            chords[-1]["endMs"] = round(b, 1)
        else:
            chords.append({"startMs": round(a, 1), "endMs": round(b, 1), "symbol": symbol})

    for seg in rec["form"]:
        if "atMs" in seg:  # anchor: this segment starts at the bar nearest this time
            bar_i = int(np.argmin(np.abs(bars - seg["atMs"])))
        if "chart" in seg or "chartBars" in seg:
            passes = [played_chart] * seg.get("chart", 0) or [played_chart[: seg["chartBars"]]]
            for p, bars_of_pass in enumerate(passes):
                for pb in bars_of_pass:
                    span = bar_span(bar_i)
                    if span is None:
                        break
                    a, b = span
                    tl_bars.append(
                        {
                            "startMs": round(a, 1),
                            "number": pb["number"],
                            "pass": p + 1,
                            **({"section": pb["section"]} if pb.get("section") else {}),
                        }
                    )
                    total = sum(c["beats"] for c in pb["chords"])
                    t = a
                    for c in pb["chords"]:
                        e = t + (b - a) * c["beats"] / total
                        put(c["symbol"], t, e)
                        t = e
                    bar_i += 1
        else:
            per_bar = seg.get("chords")
            for k in range(seg["bars"]):
                span = bar_span(bar_i)
                if span is None:
                    break
                if per_bar:
                    a, b = span
                    tl_bars.append({"startMs": round(a, 1), "number": k + 1})
                    group = per_bar[k].split()
                    for j, sym in enumerate(group):
                        put(sym, a + (b - a) * j / len(group), a + (b - a) * (j + 1) / len(group))
                bar_i += 1
    used = bar_i
    if used + 1 < len(bars):
        print(f"  note: {len(bars) - 1 - used} tapped bars after the form are uncharted")
    elif used + 1 > len(bars):
        print(f"  warning: form needs {used} bars but only {len(bars) - 1} were tapped")
    return {
        "schema": "mq.timeline/1",
        "id": f"spotify:track:{rec['trackId']}",
        "source": "exact",
        "durationMs": rec["durationMs"],
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        "generator": f"mqc.truth (taps, latency {latency_ms:.0f} ms)" if grid is None else "mqc.truth (madmom grid)",
        "meter": {"num": meter, "den": 4},
        "beats": [round(float(b), 1) for b in beats],
        "bars": tl_bars,
        "chords": chords,
        "keys": [],
        "tempo": [{"startMs": 0, "bpm": round(60000 / float(np.median(np.diff(beats))), 1)}],
        "edits": [],
    }
