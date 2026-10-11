"""Spotify Web API for the companion: PKCE login on 127.0.0.1, token refresh, player control (D-19, D-24)."""

from __future__ import annotations

import base64
import hashlib
import http.server
import json
import os
import secrets
import threading
import time
import urllib.parse
import webbrowser
from dataclasses import dataclass
from typing import Any

import httpx

from .config import CONFIG_DIR, SPOTIFY_REDIRECT_PORT, spotify_client_id

ACCOUNTS = "https://accounts.spotify.com"
API = "https://api.spotify.com/v1"
SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private"
REDIRECT = f"http://127.0.0.1:{SPOTIFY_REDIRECT_PORT}/callback"
TOKENS = CONFIG_DIR / "spotify.json"


class SpotifyError(RuntimeError):
    pass


def login(open_browser: bool = True) -> None:
    """Authorization Code + PKCE with a one-shot local server on the redirect port."""
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    url = f"{ACCOUNTS}/authorize?" + urllib.parse.urlencode(
        {
            "client_id": spotify_client_id(),
            "response_type": "code",
            "redirect_uri": REDIRECT,
            "code_challenge_method": "S256",
            "code_challenge": challenge,
            "state": state,
            "scope": SCOPES,
        }
    )
    result: dict[str, str] = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
            if not self.path.startswith("/callback"):
                self.send_response(404)
                self.end_headers()
                return
            result.update(q)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            msg = "MusicQueery companion is logged in. You can close this tab." if "code" in q else f"Login failed: {q}"
            self.wfile.write(f"<p style='font:16px system-ui'>{msg}</p>".encode())

        def log_message(self, *args: Any) -> None:
            pass

    server = http.server.HTTPServer(("127.0.0.1", SPOTIFY_REDIRECT_PORT), Handler)
    print(f"Open this URL to log in (if the browser did not open):\n{url}\n", flush=True)
    if open_browser:
        webbrowser.open(url)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    deadline = time.time() + 1800
    while "code" not in result and "error" not in result and time.time() < deadline:
        time.sleep(0.2)
    server.shutdown()
    if result.get("state") != state or "code" not in result:
        raise SpotifyError(f"login failed: {result or 'timeout'}")
    _token_request(
        {
            "grant_type": "authorization_code",
            "code": result["code"],
            "redirect_uri": REDIRECT,
            "code_verifier": verifier,
        }
    )


def _token_request(body: dict[str, str]) -> dict[str, Any]:
    r = httpx.post(f"{ACCOUNTS}/api/token", data={"client_id": spotify_client_id(), **body}, timeout=20)
    if r.status_code != 200:
        raise SpotifyError(f"token request failed: {r.status_code} {r.text}")
    tok = r.json()
    old = json.loads(TOKENS.read_text()) if TOKENS.exists() else {}
    saved = {
        "access_token": tok["access_token"],
        "refresh_token": tok.get("refresh_token", old.get("refresh_token")),
        "expires_at": time.time() + tok["expires_in"] - 60,
        "first_login": old.get("first_login", time.strftime("%Y-%m-%d")),
    }
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp = TOKENS.with_suffix(".tmp")
    tmp.write_text(json.dumps(saved, indent=2))
    os.replace(tmp, TOKENS)
    return saved


@dataclass
class PlayerState:
    """One /me/player sample, stamped with time.perf_counter_ns() at the request midpoint."""

    t_ns: int
    rtt_ms: float
    track_id: str | None
    progress_ms: int
    timestamp: int
    is_playing: bool
    device_id: str | None
    device_name: str | None


class Spotify:
    def __init__(self) -> None:
        if not TOKENS.exists():
            raise SpotifyError("not logged in: run `mqc login`")
        self._tok = json.loads(TOKENS.read_text())
        self._http = httpx.Client(base_url=API, timeout=15)

    def _access(self) -> str:
        if time.time() >= self._tok["expires_at"]:
            self._tok = _token_request({"grant_type": "refresh_token", "refresh_token": self._tok["refresh_token"]})
        return self._tok["access_token"]

    def call(self, method: str, path: str, **kw: Any) -> httpx.Response:
        for attempt in range(5):
            r = self._http.request(method, path, headers={"Authorization": f"Bearer {self._access()}"}, **kw)
            if r.status_code == 401 and attempt == 0:
                self._tok["expires_at"] = 0
                continue
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(float(r.headers.get("Retry-After", 1 + attempt)))
                continue
            return r
        return r

    def get(self, path: str, **params: Any) -> Any:
        r = self.call("GET", path, params=params)
        if r.status_code == 204:
            return None
        if r.status_code != 200:
            raise SpotifyError(f"GET {path}: {r.status_code} {r.text}")
        return r.json()

    def put(self, path: str, body: Any = None, **params: Any) -> None:
        r = self.call("PUT", path, params=params, json=body)
        if r.status_code not in (200, 202, 204):
            raise SpotifyError(f"PUT {path}: {r.status_code} {r.text}")

    def player(self) -> PlayerState | None:
        t0 = time.perf_counter_ns()
        r = self.call("GET", "/me/player", params={"additional_types": "track"})
        t1 = time.perf_counter_ns()
        if r.status_code == 204:
            return None
        if r.status_code != 200:
            raise SpotifyError(f"GET /me/player: {r.status_code} {r.text}")
        d = r.json()
        item, dev = d.get("item") or {}, d.get("device") or {}
        return PlayerState(
            t_ns=(t0 + t1) // 2,
            rtt_ms=(t1 - t0) / 1e6,
            track_id=item.get("id"),
            progress_ms=d.get("progress_ms") or 0,
            timestamp=d.get("timestamp") or 0,
            is_playing=bool(d.get("is_playing")),
            device_id=dev.get("id"),
            device_name=dev.get("name"),
        )

    def devices(self) -> list[dict[str, Any]]:
        return self.get("/me/player/devices")["devices"]

    def track(self, track_id: str) -> dict[str, Any]:
        return self.get(f"/tracks/{track_id}")

    def playlist_tracks(self, playlist_id: str) -> list[dict[str, Any]]:
        out, path = [], f"/playlists/{playlist_id}/tracks"
        params: dict[str, Any] = {"limit": 100, "additional_types": "track"}
        while path:
            page = self.get(path, **params)
            out += [i["track"] for i in page["items"] if i.get("track") and i["track"].get("id")]
            path, params = (page["next"].replace(API, "") if page.get("next") else ""), {}
        return out

    def play(self, track_id: str, device_id: str, position_ms: int = 0) -> None:
        """Starts the track inside its album. The Windows desktop client (2026-10) accepts `{"uris": [...]}` with
        a 204 but never loads the track; an album context with an offset works (D-33)."""
        album = self.track(track_id)["album"]["uri"]
        body = {"context_uri": album, "offset": {"uri": f"spotify:track:{track_id}"}, "position_ms": position_ms}
        self.put("/me/player/play", body, device_id=device_id)

    def pause(self, device_id: str | None = None) -> None:
        r = self.call("PUT", "/me/player/pause", params={"device_id": device_id} if device_id else {})
        if r.status_code not in (200, 202, 204, 403):  # 403: already paused
            raise SpotifyError(f"pause: {r.status_code} {r.text}")

    def set_repeat(self, state: str, device_id: str) -> None:
        self.put("/me/player/repeat", None, state=state, device_id=device_id)


def parse_track_id(s: str) -> str:
    """Accepts a bare id, spotify:track:<id> or an open.spotify.com/track/<id> link."""
    s = s.strip()
    if s.startswith("spotify:track:"):
        return s.split(":")[2]
    if "open.spotify.com" in s:
        return urllib.parse.urlparse(s).path.rstrip("/").split("/")[-1]
    return s
