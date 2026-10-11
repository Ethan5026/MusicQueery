"""Paths and settings. Secrets and tokens live outside the repo, in %APPDATA%\\MusicQueery\\companion."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
COMPANION = REPO / "companion"
CAPTURE_EXE = COMPANION / "capture" / "bin" / "mqcapture.exe"
TIMELINE_SCHEMA = REPO / "packages" / "model" / "schema" / "timeline.v1.json"
TRUTH_DIR = COMPANION / "truth"

CONFIG_DIR = Path(os.environ.get("APPDATA", Path.home())) / "MusicQueery" / "companion"
WORK_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "MusicQueery" / "work"

DEFAULT_API = "https://musicqueery.ethangruening.workers.dev/api"
SPOTIFY_REDIRECT_PORT = 5173  # http://127.0.0.1:5173/callback is the dev redirect the Spotify app already allows


def spotify_client_id() -> str:
    """The public PKCE client ID, shared with the PWA (apps/web/.env)."""
    if cid := os.environ.get("MQ_SPOTIFY_CLIENT_ID"):
        return cid
    env = (REPO / "apps" / "web" / ".env").read_text(encoding="utf8")
    m = re.search(r"^VITE_SPOTIFY_CLIENT_ID=(\S+)", env, re.M)
    if not m:
        raise RuntimeError("VITE_SPOTIFY_CLIENT_ID missing from apps/web/.env")
    return m.group(1)


@dataclass
class Settings:
    api_url: str = DEFAULT_API
    api_secret: str = ""
    device_name: str = ""  # Spotify Connect name of this PC; defaults to the computer name
    inbox_playlist: str = ""  # M5b: Spotify playlist id whose songs `mqc watch` queues (`mqc inbox set`)
    inbox_name: str = ""

    @staticmethod
    def path() -> Path:
        return CONFIG_DIR / "config.json"

    @classmethod
    def load(cls) -> Settings:
        p = cls.path()
        data = json.loads(p.read_text(encoding="utf8")) if p.exists() else {}
        s = cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})
        s.api_url = os.environ.get("MQ_API_URL", s.api_url).rstrip("/")
        s.api_secret = os.environ.get("MQ_API_SECRET", s.api_secret)
        return s

    def save(self) -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        self.path().write_text(json.dumps(self.__dict__, indent=2), encoding="utf8")
