"""`mqc` command line. From the repo root: `pnpm companion <command>` (= uv run --project companion mqc ...)."""

from __future__ import annotations

import argparse
import json
import secrets
import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # chord symbols use ♭ ♯ °
    p = argparse.ArgumentParser(prog="mqc", description="MusicQueery companion (M3)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("login", help="log in to Spotify (PKCE, opens the browser)")
    sub.add_parser("status", help="Spotify devices, what is playing, store settings")
    s = sub.add_parser("setup-secret", help="create the API bearer secret and save it locally")
    s.add_argument("--secret", help="use this value instead of generating one")
    s.add_argument("--api", help="API base URL")

    s = sub.add_parser("capture-test", help="SP3: capture one track and report alignment, then delete the audio")
    s.add_argument("track")
    s.add_argument("--seconds", type=float, default=40)
    s.add_argument("--keep", action="store_true", help="keep the WAV for inspection")
    s = sub.add_parser("align-check", help="SP3: where do onsets fall relative to the API's track 0?")
    s.add_argument("tracks", nargs="+")
    s.add_argument("--seconds", type=float, default=8)
    s = sub.add_parser("analyse", help="capture, analyse and upload tracks (ids, links, or @file with one per line)")
    s.add_argument("tracks", nargs="+")
    s.add_argument("--recogniser", default=None)
    s.add_argument("--no-upload", action="store_true")
    s.add_argument("--skip-existing", action="store_true", help="skip tracks already in the store")
    s.add_argument("--first", type=int, default=0, help="for a playlist: only its first N tracks")

    sub.add_parser("chart-index", help="build the local Chordonomicon chart index (one time, ~200 MB)")
    s = sub.add_parser("analyse-saved", help="analyse captured truth audio (no replay) and upload")
    s.add_argument("names", nargs="*")
    s = sub.add_parser("tap", help="ground truth: play a track and tap its beats/bars")
    s.add_argument("track")
    s.add_argument("--name", required=True, help="short name, e.g. autumn-leaves")
    s.add_argument("--no-keys", action="store_true", help="capture the audio only (taps can be added later)")
    s = sub.add_parser("truth", help="build the truth timeline from taps + form")
    s.add_argument("name")
    s = sub.add_parser("import-annotated", help="truth from a human-annotated JAMS file (ChoCo): find, capture, align")
    s.add_argument("jams")
    s.add_argument("--name", required=True)
    s.add_argument("--track", help="Spotify track to use instead of searching")
    s = sub.add_parser("bakeoff", help="SP4: score every recogniser on the truth tracks")
    s.add_argument("names", nargs="*")
    s.add_argument("--recognisers", default="chordino,btc,madmom")

    s = sub.add_parser("watch", help="analyse tracks queued from the phone, whenever Spotify is idle (M5)")
    s.add_argument("--idle-minutes", type=float, default=10, help="nothing played on any device for this long")
    s.add_argument("--interval", type=float, default=60, help="seconds between queue checks")
    s.add_argument("--once", action="store_true", help="work through what can be done now, then exit")
    s.add_argument("--inbox-minutes", type=float, default=10, help="minutes between checks of the inbox playlist")
    sub.add_parser("queue", help="show the analysis queue")
    s = sub.add_parser("inbox", help="the playlist inbox (M5b): songs added to it are queued for analysis")
    s.add_argument("action", nargs="?", default="show", choices=["show", "set", "check", "clear"])
    s.add_argument("playlist", nargs="?", help="for `set`: a Spotify playlist link, URI or id")

    s = sub.add_parser("get", help="fetch a timeline from the store")
    s.add_argument("id")
    sub.add_parser("list", help="list timelines in the store")
    s = sub.add_parser("upload", help="upload a timeline JSON file")
    s.add_argument("file")
    a = p.parse_args(argv)
    return COMMANDS[a.cmd](a) or 0


def cmd_login(a) -> None:
    from .spotify import login

    login()
    print("logged in")


def cmd_status(a) -> None:
    from .config import Settings
    from .spotify import Spotify

    sp = Spotify()
    st = sp.player()
    s = Settings.load()
    print(
        json.dumps(
            {
                "devices": sp.devices(),
                "player": st.__dict__ if st else None,
                "api": s.api_url,
                "secret": bool(s.api_secret),
            },
            indent=2,
        )
    )


def cmd_setup_secret(a) -> None:
    from .config import Settings

    s = Settings.load()
    s.api_secret = a.secret or secrets.token_urlsafe(32)
    if a.api:
        s.api_url = a.api.rstrip("/")
    s.save()
    print(f"saved to {Settings.path()}. Give the Worker the same value:")
    print("  pnpm --filter @mq/worker exec wrangler secret put API_SECRET")


def cmd_capture_test(a) -> None:
    from .capture import capture_track
    from .config import WORK_DIR
    from .spotify import Spotify, parse_track_id

    sp = Spotify()
    cap = capture_track(sp, parse_track_id(a.track), WORK_DIR / "test", max_s=a.seconds)
    offs = [(s.t_ns, s.progress_ms, s.rtt_ms) for s in cap.samples]
    print(
        json.dumps(
            {
                "offsetMs": cap.offset_ms,
                "madMs": cap.offset_spread_ms,
                "firstSoundMs": cap.first_sound_ms,
                "peak": cap.peak,
                "samples": len(offs),
                "rttMedianMs": sorted(r for *_, r in offs)[len(offs) // 2],
                "wav": str(cap.wav),
            },
            indent=2,
        )
    )
    if not a.keep:
        cap.delete()


def cmd_align_check(a) -> None:
    import numpy as np
    import soundfile as sf

    from .capture import capture_track
    from .config import WORK_DIR
    from .spotify import Spotify, parse_track_id

    sp = Spotify()
    for t in a.tracks:
        tid = parse_track_id(t)
        cap = capture_track(sp, tid, WORK_DIR / "align", max_s=a.seconds, log=lambda *_: None)
        data, sr = sf.read(cap.wav, dtype="float32", always_2d=True)
        x = np.abs(data).max(axis=1)
        hop = sr // 200  # 5 ms frames
        env = np.array([x[i : i + hop].max() for i in range(0, len(x) - hop, hop)])
        db = 20 * np.log10(env + 1e-9)
        off = cap.offset_ms

        def rel(i: int, off: float = off) -> float:  # 5 ms frame index → track ms
            return i * 5 - off

        loud = np.flatnonzero(db > -50)
        onsets = [i for i in range(1, len(db)) if db[i] > -30 and db[i] - db[i - 1] > 12]
        print(
            f"{sp.track(tid)['name'][:40]:40} offset {cap.offset_ms:6.0f} (MAD {cap.offset_spread_ms:4.1f})  "
            f"first > -50 dB at track {rel(loud[0]) if len(loud) else None} ms; "
            f"onsets at track ms {[round(rel(i)) for i in onsets[:8]]}"
        )
        cap.delete()


def cmd_analyse(a) -> int:
    from .capture import find_pc_device
    from .pipeline import DEFAULT_RECOGNISER, analyse_track, read_track_list
    from .spotify import Spotify, SpotifyError, parse_track_id
    from .store import Store

    ids: list[str] = []
    for t in a.tracks:
        if t.startswith("@"):
            ids += [parse_track_id(x) for x in read_track_list(Path(t[1:]))]
        elif "playlist" in t:
            pid = t.rstrip("/").split("/")[-1].split(":")[-1].split("?")[0]
            sp0 = Spotify()
            try:
                found = [x["id"] for x in sp0.playlist_tracks(pid)]
                ids += found[: a.first] if a.first else found
            except SpotifyError as e:  # development-mode quota on playlist reads (D-35)
                print(f"playlist read failed ({e}); finding tracks by playing positions instead")
                ids += sp0.playlist_ids_by_playing(pid, find_pc_device(sp0)["id"], a.first or 10)
        else:
            ids.append(parse_track_id(t))
    sp = Spotify()
    store = None if a.no_upload else Store()
    existing = {x["id"] for x in store.list()} if store and a.skip_existing else set()
    failed = []
    for i, tid in enumerate(ids, 1):
        if f"spotify:track:{tid}" in existing:
            print(f"[{i}/{len(ids)}] {tid} already stored, skipped")
            continue
        print(f"[{i}/{len(ids)}] ", end="")
        try:
            analyse_track(sp, store, tid, a.recogniser or DEFAULT_RECOGNISER)
        except Exception as e:  # keep going: unattended
            print(f"  FAILED: {e}")
            failed.append(tid)
    print(f"done: {len(ids) - len(failed)} ok, {len(failed)} failed {failed or ''}")
    return 1 if failed else 0


def cmd_watch(a) -> int:
    from .watch import watch

    try:
        return watch(a.idle_minutes, a.interval, a.once, a.inbox_minutes)
    except KeyboardInterrupt:
        return 0


def cmd_queue(a) -> None:
    from .store import Store

    for q in Store().queue():
        err = f" ({q['error']})" if q.get("error") else ""
        print(f"{q['state']:8} {q['id']}  {q.get('title', '')} — {q.get('artist', '')}  asked {q['requestedAt']}{err}")


def cmd_inbox(a) -> int:
    from .inbox import Inbox, parse_playlist_id
    from .spotify import RateLimited, Spotify, SpotifyError
    from .store import Store

    store = Store()
    s = store.s
    if a.action == "set":
        if not a.playlist:
            print("usage: mqc inbox set <playlist link>")
            return 2
        s.inbox_playlist, s.inbox_name = parse_playlist_id(a.playlist), ""
        try:
            s.inbox_name = Spotify().playlist_snapshot(s.inbox_playlist).get("name") or ""
        except RateLimited as e:
            h = e.retry_after_s / 3600
            print(f"saved, but Spotify is refusing playlist reads for {h:.1f} h (D-35); `mqc watch` catches up then")
        except SpotifyError as e:
            print(f"saved, but the playlist couldn't be read: {e}")
        s.save()
        print(f"inbox: {s.inbox_name or '(name unknown)'} ({s.inbox_playlist}). `mqc watch` checks it every 10 min.")
        return 0
    if a.action == "clear":
        s.inbox_playlist = s.inbox_name = ""
        s.save()
        store.inbox_delete()
        print("inbox cleared (timelines and queued requests are kept)")
        return 0
    if not s.inbox_playlist:
        print("no inbox playlist: `mqc inbox set <playlist link>`")
        return 1
    if a.action == "check":
        Inbox(s.inbox_playlist, Spotify(), store, s.inbox_name).check(force=True)
    doc = store.inbox_get()
    if not doc:
        print(f"inbox {s.inbox_name or s.inbox_playlist}: not read yet")
        return 0
    print(f"inbox {doc.get('name') or doc['playlistId']}: {len(doc['tracks'])} songs, updated {doc['updatedAt']}")
    if doc.get("blockedUntil"):
        print(f"  Spotify refuses playlist reads until {doc['blockedUntil']}")
    for t in doc["tracks"]:
        err = f" ({t['error']})" if t.get("error") else ""
        print(f"  {t['state']:8} {t.get('title', '')} — {t.get('artist', '')}{err}")
    return 0


def cmd_chart_index(a) -> None:
    from .charts import build_index

    build_index()


def cmd_analyse_saved(a) -> None:
    import soundfile as sf

    from .pipeline import analyse_audio
    from .spotify import Spotify
    from .store import Store
    from .truth import TRUTH_AUDIO, load, truth_path

    store = Store()
    names = a.names or sorted(p.stem for p in TRUTH_AUDIO.glob("*.flac"))
    for name in names:
        rec = load(name) if truth_path(name).exists() else None
        if not rec:
            print(f"{name}: no truth record, skipped")
            continue
        audio, sr = sf.read(TRUTH_AUDIO / f"{name}.flac", dtype="float32")
        print(f"{rec['title']} — {rec['artist']}")
        tl = analyse_audio(rec["trackId"], rec["durationMs"], audio, sr, sp=Spotify())
        res = store.put(tl)
        print(f"  uploaded {res['id']} ({res['bytes']} bytes)")


def cmd_tap(a) -> None:
    from .spotify import Spotify, parse_track_id
    from .truth import tap

    tap(Spotify(), parse_track_id(a.track), a.name, keys=not a.no_keys)


def cmd_truth(a) -> None:
    from . import analysis as A
    from . import bridge
    from . import truth as T

    rec = T.load(a.name)
    audio, sr = _truth_audio(a.name)
    meter = T.chart_meter(rec)
    if rec["taps"]:
        beats = A.track_beats(audio, sr)
        tapped, _ = T.grid_from_taps(rec["taps"], meter)
        lat = T.calibrate(tapped, beats.beats * 1000)
        tl = T.build_truth(rec, lat)
    else:
        lat = 0.0
        tl = T.build_truth(rec, 0.0, grid=T.grid_from_madmom(audio, sr, meter))
    if tl["chords"]:
        fin = bridge.finish([dict(c) for c in tl["chords"]], tl["beats"], harte=False)
        tl["keys"] = fin["keys"]
    errs = A.validate_timeline(tl)
    out = T.TRUTH_DIR / f"{a.name}.timeline.json"
    out.write_text(json.dumps(tl, ensure_ascii=False, indent=0), encoding="utf8")
    print(
        f"tap latency {lat:.0f} ms; {len(tl['bars'])} charted bars, {len(tl['chords'])} chords, "
        f"keys {[k['tonic'] + ' ' + k['mode'] for k in tl['keys']][:5]}; schema errors: {errs or 'none'} → {out}"
    )


def _truth_audio(name: str):
    import soundfile as sf

    from .truth import audio_path

    data, sr = sf.read(audio_path(name), dtype="float32")
    return data, sr


def cmd_bakeoff(a) -> None:
    import time

    from . import analysis as A
    from . import evaluate as E
    from .config import COMPANION, TRUTH_DIR

    names = a.names or sorted(p.name[: -len(".timeline.json")] for p in TRUTH_DIR.glob("*.timeline.json"))
    rows = []
    for name in names:
        truth = json.loads((TRUTH_DIR / f"{name}.timeline.json").read_text(encoding="utf8"))
        audio, sr = _truth_audio(name)
        t0 = time.time()
        beats = A.track_beats(audio, sr)
        bt = time.time() - t0
        per = {r: A.RECOGNISERS[r](audio, sr) for r in A.VOTE_WEIGHTS}
        end = len(audio) / sr
        share = A.seventh_share(per["btc"])
        variants = []
        for rec in a.recognisers.split(","):
            synced = A.beat_sync(per[rec], beats.beats, end)
            variants += [(rec, "beat", synced, False), (rec, "beat+7", synced, True)]
        voted = A.vote(per, beats.beats, end)
        variants += [
            ("vote", "beat", voted, False),
            ("vote", "beat+7", voted, True),
            ("auto", f"7s={share:.2f}", voted, share >= A.JAZZ_SEVENTH_SHARE),
        ]
        for rec, mode, sg, sev in variants:
            tl, _ = A.build_timeline(truth["id"].split(":")[-1], truth["durationMs"], beats, sg, rec, sevenths=sev)
            row = {
                "track": name,
                "recogniser": rec,
                "mode": mode,
                **E.chord_scores(truth, tl),
                "beatF": E.beat_f(truth, tl["beats"]),
                "beatAMLt": E.beat_amlt(truth, tl["beats"]),
                "downbeatF": E.downbeat_f(truth, tl),
                "beatSecs": round(bt, 1),
                "key": E.key_scores(truth, tl),
            }
            rows.append(row)
            print(
                f"{name:20} {rec:9} {mode:8} sevenths {row['sevenths']:.3f}  majmin {row['majmin']:.3f}  "
                f"root {row['root']:.3f}  jazz {row['jazz']:.3f}  beatF {row['beatF']:.3f}  "
                f"AMLt {row['beatAMLt']:.3f}  "
                f"dbF {row['downbeatF']:.3f}  key {row['key'].get('agree')} {row['key'].get('estMain')}"
            )
    out = COMPANION / "reports" / "sp4-bakeoff.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf8")
    print(f"→ {out}")


def cmd_import_annotated(a) -> None:
    from . import analysis as A
    from . import annotated as N
    from . import truth as T
    from .spotify import Spotify, parse_track_id

    ann = N.load_jams(Path(a.jams))
    sp = Spotify()
    artist = a.name.split("--")[0].replace("-", " ") if not ann["artist"] else ann["artist"]
    if a.track:
        hit = sp.track(parse_track_id(a.track))
    else:
        hit = N.find_on_spotify(sp, ann["title"], artist, ann["duration"])
    if not hit:
        raise SystemExit(f"no Spotify release of {ann['title']} within 8 s of {ann['duration']:.0f} s; pass --track")
    print(
        f"{ann['title']} ({ann['corpus']}, {ann['duration']:.1f} s) → {hit['name']} — {hit['artists'][0]['name']} "
        f"({hit['duration_ms'] / 1000:.1f} s) [{hit['id']}]"
    )
    if not T.audio_path(a.name).exists():
        T.tap(sp, hit["id"], a.name, keys=False)
    rec = T.load(a.name)
    audio, sr = _truth_audio(a.name)
    beats = A.track_beats(audio, sr)
    est = A.vote({r: A.RECOGNISERS[r](audio, sr) for r in A.VOTE_WEIGHTS}, beats.beats, len(audio) / sr)
    shift, agree, runner = N.best_offset(ann["segs"], est)
    grid, _ = T.grid_from_madmom(audio, sr, 4)
    tl = N.truth_timeline(rec, ann, shift, grid)
    (T.TRUTH_DIR / f"{a.name}.timeline.json").write_text(json.dumps(tl, ensure_ascii=False), encoding="utf8")
    rec.update(
        {
            "form": [],
            "annotation": {
                "jams": Path(a.jams).name,
                "corpus": ann["corpus"],
                "key": ann["key"],
                "shiftMs": round(shift * 1000),
                "rootAgreement": round(agree, 3),
                "runnerUp": round(runner, 3),
            },
        }
    )
    T.save(rec)
    print(
        f"  shift {shift * 1000:+.0f} ms (root agreement {agree:.2f}, best elsewhere {runner:.2f}); "
        f"{len(tl['chords'])} chords → truth/{a.name}.timeline.json"
    )


def cmd_get(a) -> None:
    from .store import Store

    tl = Store().get(a.id if ":" in a.id else f"spotify:track:{a.id}")
    print(json.dumps(tl, ensure_ascii=False)[:2000] if tl else "not found")


def cmd_list(a) -> None:
    from .store import Store

    for t in Store().list():
        print(t["id"], json.dumps(t["meta"]))


def cmd_upload(a) -> None:
    from .analysis import validate_timeline
    from .store import Store

    tl = json.loads(Path(a.file).read_text(encoding="utf8"))
    tl.pop("title", None)
    errs = validate_timeline(tl)
    if errs:
        raise SystemExit(f"invalid: {errs[:5]}")
    print(Store().put(tl))


COMMANDS = {k[4:].replace("_", "-"): v for k, v in globals().items() if k.startswith("cmd_")}

if __name__ == "__main__":
    sys.exit(main())
