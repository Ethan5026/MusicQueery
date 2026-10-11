"""Per-process capture of Spotify.exe (SP3) and alignment of the capture to track position.

The helper (capture/bin/mqcapture.exe) writes a WAV whose frame index is linear in QPC time. While it runs we
sample /me/player; each sample says "at perf_counter t the track was at progress p". With the WAV's first-packet
QPC time that gives offset = capture_ms(t) - p, constant while playback is continuous. The median offset maps
capture frames to track milliseconds.
"""

from __future__ import annotations

import json
import os
import statistics
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import psutil
import soundfile as sf

from .config import CAPTURE_EXE
from .spotify import PlayerState, Spotify, SpotifyError


class CaptureError(RuntimeError):
    pass


def spotify_root_pid() -> int:
    """The Spotify.exe whose parent is not Spotify.exe; INCLUDE_TARGET_PROCESS_TREE then covers the audio child."""
    procs = {p.pid: p for p in psutil.process_iter(["name", "ppid"]) if (p.info["name"] or "").lower() == "spotify.exe"}
    roots = [pid for pid, p in procs.items() if p.info["ppid"] not in procs]
    if not roots:
        raise CaptureError("Spotify.exe is not running")
    return min(roots, key=lambda pid: procs[pid].create_time())


class Recorder:
    """Runs mqcapture.exe for one process tree until stop()."""

    def __init__(self, pid: int, wav: Path) -> None:
        if not CAPTURE_EXE.exists():
            raise CaptureError(f"{CAPTURE_EXE} missing: run companion\\capture\\build.cmd")
        self.wav = wav
        self.events: list[dict] = []
        self.peak = 0.0
        self.proc = subprocess.Popen(
            [str(CAPTURE_EXE), "--pid", str(pid), "--out", str(wav)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )
        self._started = threading.Event()
        threading.Thread(target=self._read, daemon=True).start()
        if not self._started.wait(5):
            self.proc.kill()
            raise CaptureError(f"capture did not start: {self.events}")

    def _read(self) -> None:
        assert self.proc.stdout
        for line in self.proc.stdout:
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            self.events.append(ev)
            if ev.get("event") == "level":
                self.peak = max(self.peak, ev["peak"])
            if ev.get("event") in ("started", "error"):
                self._started.set()

    def stop(self) -> dict:
        if self.proc.poll() is None:
            assert self.proc.stdin
            self.proc.stdin.write("stop\n")
            self.proc.stdin.close()
            self.proc.wait(10)
        stopped = [e for e in self.events if e.get("event") == "stopped"]
        if not stopped:
            raise CaptureError(f"capture ended badly: {self.events[-3:]}")
        return stopped[-1]


@dataclass
class Capture:
    """A finished capture, mapped onto track time."""

    track_id: str
    duration_ms: int
    wav: Path
    rate: int
    offset_ms: float  # capture time (ms from the WAV's first frame) at track position 0
    offset_spread_ms: float  # median absolute deviation of the per-sample offsets
    samples: list[PlayerState] = field(default_factory=list)
    peak: float = 0.0
    first_sound_ms: float | None = None  # first non-silent capture time, for the SP3 alignment check

    def track_audio(self, mono: bool = True) -> np.ndarray:
        """The captured audio from track position 0 to duration, zero-padded where nothing was captured."""
        data, rate = sf.read(self.wav, dtype="float32", always_2d=True)
        start = int(round(self.offset_ms * rate / 1000))
        n = int(round(self.duration_ms * rate / 1000))
        out = np.zeros((n, data.shape[1]), dtype=np.float32)
        src_lo, dst_lo = max(start, 0), max(-start, 0)
        m = max(0, min(n - dst_lo, len(data) - src_lo))
        out[dst_lo : dst_lo + m] = data[src_lo : src_lo + m]
        return out.mean(axis=1) if mono else out

    def delete(self) -> None:
        for p in (self.wav, Path(str(self.wav) + ".qpc.csv")):
            p.unlink(missing_ok=True)


def _first_packet_qpc_ns(wav: Path) -> int:
    with open(str(wav) + ".qpc.csv", encoding="ascii") as f:
        f.readline()
        frame, qpc, *_ = f.readline().split(",")
        assert int(frame) == 0
        return int(qpc) * 100


def _first_sound_ms(wav: Path, rate: int, threshold: float = 10 ** (-60 / 20)) -> float | None:
    data, _ = sf.read(wav, dtype="float32", always_2d=True, frames=rate * 60)
    loud = np.flatnonzero(np.abs(data).max(axis=1) > threshold)
    return float(loud[0] * 1000 / rate) if len(loud) else None


def find_pc_device(sp: Spotify, name: str = "") -> dict:
    want = (name or os.environ.get("COMPUTERNAME", "")).lower()
    devs = sp.devices()
    for d in devs:
        if d["type"] == "Computer" and (not want or d["name"].lower() == want):
            return d
    computers = [d for d in devs if d["type"] == "Computer"]
    if len(computers) == 1:
        return computers[0]
    raise CaptureError(f"no Spotify desktop device named {want!r}; devices: {[d['name'] for d in devs]}")


def _start(sp: Spotify, track_id: str, device_id: str, log=print, timeout_s: float = 12) -> None:
    """Sends play and waits until the player confirms this track is playing near its start. The desktop client
    applies remote commands late and sometimes not at all (D-33), so the command is resent once."""
    sp.play(track_id, device_id, 0)
    t0 = time.time()
    resent = False
    while time.time() - t0 < timeout_s:
        time.sleep(0.4)
        st = sp.player()
        if st and st.track_id == track_id and st.is_playing and st.progress_ms < 8000:
            sp.set_repeat("off", device_id)
            return
        if not resent and time.time() - t0 > 4:
            log(f"  player shows {st.track_id if st else None}, resending play")
            sp.play(track_id, device_id, 0)
            resent = True
    raise CaptureError("Spotify did not start the track")


def capture_track(
    sp: Spotify,
    track_id: str,
    work: Path,
    device_name: str = "",
    poll_s: float = 1.0,
    log=print,
    max_s: float | None = None,
) -> Capture:
    """Plays one track from 0 on this PC's Spotify app and captures it. Raises CaptureError if playback is
    interrupted (track change, seek, pause > 3 s) so the caller can retry."""
    meta = sp.track(track_id)
    duration_ms = int(meta["duration_ms"])
    if max_s:
        duration_ms = min(duration_ms, int(max_s * 1000))  # partial capture, for tests
    device = find_pc_device(sp, device_name)
    work.mkdir(parents=True, exist_ok=True)
    wav = work / f"{track_id}.wav"

    sp.pause(device["id"]) if device.get("is_active") else None
    time.sleep(0.5)
    rec = Recorder(spotify_root_pid(), wav)
    if rec.events[-1].get("event") == "error":
        raise CaptureError(str(rec.events[-1]))
    try:
        _start(sp, track_id, device["id"], log)
        samples: list[PlayerState] = []
        paused_since: float | None = None
        t_end = time.time() + duration_ms / 1000 + 30
        while time.time() < t_end:
            time.sleep(poll_s)
            try:
                st = sp.player()
            except SpotifyError as e:
                log(f"  poll failed: {e}")
                continue
            if st is None or st.track_id is None:
                continue  # device still waking up / between items
            if st.track_id != track_id:
                if samples and samples[-1].progress_ms > duration_ms - 5000:
                    break  # it ended and autoplay moved on
                raise CaptureError(f"track changed to {st.track_id}")
            if not st.is_playing:
                if samples and samples[-1].progress_ms > duration_ms - 3000:
                    break
                paused_since = paused_since or time.time()
                if time.time() - paused_since > 3:
                    raise CaptureError("playback paused")
                continue
            paused_since = None
            samples.append(st)
            if st.progress_ms >= duration_ms - 400:
                break
        time.sleep(1.0)  # let the tail and the output buffer drain into the capture
    finally:
        try:
            sp.pause(device["id"])
        except SpotifyError:
            pass
        stopped = rec.stop()

    if len(samples) < 5:
        raise CaptureError(f"only {len(samples)} player samples")
    qpc0 = _first_packet_qpc_ns(wav)
    offsets = [(s.t_ns - qpc0) / 1e6 - s.progress_ms for s in samples]
    med = statistics.median(offsets)
    mad = statistics.median(abs(o - med) for o in offsets)
    jumps = [o for o in offsets if abs(o - med) > 400]
    if len(jumps) > max(2, len(offsets) // 20):
        raise CaptureError(f"playback was not continuous ({len(jumps)} of {len(offsets)} samples off by > 400 ms)")
    info = sf.info(wav)
    cap = Capture(
        track_id=track_id,
        duration_ms=duration_ms,
        wav=wav,
        rate=info.samplerate,
        offset_ms=med,
        offset_spread_ms=mad,
        samples=samples,
        peak=rec.peak,
    )
    cap.first_sound_ms = _first_sound_ms(wav, info.samplerate)
    log(
        f"  captured {stopped['frames'] / info.samplerate:.1f} s, peak {rec.peak:.2f}, offset {med:.0f} ms "
        f"(MAD {mad:.1f} ms, {len(samples)} samples), first sound at {cap.first_sound_ms} ms"
    )
    if rec.peak < 0.01:
        raise CaptureError("captured silence: is Spotify muted in the app, or playing on another device?")
    return cap
