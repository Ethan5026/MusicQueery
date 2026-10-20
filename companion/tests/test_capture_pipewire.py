"""Linux capture: the PipeWire recorder's WAV, peak and frame-0 time, with a fake `pw-record` (no audio needed)."""

import time

import numpy as np
import soundfile as sf

from mqc import capture

RATE = capture.PipeWireRecorder.RATE


class FakePwRecord:
    """Hands out raw s16 stereo chunks at real time; the second chunk arrives late, like a scheduling hiccup."""

    def __init__(self, chunks: list[bytes], delays: list[float]) -> None:
        self.chunks, self.delays = list(chunks), list(delays)
        self.stdout = self
        self.stderr = None
        self.killed = False

    def read1(self, _n: int) -> bytes:
        if not self.chunks:
            while not self.killed:
                time.sleep(0.005)
            return b""
        time.sleep(self.delays.pop(0))
        return self.chunks.pop(0)

    def poll(self):
        return 0 if self.killed else None

    def terminate(self) -> None:
        self.killed = True

    kill = terminate

    def wait(self, _timeout=None) -> int:
        return 0


def pcm(frames: int, level: int) -> bytes:
    return np.full((frames, 2), level, dtype="<i2").tobytes()


def test_records_wav_peak_and_frame_zero_time(tmp_path, monkeypatch):
    n = RATE // 50  # 20 ms chunks
    chunks = [pcm(n, 0), pcm(n, 16384), pcm(n, -8192)]
    fake = FakePwRecord(chunks, [0.02, 0.06, 0.0])  # chunk 2 is 40 ms late, chunk 3 catches up at once
    monkeypatch.setattr(capture.shutil, "which", lambda _c: "/usr/bin/pw-record")
    monkeypatch.setattr(capture.subprocess, "Popen", lambda *a, **k: fake)

    before = time.perf_counter_ns()
    rec = capture.PipeWireRecorder(tmp_path / "t.wav")
    time.sleep(0.2)
    stopped = rec.stop()

    assert stopped == {"event": "stopped", "frames": 3 * n}
    data, rate = sf.read(tmp_path / "t.wav", dtype="int16")
    assert rate == RATE and data.shape == (3 * n, 2)
    assert abs(rec.peak - 0.5) < 1e-6
    # Frame 0 played no later than the first chunk's arrival minus its length, and the late chunk doesn't move it.
    t0 = rec.first_frame_ns()
    assert before <= t0 + 25e6
    assert t0 <= before + 25e6


def test_no_audio_is_a_capture_error(tmp_path, monkeypatch):
    fake = FakePwRecord([], [])
    monkeypatch.setattr(capture.shutil, "which", lambda _c: "/usr/bin/pw-record")
    monkeypatch.setattr(capture.subprocess, "Popen", lambda *a, **k: fake)
    monkeypatch.setattr(capture.threading.Event, "wait", lambda self, _t=None: False)
    try:
        capture.PipeWireRecorder(tmp_path / "t.wav")
    except capture.CaptureError as e:
        assert "no audio" in str(e)
    else:
        raise AssertionError("expected CaptureError")
