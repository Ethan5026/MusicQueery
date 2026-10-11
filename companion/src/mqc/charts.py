"""Chart-informed recognition (P-07): published chord charts from Chordonomicon, aligned to the audio.

Chordonomicon (Kantarelis et al. 2024, CC BY-NC 4.0, https://huggingface.co/datasets/ailsntua/Chordonomicon) holds
~680k Ultimate Guitar charts with Spotify track ids. Charts are untimed chord lists with section tags, so they are
placed on the beats by Jump Alignment (McVicar et al. 2011, JNMR 40:2): an HMM whose states are the chart's chords in
order; each beat stays, advances one chord, or jumps to the start of any section (a chart often writes a chorus once).
Emissions combine how well the chord's notes fit the beat's chroma with whether the recognisers' vote has the same
root and third. Every transposition is tried (capo charts). If the aligned chart agrees too little with what we hear,
the caller keeps plain recognition.
"""

from __future__ import annotations

import csv
import os
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

import mir_eval
import numpy as np

from . import bridge

LOCAL = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "MusicQueery"
CSV_PATH = LOCAL / "dl" / "chordonomicon" / "chordonomicon_v2.csv"
CSV_URL = "https://huggingface.co/datasets/ailsntua/Chordonomicon/resolve/main/chordonomicon_v2.csv"
DB_PATH = LOCAL / "chordonomicon.sqlite"


# ---------------------------------------------------------------- index


def build_index(csv_path: Path = CSV_PATH, db_path: Path = DB_PATH, log=print) -> int:
    """One-time: Chordonomicon CSV → SQLite keyed by Spotify track id (rows without one are skipped)."""
    if not csv_path.exists():
        raise FileNotFoundError(f"{csv_path} missing; download {CSV_URL} into that folder")
    csv.field_size_limit(10**8)
    tmp = db_path.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    con = sqlite3.connect(tmp)
    con.execute("CREATE TABLE charts (song_id TEXT, artist_id TEXT, row_id TEXT, genres TEXT, chords TEXT)")
    n = 0
    with open(csv_path, encoding="utf8", newline="") as fh:
        batch = []
        for row in csv.DictReader(fh):
            if not row["spotify_song_id"]:
                continue
            batch.append((row["spotify_song_id"], row["spotify_artist_id"], row["id"], row["genres"], row["chords"]))
            if len(batch) >= 20000:
                con.executemany("INSERT INTO charts VALUES (?,?,?,?,?)", batch)
                n += len(batch)
                batch = []
        con.executemany("INSERT INTO charts VALUES (?,?,?,?,?)", batch)
        n += len(batch)
    con.execute("CREATE INDEX by_song ON charts(song_id)")
    con.execute("CREATE TABLE lookups (track_id TEXT PRIMARY KEY, song_ids TEXT)")
    con.commit()
    con.close()
    os.replace(tmp, db_path)
    log(f"indexed {n} charts with Spotify ids → {db_path}")
    return n


@dataclass
class Chart:
    row_id: str
    song_id: str
    chords: str  # Chordonomicon text: chords and <section_n> tags


def lookup(sp, track_id: str, db_path: Path = DB_PATH) -> list[Chart]:
    """Charts for a Spotify track: by its id, else by the ids of other releases of the same song (Spotify search,
    title + first artist; dev mode allows at most 10 results). Search results are cached in the index."""
    if not db_path.exists():
        return []
    con = sqlite3.connect(db_path)
    try:
        rows = con.execute("SELECT row_id, song_id, chords FROM charts WHERE song_id = ?", (track_id,)).fetchall()
        if rows:
            return [Chart(*r) for r in rows]
        cached = con.execute("SELECT song_ids FROM lookups WHERE track_id = ?", (track_id,)).fetchone()
        if cached is None:
            t = sp.track(track_id)
            title = re.sub(r"\s*[-(\[].*$", "", t["name"])
            q = f"track:{title} artist:{t['artists'][0]['name']}"
            r = sp.call("GET", "/search", params={"q": q, "type": "track", "limit": 10})
            ids = [x["id"] for x in r.json()["tracks"]["items"]] if r.status_code == 200 else []
            ids = [i for i in ids if i != track_id]
            con.execute("INSERT OR REPLACE INTO lookups VALUES (?, ?)", (track_id, ",".join(ids)))
            con.commit()
        else:
            ids = [i for i in cached[0].split(",") if i]
        if not ids:
            return []
        marks = ",".join("?" * len(ids))
        rows = con.execute(f"SELECT row_id, song_id, chords FROM charts WHERE song_id IN ({marks})", ids).fetchall()
        return [Chart(*r) for r in rows]
    finally:
        con.close()


# ---------------------------------------------------------------- parsing


def ug_text(token: str) -> str | None:
    """Chordonomicon spelling → lead-sheet text: `Amin7` → `Am7`, `Cs/Gs` → `C#/G#`."""
    m = re.match(r"^([A-G])(s|b)?(.*)$", token)
    if not m:
        return None
    root, acc, rest = m.groups()
    rest = re.sub(r"/([A-G])s", r"/\1#", rest).replace("min", "m")
    return root + {"s": "#", "b": "b", None: ""}[acc] + rest


@dataclass
class ParsedChart:
    texts: list[str]  # lead-sheet chord text per chart position
    harte: list[str]
    starts: list[int]  # positions where a section begins (jump targets)


def parse(chords: str) -> ParsedChart | None:
    texts, starts = [], []
    for tok in chords.split():
        if tok.startswith("<"):
            starts.append(len(texts))
            continue
        t = ug_text(tok)
        if t is not None:
            texts.append(t)
    if len(texts) < 4:
        return None
    harte = bridge.harte(texts)
    keep = [i for i, h in enumerate(harte) if h and h not in ("N", "X")]
    remap = {old: new for new, old in enumerate(keep)}
    texts = [texts[i] for i in keep]
    harte = [harte[i] for i in keep]
    starts = sorted({remap[s] for s in starts if s in remap} | {0})
    return ParsedChart(texts, harte, starts)


# ---------------------------------------------------------------- alignment


def _template(harte: str, shift: int) -> tuple[np.ndarray, int, int]:
    """(12-dim chord-tone template, root pc, third class) for a Harte label transposed by `shift` semitones."""
    root, bitmap, _ = mir_eval.chord.encode(harte)
    root = (root + shift) % 12
    tones = np.roll(bitmap, root).astype(float)
    tones[root] += 0.5  # the root carries most weight
    third = 1 if bitmap[3] else 0  # 1 = minor third
    return tones / np.linalg.norm(tones), root, third


def beat_chroma(audio: np.ndarray, sr: int, beats_s: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per beat: L2-normalised CQT chroma (beats × 12) and a 'quiet' flag (RMS 30 dB under the track's median)."""
    import librosa

    from .analysis import resample

    a = resample(audio, sr, 22050)
    hop = 512
    chroma = librosa.feature.chroma_cqt(y=a, sr=22050, hop_length=hop)
    rms = librosa.feature.rms(y=a, hop_length=hop)[0]
    t = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=22050, hop_length=hop)
    edges = np.concatenate([[0.0], beats_s, [len(a) / 22050]])
    out, quiet = [], []
    med = float(np.median(rms)) + 1e-9
    for lo, hi in zip(edges[:-1], edges[1:], strict=True):
        sel = (t >= lo) & (t < hi)
        c = chroma[:, sel].mean(axis=1) if sel.any() else np.zeros(12)
        out.append(c / (np.linalg.norm(c) + 1e-9))
        quiet.append(bool(sel.any() and rms[sel].mean() < med * 10 ** (-30 / 20)))
    return np.array(out), np.array(quiet)


@dataclass
class Alignment:
    segs: list[tuple[float, float, str]]  # (start_s, end_s, lead-sheet text)
    shift: int  # semitones added to the chart
    score: float  # mean emission per beat on the best path
    agreement: float  # share of chorded beats whose root matches the recognisers' vote


ADVANCE = 0.25
JUMP = 1.5
W_VOTE_ROOT = 0.6
W_VOTE_THIRD = 0.3


def align(
    chart: ParsedChart, chroma: np.ndarray, quiet: np.ndarray, vote_labels: list[str], edges_s: np.ndarray
) -> Alignment:
    """Best Jump-Alignment path over all 12 transpositions. `vote_labels` has one Harte label per beat interval;
    `edges_s` are the beat-interval boundaries (len = beats + 1). States: 0 = no chord, 1..N = chart positions."""
    T, N = len(chroma), len(chart.harte)
    vroot = np.array([_vroot(v) for v in vote_labels])
    vthird = np.array([_vthird(v) for v in vote_labels])
    best: Alignment | None = None
    starts = np.array(chart.starts)
    for shift in range(12):
        tm = [_template(h, shift) for h in chart.harte]
        tmpl = np.array([x[0] for x in tm])
        roots = np.array([x[1] for x in tm])
        thirds = np.array([x[2] for x in tm])
        em = chroma @ tmpl.T  # T × N cosine
        em += W_VOTE_ROOT * (vroot[:, None] == roots[None, :])
        em += W_VOTE_THIRD * ((vroot[:, None] == roots[None, :]) & (vthird[:, None] == thirds[None, :]))
        em_nc = np.where(quiet, 1.2, 0.35)
        em = np.where(quiet[:, None], em - 0.8, em)
        # Viterbi in log-free score space (sum of emissions minus transition costs); state 0 = N.C.
        score = np.full(N + 1, -np.inf)
        score[0] = em_nc[0]
        score[1:] = -np.inf
        score[1 + starts] = em[0, starts]
        back = np.zeros((T, N + 1), dtype=np.int32)
        back[0] = np.arange(N + 1)
        for t in range(1, T):
            prev = score
            stay = prev.copy()
            adv = np.full(N + 1, -np.inf)
            adv[2:] = prev[1:-1] - ADVANCE
            best_any = int(np.argmax(prev))
            jump_val = prev[best_any] - JUMP
            new = np.maximum(stay, adv)
            arg = np.where(adv > stay, np.arange(N + 1) - 1, np.arange(N + 1))
            # jumps land on section starts (and N.C.), from anywhere
            for s in starts:
                if jump_val > new[1 + s]:
                    new[1 + s] = jump_val
                    arg[1 + s] = best_any
            if jump_val > new[0]:
                new[0] = jump_val
                arg[0] = best_any
            if prev[0] - ADVANCE > new[1 + starts[0]]:
                new[1 + starts[0]] = prev[0] - ADVANCE
                arg[1 + starts[0]] = 0
            new[0] += em_nc[t]
            new[1:] += em[t]
            back[t] = arg
            score = new
        total = float(score.max())
        if best is not None and total / T <= best.score:
            continue
        path = np.zeros(T, dtype=np.int32)
        path[-1] = int(np.argmax(score))
        for t in range(T - 1, 0, -1):
            path[t - 1] = back[t, path[t]]
        labels = ["N.C." if p == 0 else _transpose_text(chart.texts[p - 1], shift) for p in path]
        chorded = (path > 0) & (vroot >= 0)
        agree = float((roots[path[chorded] - 1] == vroot[chorded]).mean()) if chorded.any() else 0.0
        segs: list[tuple[float, float, str]] = []
        for t, lab in enumerate(labels):
            if segs and segs[-1][2] == lab and path[t] == path[t - 1]:
                segs[-1] = (segs[-1][0], float(edges_s[t + 1]), lab)
            else:
                segs.append((float(edges_s[t]), float(edges_s[t + 1]), lab))
        best = Alignment(segs, shift, total / T, agree)
    assert best is not None
    return best


NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
PCS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _pc(name: str) -> int:
    return (PCS[name[0]] + name.count("#") - name.count("b")) % 12


def _transpose_text(text: str, shift: int) -> str:
    """Shifts the root and bass of lead-sheet text (neutral spelling; respelled in key later)."""
    if shift == 0:
        return text

    def sub(m: re.Match) -> str:
        return NAMES[(_pc(m.group(0)) + shift) % 12]

    head = re.sub(r"^[A-G][#b]?", sub, text)
    return re.sub(r"/([A-G][#b]?)", lambda m: "/" + NAMES[(_pc(m.group(1)) + shift) % 12], head)


def _vroot(label: str) -> int:
    if label in ("N", "X", ""):
        return -1
    return _pc(label.split(":")[0].split("/")[0])


def _vthird(label: str) -> int:
    if label in ("N", "X", ""):
        return -1
    q = label.partition(":")[2] or "maj"
    return 1 if q.startswith(("min", "dim", "hdim")) else 0


# ---------------------------------------------------------------- glue


@dataclass
class ChartResult:
    alignment: Alignment
    chart: Chart
    candidates: int


def interval_edges(beats_s: np.ndarray, end_s: float) -> np.ndarray:
    """Beat-interval boundaries, the same convention as `beat_chroma` (a leading interval from 0)."""
    return np.concatenate([[0.0], beats_s, [end_s]])


def labels_per_interval(segs: list[tuple[float, float, str]], edges: np.ndarray) -> list[str]:
    mids = (edges[:-1] + edges[1:]) / 2
    out, j = [], 0
    for m in mids:
        while j < len(segs) and segs[j][1] <= m:
            j += 1
        out.append(segs[j][2] if j < len(segs) and segs[j][0] <= m else "N")
    return out


def align_best(
    charts: list[Chart], audio: np.ndarray, sr: int, beats_s: np.ndarray, vote_segs: list[tuple[float, float, str]]
) -> ChartResult | None:
    """Aligns every candidate chart and keeps the one with the best mean path score."""
    end = len(audio) / sr
    edges = interval_edges(beats_s, end)
    chroma, quiet = beat_chroma(audio, sr, beats_s)
    vlab = labels_per_interval(vote_segs, edges)
    best: ChartResult | None = None
    for c in charts:
        parsed = parse(c.chords)
        if parsed is None:
            continue
        al = align(parsed, chroma, quiet, vlab, edges)
        if best is None or al.score > best.alignment.score:
            best = ChartResult(al, c, len(charts))
    return best


def merge_with_recognition(
    al: Alignment,
    per: dict[str, list],
    vote_segs: list[tuple[float, float, str]],
    beats_s: np.ndarray,
    end_s: float,
    any_recogniser: bool = True,
) -> list[tuple[float, float, str]]:
    """Per beat interval: the aligned chart's chord where its root matches the vote (or, with `any_recogniser`, any
    single recogniser), else the vote's chord. Charts know chord names (7ths, slash chords); the recognisers place them.
    Returns lead-sheet text segments."""
    from .analysis import beat_sync
    from .annotated import _root as harte_root  # noqa: PLC2701

    edges = interval_edges(beats_s, end_s)
    chart_lab = labels_per_interval([(s, e, lab) for s, e, lab in al.segs], edges)
    vote_lab = labels_per_interval(vote_segs, edges)
    rec_labs = [labels_per_interval(beat_sync(per[r], beats_s, end_s), edges) for r in per]
    chart_h = bridge.harte([c if c != "N" else "N.C." for c in chart_lab])
    out: list[tuple[float, float, str]] = []
    for i, (c, ch, v) in enumerate(zip(chart_lab, chart_h, vote_lab, strict=True)):
        croot = harte_root(ch) if ch else -1
        roots = {harte_root(v)} | ({harte_root(r[i]) for r in rec_labs} if any_recogniser else set())
        lab = c if croot >= 0 and croot in roots else _harte_to_text(v)
        if out and out[-1][2] == lab:
            out[-1] = (out[-1][0], float(edges[i + 1]), lab)
        else:
            out.append((float(edges[i]), float(edges[i + 1]), lab))
    return out


def _harte_to_text(label: str) -> str:
    """Harte → lead-sheet text (mirror of `fromHarte` in @mq/theory)."""
    if label in ("N", "X", ""):
        return "N.C."
    root, _, q = label.partition(":")
    root = root.split("/")[0]
    q = (q or "maj").split("/")[0]
    base = q.split("(")[0]
    table = {
        "maj": "",
        "min": "m",
        "7": "7",
        "maj7": "maj7",
        "min7": "m7",
        "dim": "dim",
        "dim7": "dim7",
        "hdim7": "m7b5",
        "aug": "+",
        "maj6": "6",
        "min6": "m6",
        "minmaj7": "mMaj7",
        "sus4": "sus4",
        "sus2": "sus2",
        "9": "9",
        "min9": "m9",
        "maj9": "maj9",
        "5": "5",
        "1": "5",
    }
    return root + table.get(base, "")


def chart_vocabulary(chart: ParsedChart, shift: int = 0, min_share: float = 0.6) -> dict[tuple[int, int], str]:
    """(root pc, third: 0 major / 1 minor) → the chart's usual chord name for it, when one name covers at least
    `min_share` of that root+third's appearances (e.g. every F in the chart is written Fmaj7)."""
    from collections import Counter

    seen: dict[tuple[int, int], Counter] = {}
    for text, h in zip(chart.texts, chart.harte, strict=True):
        key = ((_vroot(h) + shift) % 12, _vthird(h))
        seen.setdefault(key, Counter())[_transpose_text(text, shift).split("/")[0]] += 1
    out = {}
    for key, c in seen.items():
        name, n = c.most_common(1)[0]
        if n / sum(c.values()) >= min_share:
            out[key] = name
    return out


def rename_with_vocabulary(vote_segs: list[tuple[float, float, str]], vocab: dict[tuple[int, int], str]):
    """Recognised chords (Harte) → lead-sheet text, renamed to the chart's usual name for the same root and third.
    Keeps the recognisers' timing and roots; only the chord quality (7ths, 6ths, sus…) comes from the chart."""
    out = []
    for s, e, lab in vote_segs:
        r, th = _vroot(lab), _vthird(lab)
        out.append((s, e, vocab.get((r, th), _harte_to_text(lab)) if r >= 0 else "N.C."))
    return out
