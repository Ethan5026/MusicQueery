"""Capture of the Spotify player (SP3) and alignment of the capture to track position.

Windows: the helper (capture/bin/mqcapture.exe) records the Spotify.exe process tree by WASAPI loopback and writes a
WAV whose frame index is linear in QPC time (D-33). Linux: librespot plays into a silent PipeWire sink and
`pw-record` reads that sink's monitor; frame 0's monotonic time is the lower envelope of chunk arrival times.
Either way the recorder knows frame 0's time on the `time.perf_counter_ns()` clock (QPC on Windows, CLOCK_MONOTONIC
on Linux). While it runs we sample /me/player; each sample says "at perf_counter t the track was at progress p".
That gives offset = capture_ms(t) - p, constant while playback is continuous. The median offset maps capture frames
to track milliseconds.
"""

from __future__ import annotations

import json
import os
import shutil
import statistics
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import psutil
import soundfile as sf

from .config import CAPTURE_EXE, CAPTURE_SINK, LINUX_DEVICE_NAME, WINDOWS, Settings
from .spotify import PlayerState, Spotify, SpotifyError


# Linux only: Spotify's progress_ms for librespot runs ahead of the audio by this much, so the median offset is moved
# later to match the Windows captures the truth set and the phone's calibration were made with. Measured on the mini
# PC by cross-correlating 20 captures with the Windows truth audio: 114-145 ms, median 121 (D-84, M11).
LIBRESPOT_ALIGN_MS = 120.0


class CaptureError(RuntimeError):
    pass


def spotify_root_pid() -> int:
    """The Spotify.exe whose parent is not Spotify.exe; INCLUDE_TARGET_PROCESS_TREE then covers the audio child."""
    procs = {p.pid: p for p in psutil.process_iter(["name", "ppid"]) if (p.info["name"] or "").lower() == "spotify.exe"}
    roots = [pid for pid, p in procs.items() if p.info["ppid"] not in procs]
    if not roots:
        raise CaptureError("Spotify.exe is not running")
    return min(roots, key=lambda pid: procs[pid].create_time())


class WasapiRecorder:
    """Windows: runs mqcapture.exe for one process tree until stop()."""

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

    def first_frame_ns(self) -> int:
        return _first_packet_qpc_ns(self.wav)


class PipeWireRecorder:
    """Linux: records the monitor of the silent sink librespot plays into (`pw-record`, raw s16 stereo on stdout)
    until stop(). Each chunk is stamped with perf_counter_ns() when it arrives; a frame can only arrive after it was
    played, so frame 0's time is the lower envelope min(arrival - frames_so_far / rate). The sink runs on PipeWire's
    dummy driver, which is timed by CLOCK_MONOTONIC, so the frame index stays linear in that clock (SP3 check on the
    mini PC: 4 ms over 17 s, chunk lag 5 ms median, 12 ms max)."""

    RATE = 44100
    CHANNELS = 2

    def __init__(self, wav: Path, sink: str = CAPTURE_SINK) -> None:
        if not shutil.which("pw-record"):
            raise CaptureError("pw-record missing: install pipewire-bin")
        self.wav = wav
        self.events: list[dict] = []
        self.peak = 0.0
        self.frames = 0
        self._t0_ns: float | None = None
        self._out = sf.SoundFile(wav, "w", samplerate=self.RATE, channels=self.CHANNELS, subtype="PCM_16")
        self.proc = subprocess.Popen(
            [
                "pw-record",
                "--target",
                sink,
                "-P",
                "{ stream.capture.sink = true, node.name = mqc_recorder }",
                "--rate",
                str(self.RATE),
                "--channels",
                str(self.CHANNELS),
                "--format",
                "s16",
                "--latency",
                "20ms",
                "--raw",
                "-",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self._started = threading.Event()
        self._reader = threading.Thread(target=self._read, daemon=True)
        self._reader.start()
        if not self._started.wait(5):
            self.proc.kill()
            err = self.proc.stderr.read().decode(errors="replace").strip() if self.proc.stderr else ""
            self._out.close()
            raise CaptureError(f"pw-record gave no audio from sink {sink!r} within 5 s {err}".strip())
        self.events.append({"event": "started", "sink": sink})

    def _read(self) -> None:
        assert self.proc.stdout
        frame_bytes = 2 * self.CHANNELS
        rest = b""
        while chunk := self.proc.stdout.read1(65536):
            t = time.perf_counter_ns()
            chunk = rest + chunk
            n = len(chunk) // frame_bytes
            rest = chunk[n * frame_bytes :]
            if not n:
                continue
            pcm = np.frombuffer(chunk[: n * frame_bytes], dtype="<i2").reshape(n, self.CHANNELS)
            self._out.write(pcm)
            self.frames += n
            t0 = t - self.frames * 1e9 / self.RATE
            self._t0_ns = t0 if self._t0_ns is None else min(self._t0_ns, t0)
            self.peak = max(self.peak, float(np.abs(pcm).max()) / 32768)
            self._started.set()

    def stop(self) -> dict:
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self._reader.join(5)
        self._out.close()
        if not self.frames:
            raise CaptureError("capture ended with no audio")
        ev = {"event": "stopped", "frames": self.frames}
        self.events.append(ev)
        return ev

    def first_frame_ns(self) -> int:
        assert self._t0_ns is not None
        return int(self._t0_ns)


def open_recorder(wav: Path) -> WasapiRecorder | PipeWireRecorder:
    return WasapiRecorder(spotify_root_pid(), wav) if WINDOWS else PipeWireRecorder(wav)


@dataclass
class Capture:
    """A finished capture, mapped onto track time."""

    track_id: str
    duration_ms: int
    wav: Path
    rate: int
    offset_ms: float  # capture time (ms from the WAV's first frame) at track position 0
    offset_spread_ms: float  # median absolute deviation of the per-sample offsets
    first_frame_ns: int = 0  # perf_counter_ns() time of the WAV's first frame (taps in `mqc tap` use the same clock)
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


def default_device_name() -> str:
    """The Spotify Connect device that plays for capture: the config's `device_name`, else this PC's Spotify app
    (named after the computer) on Windows, else librespot on Linux."""
    return Settings.load().device_name or (os.environ.get("COMPUTERNAME", "") if WINDOWS else LINUX_DEVICE_NAME)


def find_pc_device(sp: Spotify, name: str = "") -> dict:
    want = (name or default_device_name()).lower()
    devs = sp.devices()
    for d in devs:
        if d["type"] == "Computer" and (not want or d["name"].lower() == want):
            return d
    computers = [d for d in devs if d["type"] == "Computer"]
    if len(computers) == 1:
        return computers[0]
    raise CaptureError(f"no Spotify desktop device named {want!r}; devices: {[d['name'] for d in devs]}")


def _start(sp: Spotify, track_id: str, device_id: str, log=print, per_try_s: float = 5) -> None:
    """Starts the track and waits until the player confirms it is playing near its start. The desktop client applies
    remote commands late or not at all, and sometimes starts the wrong album track (D-33), so each start method in
    `Spotify.PLAY_METHODS` gets one try."""
    st = None
    for method in sp.PLAY_METHODS:
        sp.play(track_id, device_id, 0, method=method)
        t0 = time.time()
        while time.time() - t0 < per_try_s:
            time.sleep(0.4)
            st = sp.player()
            if st and st.track_id == track_id and st.is_playing and st.progress_ms < 8000:
                if method != "queue":
                    sp.set_repeat("off", device_id)
                return
        log(f"  start by {method}: player shows {st.track_id if st else None}, trying the next method")
    raise CaptureError(f"Spotify did not start the track (last seen {st.track_id if st else None})")


def capture_track(sp: Spotify, track_id: str, work: Path, *args, **kwargs) -> Capture:
    """Plays one track from 0 on this PC's Spotify app and captures it (see `_capture_track`). On any failure the
    partial audio is deleted at once (D-18), so an unattended run never leaves recordings behind."""
    try:
        return _capture_track(sp, track_id, work, *args, **kwargs)
    except BaseException:
        for p in (work / f"{track_id}.wav", work / f"{track_id}.wav.qpc.csv"):
            p.unlink(missing_ok=True)
        raise


def _capture_track(
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
    rec = open_recorder(wav)
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
    t0_ns = rec.first_frame_ns()
    offsets = [(s.t_ns - t0_ns) / 1e6 - s.progress_ms for s in samples]
    med = statistics.median(offsets)
    mad = statistics.median(abs(o - med) for o in offsets)
    jumps = [o for o in offsets if abs(o - med) > 400]
    if len(jumps) > max(2, len(offsets) // 20):
        raise CaptureError(f"playback was not continuous ({len(jumps)} of {len(offsets)} samples off by > 400 ms)")
    if not WINDOWS:
        med += LIBRESPOT_ALIGN_MS
    info = sf.info(wav)
    cap = Capture(
        track_id=track_id,
        duration_ms=duration_ms,
        wav=wav,
        rate=info.samplerate,
        offset_ms=med,
        offset_spread_ms=mad,
        first_frame_ns=t0_ns,
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
