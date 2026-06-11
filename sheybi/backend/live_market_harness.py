from __future__ import annotations

import argparse
import json
import os
import random
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv()

os.environ.setdefault("DEV_AUTH", "1")

BASE_URL = "http://127.0.0.1:5000"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Live market harness for local stress testing.")
    parser.add_argument("--base-url", default=BASE_URL, help="Backend base URL, e.g. http://127.0.0.1:5000")
    parser.add_argument("--users", type=int, default=100, help="Number of synthetic users to seed")
    parser.add_argument("--markets", type=int, default=20, help="Number of live markets to create")
    parser.add_argument("--min-close-minutes", type=int, default=10, help="Minimum minutes until market close")
    parser.add_argument("--max-close-minutes", type=int, default=60, help="Maximum minutes until market close")
    parser.add_argument("--duration-minutes", type=int, default=75, help="How long the harness should keep trading")
    parser.add_argument("--trades-per-minute", type=int, default=120, help="Random trades generated per minute")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--output-dir", default="backend/logs/live_harness", help="Output directory")
    parser.add_argument("--keep-created-markets", action="store_true", help="Keep harness-created markets after exit")
    return parser.parse_args()


def api_request(
    base_url: str,
    method: str,
    path: str,
    *,
    headers: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
    timeout: int = 30,
) -> tuple[int, dict[str, Any]]:
    url = f"{base_url.rstrip('/')}{path}"
    body = None
    request_headers = {"Accept": "application/json"}
    if headers:
        request_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=request_headers, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read().decode("utf-8")
            return res.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            parsed = json.loads(raw) if raw else {}
        except Exception:
            parsed = {"raw": raw}
        return exc.code, parsed
    except urllib.error.URLError as exc:
        return 0, {"error": "network_error", "detail": str(exc)}


def money(value: Any) -> float:
    try:
        return round(float(value or 0.0), 2)
    except Exception:
        return 0.0


def jsonl_write(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True))
        handle.write("\n")


def admin_user_id() -> str:
    raw = os.getenv("ADMIN_USER_IDS", "")
    for candidate in raw.split(","):
        candidate = candidate.strip()
        if candidate:
            return candidate
    return "dev_admin"


def admin_headers() -> dict[str, str]:
    return {"X-Dev-User-Id": admin_user_id(), "X-Dev-User-Name": "Admin"}


def user_headers(user_id: str, display_name: str) -> dict[str, str]:
    return {
        "X-Dev-User-Id": user_id,
        "X-Dev-User-Name": display_name,
        "X-User-Name": display_name,
    }


def create_market(base_url: str, title: str, start: datetime, close: datetime, option_count: int) -> dict[str, Any]:
    labels = ["YES", "NO"] if option_count == 2 else [f"Option {idx + 1}" for idx in range(option_count)]
    price = round(100.0 / option_count, 2)
    payload = {
        "title": title,
        "rules": "Live harness market.",
        "start": start.isoformat(),
        "close": close.isoformat(),
        "options": [{"label": label, "price": price} for label in labels],
    }
    status, body = api_request(base_url, "POST", "/api/markets", headers=admin_headers(), payload=payload)
    if status not in (200, 201):
        raise RuntimeError(f"market_create_failed: {body}")
    return body


def seed_profile(base_url: str, user_id: str, display_name: str, handle: str) -> None:
    payload = {
        "display_name": display_name,
        "handle": handle,
    }
    status, body = api_request(
        base_url,
        "PUT",
        "/api/me/profile",
        headers=user_headers(user_id, display_name),
        payload=payload,
    )
    if status not in (200, 201):
        raise RuntimeError(f"profile_seed_failed[{user_id}]: {body}")


def fetch_open_markets(base_url: str) -> list[dict[str, Any]]:
    status, body = api_request(base_url, "GET", "/api/markets", headers=admin_headers())
    if status != 200:
        raise RuntimeError(f"markets_fetch_failed: {body}")
    markets = body.get("markets") if isinstance(body, dict) else []
    return [item for item in markets if isinstance(item, dict)]


def choose_trade_action(holdings: dict[str, dict[str, float]], market_id: str) -> str:
    held_qty = sum(max(0.0, qty) for qty in holdings.get(market_id, {}).values())
    if held_qty <= 0:
        return "buy"
    return "sell" if random.random() < 0.5 else "buy"


def choose_buy_option(options: list[dict[str, Any]]) -> dict[str, Any]:
    if not options:
        raise ValueError("no_options")
    return random.choice(options)


def choose_sell_option(holdings: dict[str, dict[str, float]], market_id: str, options: list[dict[str, Any]]) -> dict[str, Any] | None:
    held = holdings.get(market_id, {})
    held_ids = [option_id for option_id, qty in held.items() if qty > 0]
    if not held_ids:
        return None
    rows = [option for option in options if str(option.get("id")) in held_ids]
    if not rows:
        return None
    return random.choice(rows)


def choose_quantity(action: str, held_qty: float = 0.0) -> float:
    if action == "sell" and held_qty > 0:
        upper = max(0.5, min(held_qty, 15.0))
        return round(random.uniform(0.5, upper), 6)
    return round(random.uniform(1.0, 12.0), 6)


def submit_trade(
    base_url: str,
    user_id: str,
    display_name: str,
    market_id: str,
    action: str,
    option_id: str,
    quantity: float,
) -> tuple[int, dict[str, Any]]:
    headers = user_headers(user_id, display_name)
    status, body = api_request(
        base_url,
        "POST",
        f"/api/markets/{market_id}/{action}",
        headers=headers,
        payload={"option_id": option_id, "quantity": quantity},
    )
    return status, body


def delete_market(base_url: str, market_id: str) -> tuple[int, dict[str, Any]]:
    return api_request(base_url, "DELETE", f"/api/admin/markets/{market_id}", headers=admin_headers())


def delete_profile(base_url: str, user_id: str) -> tuple[int, dict[str, Any]]:
    return api_request(base_url, "DELETE", f"/api/admin/profiles/{user_id}", headers=admin_headers())


def main() -> int:
    args = parse_args()
    random.seed(args.seed)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    log_file = output_dir / "events.jsonl"
    summary_file = output_dir / "summary.json"

    # Reset logs for this run.
    if log_file.exists():
        log_file.unlink()
    if summary_file.exists():
        summary_file.unlink()

    synthetic_users = [
        {
            "user_id": f"stress_user_{index:03d}",
            "display_name": f"Stress User {index:03d}",
            "handle": f"stress{index:03d}",
        }
        for index in range(1, args.users + 1)
    ]

    created_markets: list[dict[str, Any]] = []
    stats = {
        "market_created": 0,
        "profile_seeded": 0,
        "trade_attempts": 0,
        "trade_success": 0,
        "trade_rejected": 0,
        "buy_count": 0,
        "sell_count": 0,
        "cleanup_deleted_markets": 0,
        "cleanup_deleted_events": 0,
    }

    start_anchor = now_utc() - timedelta(minutes=1)
    deadline = time.monotonic() + (args.duration_minutes * 60)
    tick_seconds = 60.0 / max(1, args.trades_per_minute)
    cleanup_requested = not args.keep_created_markets

    try:
        for index in range(1, args.markets + 1):
            close_minutes = random.randint(args.min_close_minutes, args.max_close_minutes)
            start = start_anchor
            close = start + timedelta(minutes=close_minutes)
            option_count = random.randint(2, 4)
            market = create_market(
                args.base_url,
                title=f"Live Market {index:02d}",
                start=start,
                close=close,
                option_count=option_count,
            )
            created_markets.append(market)
            stats["market_created"] += 1
            jsonl_write(
                log_file,
                {
                    "type": "MARKET_CREATED",
                    "market_id": market.get("id"),
                    "title": market.get("title"),
                    "start": market.get("start"),
                    "close": market.get("close"),
                    "options": len(market.get("options") or []),
                },
            )

        for user in synthetic_users:
            seed_profile(args.base_url, user["user_id"], user["display_name"], user["handle"])
            stats["profile_seeded"] += 1
            jsonl_write(
                log_file,
                {
                    "type": "USER_SEEDED",
                    "user_id": user["user_id"],
                    "display_name": user["display_name"],
                    "handle": user["handle"],
                    "wallet_balance": 100000.0,
                },
            )

        holdings: dict[str, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(dict))

        while time.monotonic() < deadline:
            open_markets = fetch_open_markets(args.base_url)
            if not open_markets:
                break

            user = random.choice(synthetic_users)
            market = random.choice(open_markets)
            options = [option for option in market.get("options") or [] if isinstance(option, dict)]
            if not options:
                time.sleep(tick_seconds)
                continue

            market_id = str(market.get("id"))
            action = choose_trade_action(holdings[user["user_id"]], market_id)
            held_total = sum(max(0.0, qty) for qty in holdings[user["user_id"]].get(market_id, {}).values())
            if action == "sell":
                sell_option = choose_sell_option(holdings[user["user_id"]], market_id, options)
                if not sell_option:
                    action = "buy"
                    option = choose_buy_option(options)
                    quantity = choose_quantity("buy")
                else:
                    option = sell_option
                    quantity = choose_quantity("sell", held_qty=held_total)
            else:
                option = choose_buy_option(options)
                quantity = choose_quantity("buy")

            stats["trade_attempts"] += 1
            status, body = submit_trade(
                args.base_url,
                user["user_id"],
                user["display_name"],
                market_id,
                action,
                str(option.get("id")),
                quantity,
            )
            success = 200 <= status < 300
            if success:
                stats["trade_success"] += 1
                if action == "buy":
                    stats["buy_count"] += 1
                    holdings[user["user_id"]][market_id][str(option.get("id"))] = round(
                        holdings[user["user_id"]][market_id].get(str(option.get("id")), 0.0) + quantity,
                        6,
                    )
                else:
                    stats["sell_count"] += 1
                    next_qty = round(
                        max(0.0, holdings[user["user_id"]][market_id].get(str(option.get("id")), 0.0) - quantity),
                        6,
                    )
                    if next_qty <= 0:
                        holdings[user["user_id"]][market_id].pop(str(option.get("id")), None)
                    else:
                        holdings[user["user_id"]][market_id][str(option.get("id"))] = next_qty
            else:
                stats["trade_rejected"] += 1

            jsonl_write(
                log_file,
                {
                    "type": "TRADE",
                    "success": success,
                    "status": status,
                    "user_id": user["user_id"],
                    "display_name": user["display_name"],
                    "market_id": market_id,
                    "market_title": market.get("title"),
                    "action": action,
                    "option_id": str(option.get("id")),
                    "option_label": option.get("label"),
                    "quantity": quantity,
                    "quote": option.get("ask_price") if action == "buy" else option.get("bid_price"),
                    "current_price": option.get("current_price"),
                    "wallet_balance": body.get("wallet_balance"),
                    "reserve_balance": body.get("reserve_balance"),
                    "error": body.get("error") if not success else None,
                    "detail": body.get("detail") if not success else None,
                    "timestamp": now_utc().isoformat(),
                },
            )

            time.sleep(tick_seconds)
    finally:
        if cleanup_requested:
            deleted_markets = 0
            deleted_events = 0
            deleted_profiles = 0
            for market in created_markets:
                market_id = str(market.get("id") or "")
                if not market_id:
                    continue
                status, body = delete_market(args.base_url, market_id)
                if 200 <= status < 300:
                    deleted_markets += int(body.get("deleted_markets") or 0)
                    deleted_events += int(body.get("deleted_events") or 0)
                    jsonl_write(
                        log_file,
                        {
                            "type": "MARKET_DELETED",
                            "market_id": market_id,
                            "deleted_markets": body.get("deleted_markets"),
                            "deleted_events": body.get("deleted_events"),
                            "timestamp": now_utc().isoformat(),
                        },
                    )
            for user in synthetic_users:
                status, body = delete_profile(args.base_url, user["user_id"])
                if 200 <= status < 300:
                    deleted_profiles += int(body.get("deleted_profiles") or 0)
                    jsonl_write(
                        log_file,
                        {
                            "type": "PROFILE_DELETED",
                            "user_id": user["user_id"],
                            "display_name": user["display_name"],
                            "deleted_profiles": body.get("deleted_profiles"),
                            "timestamp": now_utc().isoformat(),
                        },
                    )
            stats["cleanup_deleted_markets"] = deleted_markets
            stats["cleanup_deleted_events"] = deleted_events
            stats["cleanup_deleted_profiles"] = deleted_profiles

        summary = {
            **stats,
            "duration_minutes": args.duration_minutes,
            "users": args.users,
            "markets": args.markets,
            "min_close_minutes": args.min_close_minutes,
            "max_close_minutes": args.max_close_minutes,
            "open_markets_remaining": len(fetch_open_markets(args.base_url)),
            "output_dir": str(output_dir),
            "log_file": str(log_file),
            "cleanup_on_exit": cleanup_requested,
            "admin_user_id": admin_user_id(),
        }
        summary_file.write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")
        print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
