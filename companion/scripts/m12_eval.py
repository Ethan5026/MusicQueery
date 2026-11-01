"""M12 spike: chord post-processing variants on the cached recogniser outputs (m12_cache.py), scored on truth.

    .venv/Scripts/python.exe scripts/m12_eval.py [--variants base,smooth,...] [--grid]

Per truth song: MIREX root / majmin / sevenths per beat, the jazz score, and chord changes per bar against the truth's.
Human-annotated pop (D-39) and iReal-chart truths (D-37) are summed apart, so pop is never traded for jazz (D-36).
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from mqc import analysis as A  # noqa: E402
from mqc import evaluate as E  # noqa: E402
from mqc.config import TRUTH_DIR, WORK_DIR  # noqa: E402

CACHE = WORK_DIR / "m12"


def songs() -> list[tuple[str, dict, dict]]:
    out = []
    for p in sorted(TRUTH_DIR.glob("*.timeline.json")):
        name = p.name[: -len(".timeline.json")]
        c = CACHE / f"{name}.json"
        if not c.exists():
            continue
        meta = json.loads((TRUTH_DIR / f"{name}.json").read_text(encoding="utf8"))
        out.append((name, json.loads(p.read_text(encoding="utf8")), json.loads(c.read_text(encoding="utf8")), meta))
    return out


def segs(raw) -> A.Segments:
    return [(float(s), float(e), str(lab)) for s, e, lab in raw]


def run(variant: str, cache: dict, params: dict) -> tuple[A.Segments, A.Beats]:
    b = A.Beats(np.array(cache["beats"]["reg"][0]), np.array(cache["beats"]["reg"][1]))
    if params.get("tempo_fix"):
        b = A.fix_double_time(b)
    end = cache["end"]
    mix = {r: segs(cache["mix"][r]) for r in A.VOTE_WEIGHTS}
    stems = {r: segs(cache["stems"][r]) for r in A.VOTE_WEIGHTS} if "stems" in cache else None
    if variant == "base":
        return A.vote(mix, b.beats, end), b
    if variant == "smooth":
        return A.vote_smooth(mix, b, end, **params.get("smooth", {})), b
    if variant == "stems":
        return A.vote(stems, b.beats, end), b
    if variant == "stems+smooth":
        return A.vote_smooth(stems, b, end, **params.get("smooth", {})), b
    if variant in ("pl", "pl+smooth"):  # BTC-PL in BTC's place (research/alternative-approaches.md, idea 1)
        per = {**mix, "btc": segs(cache["mix"]["btcpl"])}
        return (A.vote(per, b.beats, end) if variant == "pl" else A.vote_smooth(per, b, end)), b
    if variant == "smooth+plnames":  # the three vote; BTC-PL only names the chords they settle on
        return A.vote_smooth(mix, b, end, namers={"btcpl": segs(cache["mix"]["btcpl"])}), b
    if variant == "pl4+smooth":  # BTC-PL as a fourth voter, as heavy as BTC
        per = {**mix, "btcpl": segs(cache["mix"]["btcpl"])}
        return A.vote_smooth(per, b, end, weights={"btcpl": 1.2, **A.VOTE_WEIGHTS}), b
    if variant in ("both", "both+smooth"):
        per = {**mix, **{f"{r}_s": s for r, s in stems.items()}}
        w = {**A.VOTE_WEIGHTS, **{f"{r}_s": v * params.get("stem_w", 1.0) for r, v in A.VOTE_WEIGHTS.items()}}
        if variant == "both":
            return A.vote(per, b.beats, end, weights=w), b
        return A.vote_smooth(per, b, end, weights=w, **params.get("smooth", {})), b
    raise ValueError(variant)


def changes_per_bar(tl: dict) -> float:
    n = sum(1 for c in tl["chords"] if c["symbol"] != "N.C.")
    bars = len(tl["bars"]) or max(1, len(tl["beats"]) // 4)
    return n / bars


def score(variant: str, params: dict, quiet: bool = False) -> dict:
    tot: dict[str, dict] = {"human": {}, "ireal": {}}
    for name, truth, cache, meta in songs():
        sg, b = run(variant, cache, params)
        tl, _ = A.build_timeline(truth["id"].split(":")[-1], truth["durationMs"], b, sg, variant, sevenths=False)
        if params.get("dump"):
            Path(params["dump"]).mkdir(parents=True, exist_ok=True)
            (Path(params["dump"]) / f"{name}.json").write_text(json.dumps(tl, ensure_ascii=False), encoding="utf8")
        s = E.chord_scores(truth, tl)
        truth_cpb = len([c for c in truth["chords"] if c.get("harte", c["symbol"]) not in ("N", "N.C.")]) / max(
            1, len(truth["beats"]) / 4
        )
        cpb = len([c for c in tl["chords"] if c["symbol"] != "N.C."]) / max(1, len(tl["beats"]) / 4)
        kind = "human" if "annotation" in meta else "ireal"
        t = tot[kind]
        for k in ("root", "majmin", "sevenths", "jazz"):
            if s[k] is not None:
                t.setdefault(k, []).append(s[k])
        t.setdefault("cpb", []).append(cpb / truth_cpb)
        if not quiet:
            print(
                f"  {name[:30]:30} {kind:5} root {s['root']:.3f} majmin {s['majmin']:.3f} 7ths {s['sevenths'] or 0:.3f}"
                f" jazz {s['jazz'] or 0:.3f}  changes/bar {cpb:.2f} (truth {truth_cpb:.2f})"
            )
    out = {}
    for kind, t in tot.items():
        out[kind] = {k: round(float(np.mean(v)), 4) for k, v in t.items()}
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--variants", default="base,smooth")
    p.add_argument("--grid", action="store_true", help="sweep the smoothing penalties")
    p.add_argument("--quiet", action="store_true")
    p.add_argument("--dump", help="write each variant's timelines into this folder")
    a = p.parse_args()
    if a.grid:
        for down in (0.3,):
            for half in (0.6, 1.2, 2.0):
                for off in (1.2, 2.0, 3.0):
                    params = {"smooth": {"down": down, "half": half, "off": off}}
                    r = score("smooth", params, quiet=True)
                    print(f"down {down} half {half} off {off}: human {r['human']}  ireal {r['ireal']}", flush=True)
        return
    for v in a.variants.split(","):
        print(f"== {v}")
        r = score(v, {"tempo_fix": True, **({"dump": f"{a.dump}/{v}"} if a.dump else {})}, quiet=a.quiet)
        print(f"   human {r['human']}\n   ireal {r['ireal']}", flush=True)


if __name__ == "__main__":
    main()
