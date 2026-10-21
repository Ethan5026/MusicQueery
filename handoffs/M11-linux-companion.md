# M11 · Companion on Linux (mini PC)

**Status:** done · 2026-10-21 · **Next:** back to M10's phone verdict (the companion now runs by itself)
**Commit:** see `git log` for "S11|M11:" (pushed to origin/main)

## Goal of this stage
Migration runbook Phase 4B: run `mqc watch` on the always-on Ubuntu mini PC (`gru-server`, 192.168.40.46, user `gruman`)
so the laptop no longer has to be on for songs to be analysed. Windows must keep working.

## Decisions
- D-83 Linux capture: librespot ("MusicQueery server") into a silent PipeWire sink, `pw-record` on its monitor, monotonic frame 0
- D-84 Linux alignment −120 ms (`LIBRESPOT_ALIGN_MS`), measured against the Windows truth audio; known risks
- D-85 Linux layout: XDG paths, uv for win32 + linux, vamp sdist, torchaudio from the CPU index, `companion/linux/`

## Built
- `companion/src/mqc/capture.py` — `WasapiRecorder` (Windows, unchanged) and `PipeWireRecorder` (Linux) behind `open_recorder`;
  `Capture.first_frame_ns`; `default_device_name()` (config → COMPUTERNAME on Windows → "MusicQueery server" on Linux)
- `companion/src/mqc/config.py` — `WINDOWS`, `LOCAL`, XDG paths on Linux, `CAPTURE_SINK`, `LINUX_DEVICE_NAME`
- `companion/src/mqc/{analysis,charts}.py` — use `config.LOCAL`; `truth.py` — key reader works on Linux (cbreak tty)
- `companion/pyproject.toml`, `uv.lock` — environments win32 + linux x86_64; vamp per platform; torchaudio CPU index
- `companion/scripts/build_chordino.py` — Linux branch: same Boost-free patch, g++ → `nnls-chroma.so`
- `companion/linux/` — `install.sh` (idempotent), `50-mqc-capture.conf` (sink), `mqc-librespot.service`, `mqc-watch.service`
- `companion/tests/test_capture_pipewire.py` — recorder WAV, peak and frame-0 time with a fake `pw-record`
- `package.json` — `companion:linux` script (`pnpm companion` is still the Windows command)

## Verified
- `pytest companion/tests` → 37 passed on Windows and on the mini PC; `ruff check` / `ruff format --check` clean
- 17 s tone through the sink: frames vs CLOCK_MONOTONIC drift 4 ms, chunk lag 5 ms median / 12 ms max, tone found at 3 027 ms of 3 000
- `vamp.list_plugins()` on Linux → `nnls-chroma:chordino`; torch 2.14.1+cpu, torchaudio 2.11.0+cpu load together
- Alignment vs Windows truth audio (xcorr, 32 s, corr 0.96–1.00): 20 steady runs 114–145 ms before the correction (D-84)
- `mqc analyse 7iN1s7xHE4ifF5povM6A48 --no-upload` (Let It Be) → 143 s analysis, 2.3 GB peak RSS; vs truth: sevenths 0.864
  (Windows store timeline 0.860), beat F 0.996 (0.996)
- `systemctl --user` on the mini PC: `mqc-librespot`, `mqc-watch` enabled + active, Linger=yes, Restart=always
- Watcher, real queue: inbox queued "Vehicle"; after 10 min idle it analysed Honeymoon Avenue (342 s capture, MAD 7.3 ms,
  163 chords, B major, 791 melody notes) and uploaded it, then started Joker And The Thief

## Open
- [ ] user: the laptop's companion login (spotify.json) was copied to the mini PC; Spotify rotates refresh tokens, so running
      `mqc` on the laptop again needs `pnpm companion login` there. Don't run two watchers.
- [ ] next stage: D-84's early outliers (80–190 ms, 3 of 17 runs) were not explained; if a timeline looks off, re-measure with a
      truth song (cross-correlate a capture with `work/truth/<name>.flac`)
- [ ] next stage: librespot "Audio key response timeout" skips a track after many quick loads; the watcher retries once, then the
      phone can retry. Watch `journalctl --user -u mqc-librespot` if failures pile up
- [ ] user: Phase 6's firewall must keep outbound traffic open (librespot, Spotify API, the Worker)

## Skip
- `companion/capture/` — Windows-only helper, unchanged
- `companion/scripts/sp9_*` — M9 spikes

## Next prompt
```
Read CLAUDE.md, handoffs/DECISIONS.md and handoffs/M10-lead-sheet.md. The companion now runs on the mini PC (M11). Continue M10's next step.
On the mini PC: journalctl --user -u mqc-watch -f shows the watcher; pnpm companion:linux <cmd> runs mqc there.
```
