"""Calls packages/theory through scripts/bridge.ts (bundled to dist/bridge.mjs) so Python never re-implements
chord spelling, key detection or the iReal parser."""

from __future__ import annotations

import json
import shutil
import subprocess
from typing import Any

from .config import REPO

BRIDGE = REPO / "packages" / "theory" / "dist" / "bridge.mjs"
CORPUS = REPO / "packages" / "theory" / "corpus"
# iReal's official playlists (D-30), best first: standards, then the rest. Pop 400 too: on Let It Be its chart lined up
# over the recognisers scores above them against the human annotation (M12).
CORPUS_LISTS = ["jazz1460", "brazilian220", "latin50", "blues50", "pop400", "country50"]
SOURCES = [REPO / "packages" / "theory" / "scripts" / "bridge.ts", *(REPO / "packages" / "theory" / "src").glob("*.ts")]


class BridgeError(RuntimeError):
    pass


def _ensure_built() -> None:
    newest = max(p.stat().st_mtime for p in SOURCES)
    if BRIDGE.exists() and BRIDGE.stat().st_mtime >= newest:
        return
    pnpm = shutil.which("pnpm") or "pnpm"
    subprocess.run([pnpm, "--filter", "@mq/theory", "bridge"], cwd=REPO, check=True, capture_output=True)


def call(req: dict[str, Any]) -> Any:
    _ensure_built()
    node = shutil.which("node") or "node"
    r = subprocess.run([node, str(BRIDGE)], input=json.dumps(req), capture_output=True, text=True, encoding="utf8")
    out = json.loads(r.stdout) if r.stdout else {}
    if r.returncode != 0 or "error" in out:
        raise BridgeError(out.get("error") or r.stderr)
    return out


def finish(chords: list[dict], beats_ms: list[float], harte: bool = True, sevenths: bool = False) -> dict:
    return call({"op": "finish", "chords": chords, "beats": beats_ms, "harte": harte, "sevenths": sevenths})


def harte(symbols: list[str]) -> list[str | None]:
    return call({"op": "harte", "symbols": symbols})["harte"]


def chart(playlist: str, title: str) -> dict:
    return call({"op": "chart", "playlist": playlist, "title": title})


def find_charts(title: str) -> list[dict]:
    """Chart v1 for every iReal chart titled like the track (at most 4); empty when the corpus isn't fetched
    (`pnpm --filter @mq/theory corpus`)."""
    lists = [str(CORPUS / f"{n}.txt") for n in CORPUS_LISTS if (CORPUS / f"{n}.txt").exists()]
    return call({"op": "find", "title": title, "playlists": lists})["charts"] if lists else []
