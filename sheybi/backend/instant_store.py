from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


DEFAULT_API_URL = "https://api.instantdb.com"


def _env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"missing_{name.lower()}")
    return value


@dataclass(frozen=True)
class InstantConfig:
    app_id: str
    admin_token: str
    api_url: str = DEFAULT_API_URL


def get_config() -> InstantConfig:
    app_id = os.getenv("INSTANT_APP_ID") or os.getenv("NEXT_PUBLIC_INSTANT_APP_ID")
    token = os.getenv("INSTANT_ADMIN_TOKEN") or os.getenv("INSTANT_TOKEN")
    if not app_id:
        raise RuntimeError("missing_instant_app_id")
    if not token:
        raise RuntimeError("missing_instant_admin_token")
    return InstantConfig(app_id=app_id.strip(), admin_token=token.strip())


def _request(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    cfg = get_config()
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{cfg.api_url.rstrip('/')}{path}",
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cfg.admin_token}",
            "App-Id": cfg.app_id,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            raw = res.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            detail = json.loads(raw) if raw else {}
        except Exception:
            detail = {"raw": raw}
        raise RuntimeError(f"instant_http_{exc.code}: {detail}") from exc


def admin_query(query: dict[str, Any]) -> dict[str, Any]:
    payload = {"query": query}
    result = _request("/admin/query", payload)
    if isinstance(result, dict) and "data" in result and isinstance(result["data"], dict):
        return result["data"]
    return result


def admin_transact(steps: list[list[Any]]) -> dict[str, Any]:
    return _request("/admin/transact", {"steps": steps})
