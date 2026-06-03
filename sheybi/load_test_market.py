from __future__ import annotations

import argparse
import json
import random
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _json_request(
    *,
    method: str,
    url: str,
    headers: dict[str, str],
    body: dict | None = None,
    timeout: float = 10.0,
) -> tuple[int, dict | None]:
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers = {**headers, "Content-Type": "application/json"}

    req = Request(url, data=data, method=method)
    for k, v in headers.items():
        if v:
            req.add_header(k, v)

    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            if not raw:
                return resp.status, None
            return resp.status, json.loads(raw.decode("utf-8"))
    except HTTPError as e:
        raw = e.read()
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else None
        except Exception:
            payload = {"raw": raw.decode("utf-8", errors="replace")}
        return e.code, payload
    except (URLError, TimeoutError) as e:
        return 0, {"error": "network_error", "detail": str(e)}


@dataclass
class Result:
    ok: int = 0
    fail: int = 0
    elapsed_s: float = 0.0


def trade_worker(
    *,
    base_url: str,
    market_id: str,
    user_id: str,
    user_name: str,
    ops: int,
    buy_amount_min: float,
    buy_amount_max: float,
    sell_probability: float,
    rng_seed: int,
) -> Result:
    rng = random.Random(rng_seed)
    t0 = time.time()
    ok = 0
    fail = 0

    for _ in range(ops):
        side = "YES" if rng.random() < 0.5 else "NO"
        amount = rng.uniform(buy_amount_min, buy_amount_max)

        status, _payload = _json_request(
            method="POST",
            url=f"{base_url}/api/markets/{market_id}/buy",
            headers={"X-Dev-User-Id": user_id, "X-Dev-User-Name": user_name},
            body={"side": side, "amount": amount},
        )
        if status == 200:
            ok += 1
        else:
            fail += 1

        if rng.random() < sell_probability:
            shares = rng.uniform(0.1, 2.0)
            status, _payload = _json_request(
                method="POST",
                url=f"{base_url}/api/markets/{market_id}/sell",
                headers={"X-Dev-User-Id": user_id, "X-Dev-User-Name": user_name},
                body={"side": side, "shares": shares},
            )
            if status == 200:
                ok += 1
            else:
                fail += 1

    return Result(ok=ok, fail=fail, elapsed_s=time.time() - t0)


def main() -> int:
    p = argparse.ArgumentParser(description="Load test a single market with many users (DEV_AUTH mode).")
    p.add_argument("--base-url", default="http://localhost:5000", help="Flask base URL (default: %(default)s)")
    p.add_argument("--users", type=int, default=200, help="Number of simulated users (default: %(default)s)")
    p.add_argument("--ops-per-user", type=int, default=10, help="Buy ops per user (default: %(default)s)")
    p.add_argument("--sell-prob", type=float, default=0.2, help="Probability of a sell after a buy (default: %(default)s)")
    p.add_argument("--threads", type=int, default=50, help="Thread pool size (default: %(default)s)")
    p.add_argument("--buy-min", type=float, default=10.0, help="Min buy amount (default: %(default)s)")
    p.add_argument("--buy-max", type=float, default=200.0, help="Max buy amount (default: %(default)s)")
    p.add_argument(
        "--duration-min",
        type=int,
        default=10,
        help="Market duration in minutes (default: %(default)s)",
    )
    p.add_argument("--title", default="Load test market", help="Market title")
    args = p.parse_args()

    base_url = args.base_url.rstrip("/")

    # Create a market as a dev admin (backend must have ADMIN_USER_IDS=dev_admin).
    start = datetime.now(timezone.utc)
    close = start + timedelta(minutes=max(args.duration_min, 1))
    status, payload = _json_request(
        method="POST",
        url=f"{base_url}/api/markets",
        headers={"X-Dev-User-Id": "dev_admin", "X-Dev-User-Name": "Dev Admin"},
        body={"start": _iso(start), "close": _iso(close), "title": args.title, "rules": "load test"},
    )
    if status != 201 or not payload or "id" not in payload:
        print("Failed to create market:", status, payload)
        return 1

    market_id = str(payload["id"])
    print("Market:", market_id)

    t0 = time.time()
    total_ok = 0
    total_fail = 0
    elapsed_workers = 0.0

    with ThreadPoolExecutor(max_workers=args.threads) as ex:
        futures = []
        for i in range(args.users):
            user_id = f"dev_user_{i}"
            user_name = f"User {i}"
            futures.append(
                ex.submit(
                    trade_worker,
                    base_url=base_url,
                    market_id=market_id,
                    user_id=user_id,
                    user_name=user_name,
                    ops=args.ops_per_user,
                    buy_amount_min=args.buy_min,
                    buy_amount_max=args.buy_max,
                    sell_probability=args.sell_prob,
                    rng_seed=uuid.uuid4().int & 0xFFFFFFFF,
                )
            )

        for fut in as_completed(futures):
            r = fut.result()
            total_ok += r.ok
            total_fail += r.fail
            elapsed_workers += r.elapsed_s

    wall = time.time() - t0
    print(f"Done in {wall:.2f}s | ok={total_ok} fail={total_fail} threads={args.threads}")
    if wall > 0:
        print(f"Throughput: {(total_ok + total_fail)/wall:.1f} req/s (includes buys+sells)")

    # Pull final state.
    status, payload = _json_request(
        method="GET",
        url=f"{base_url}/api/markets/{market_id}",
        headers={"X-Dev-User-Id": "dev_admin", "X-Dev-User-Name": "Dev Admin"},
        body=None,
    )
    print("Final state:", status, payload.get("state") if isinstance(payload, dict) else payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
