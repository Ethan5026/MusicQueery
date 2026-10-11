"""Client for the Worker timeline store (D-17, D-32): PUT/GET/DELETE /api/timelines/:id, GET /api/timelines,
and the analysis queue the phone fills (M5): GET /api/queue, PUT/DELETE /api/queue/:id."""

from __future__ import annotations

import urllib.parse
from typing import Any

import httpx

from .config import Settings


class StoreError(RuntimeError):
    pass


class Store:
    def __init__(self, settings: Settings | None = None) -> None:
        self.s = settings or Settings.load()
        self._http = httpx.Client(base_url=self.s.api_url, timeout=30)

    def _auth(self) -> dict[str, str]:
        if not self.s.api_secret:
            raise StoreError("no API secret: run `mqc setup-secret`")
        return {"Authorization": f"Bearer {self.s.api_secret}"}

    @staticmethod
    def _path(tid: str) -> str:
        return "/timelines/" + urllib.parse.quote(tid, safe=":")

    def put(self, tl: dict[str, Any]) -> dict[str, Any]:
        r = self._http.put(self._path(tl["id"]), json=tl, headers=self._auth())
        if r.status_code != 200:
            raise StoreError(f"PUT {tl['id']}: {r.status_code} {r.text[:500]}")
        return r.json()

    def get(self, tid: str) -> dict[str, Any] | None:
        r = self._http.get(self._path(tid))
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise StoreError(f"GET {tid}: {r.status_code} {r.text[:200]}")
        return r.json()

    def list(self) -> list[dict[str, Any]]:
        r = self._http.get("/timelines", headers=self._auth())
        if r.status_code != 200:
            raise StoreError(f"list: {r.status_code} {r.text[:200]}")
        return r.json()["timelines"]

    def delete(self, tid: str) -> None:
        r = self._http.delete(self._path(tid), headers=self._auth())
        if r.status_code != 204:
            raise StoreError(f"DELETE {tid}: {r.status_code} {r.text[:200]}")

    def queue(self) -> list[dict[str, Any]]:
        r = self._http.get("/queue", headers=self._auth())
        if r.status_code != 200:
            raise StoreError(f"queue: {r.status_code} {r.text[:200]}")
        return r.json()["queue"]

    def queue_set(self, tid: str, state: str, error: str | None = None) -> None:
        body: dict[str, Any] = {"state": state, **({"error": error[:500]} if error else {})}
        r = self._http.put("/queue/" + urllib.parse.quote(tid, safe=":"), json=body, headers=self._auth())
        if r.status_code not in (200, 404):
            raise StoreError(f"queue {tid}: {r.status_code} {r.text[:200]}")

    def queue_delete(self, tid: str) -> None:
        r = self._http.delete("/queue/" + urllib.parse.quote(tid, safe=":"), headers=self._auth())
        if r.status_code != 204:
            raise StoreError(f"queue DELETE {tid}: {r.status_code} {r.text[:200]}")

    def log(self, lines: list[dict[str, Any]]) -> None:
        try:
            self._http.post("/log", json={"session": "companion", "lines": lines}, headers=self._auth())
        except (httpx.HTTPError, StoreError):
            pass  # logging is best effort
