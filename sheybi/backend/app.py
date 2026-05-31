from __future__ import annotations
from flask_cors import CORS

import os
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any

from flask import Flask, jsonify
from flask import request, g # g is the global context object

from dotenv import load_dotenv
load_dotenv()

os.environ.setdefault("DEV_AUTH", "1")
os.environ.setdefault("ADMIN_USER_IDS", "dev_admin")


import sys
sys.path.append(
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..")
    )
)
from market import Market, Side

from backend.auth import require_auth # this is the auth middleware
from backend.db import Db, default_db_path
from backend.admin import is_admin_user
import threading

def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app, origins=["http://localhost:3000"])
    db = Db(default_db_path())
    market_cache: dict[str, tuple[Market, int]] = {}
    market_cache_lock = threading.Lock()

    def parse_dt(value: str) -> datetime:
        # Accept ISO8601 with optional Z.
        v = value.strip()
        if v.endswith("Z"):
            v = v[:-1] + "+00:00"
        dt = datetime.fromisoformat(v)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

    def now_utc() -> datetime:
        return datetime.now(timezone.utc)

    def get_market_cached(conn, market_id: str) -> tuple[Market, dict | None]:
        from backend.db import apply_events, iter_events_after, iter_events, get_market_row

        row = get_market_row(conn, market_id)
        if not row:
            raise KeyError()

        with market_cache_lock:
            cached = market_cache.get(market_id)
            if not cached:
                m = Market(start=row.start, close=row.close)
                last_id, _last_t, last_result = apply_events(m, iter_events(conn, market_id))
                market_cache[market_id] = (m, last_id)
                return m, last_result

            m, last_id = cached
            new_last_id, _last_t, last_result = apply_events(
                m, iter_events_after(conn, market_id, last_id)
            )
            if new_last_id:
                market_cache[market_id] = (m, new_last_id)
            return m, last_result

    @app.get("/health")
    #@require_auth // this is the auth middleware
    def health():
        return jsonify({"ok": True})

    @app.post("/api/markets")
    @require_auth # this is the auth middleware
    def create_market():
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        data = request.get_json(silent=True) or {}
        title = (data.get("title") or "").strip() or None
        rules = (data.get("rules") or "").strip() or None
        start_raw = data.get("start")
        close_raw = data.get("close")
        if not start_raw or not close_raw:
            return jsonify({"error": "missing_fields", "required": ["start", "close"]}), 400
        try:
            start = parse_dt(start_raw)
            close = parse_dt(close_raw)
        except Exception:
            return jsonify({"error": "invalid_datetime"}), 400
        if close <= start:
            return jsonify({"error": "close_must_be_after_start"}), 400

        market_id = str(uuid.uuid4())
        with db.conn() as conn:
            conn.execute("BEGIN")
            from backend.db import create_market as db_create_market

            db_create_market(conn, market_id, start, close, title=title, rules=rules)
            conn.commit()
        return (
            jsonify(
                {
                    "id": market_id,
                    "title": title,
                    "rules": rules,
                    "start": start.isoformat(),
                    "close": close.isoformat(),
                }
            ),
            201,
        )

    @app.get("/api/markets")
    @require_auth # this is the auth middleware
    def list_markets():
        with db.conn() as conn:
            from backend.db import list_markets as db_list_markets

            rows = db_list_markets(conn)
        return jsonify(
            {
                "markets": [
                    {
                        "id": r.id,
                        "title": r.title,
                        "rules": r.rules,
                        "start": r.start.isoformat(),
                        "close": r.close.isoformat(),
                    }
                    for r in rows
                ]
            }
        )

    @app.get("/api/markets/<market_id>")
    @require_auth # this is the auth middleware
    def get_market(market_id: str):
        try:
            with db.conn() as conn:
                from backend.db import get_market_row

                row = get_market_row(conn, market_id)
                if not row:
                    raise KeyError()
                m, _last = get_market_cached(conn, market_id)
        except KeyError:
            return jsonify({"error": "not_found"}), 404
        t = now_utc()
        return jsonify( 
            {
                "id": market_id,
                "title": row.title,
                "rules": row.rules,
                "start": m.start.isoformat(),
                "close": m.close.isoformat(),
                "state": m.market_state(t),
            }
        )

    @app.get("/api/markets/<market_id>/orderbook")
    @require_auth
    def orderbook(market_id: str):
        with db.conn() as conn:
            from backend.db import get_market_row, list_orderbook

            row = get_market_row(conn, market_id)
            if not row:
                return jsonify({"error": "not_found"}), 404
            events = list_orderbook(conn, market_id)
        unique_users = len({e["user_id"] for e in events if e.get("user_id")})
        return jsonify({"market_id": market_id, "unique_users": unique_users, "events": events})

    @app.get("/api/me")
    @require_auth
    def me():
        user_id = g.clerk_user_id
        with db.conn() as conn:
            from backend.db import get_user_profile

            profile = get_user_profile(conn, user_id)
        return jsonify(profile or {"user_id": user_id})

    @app.put("/api/me/profile")
    @require_auth
    def update_profile():
        user_id = g.clerk_user_id
        data = request.get_json(silent=True) or {}
        with db.conn() as conn:
            conn.execute("BEGIN")
            from backend.db import update_user_profile

            profile = update_user_profile(
                conn,
                user_id,
                display_name=data.get("display_name"),
                handle=data.get("handle"),
                bio=data.get("bio"),
                avatar_url=data.get("avatar_url"),
            )
            conn.commit()
        return jsonify(profile)

    @app.get("/api/me/portfolio")
    @require_auth
    def portfolio():
        user_id = g.clerk_user_id
        t = now_utc()
        with db.conn() as conn:
            from backend.db import list_user_market_ids, get_market_row

            market_ids = list_user_market_ids(conn, user_id)
            out = []
            for market_id in market_ids:
                row = get_market_row(conn, market_id)
                if not row:
                    continue
                m, _last = get_market_cached(conn, market_id)
                state = m.market_state(t)

                yes_shares = float(m.yes_shares.get(user_id, 0.0))
                no_shares = float(m.no_shares.get(user_id, 0.0))

                yes_value = yes_shares * float(state["probability_yes"])
                no_value = no_shares * float(state["probability_no"])

                out.append(
                    {
                        "market_id": market_id,
                        "title": row.title,
                        "start": row.start.isoformat(),
                        "close": row.close.isoformat(),
                        "resolved": state.get("resolved"),
                        "outcome": state.get("outcome"),
                        "chance_yes": state.get("chance_yes"),
                        "confidence": state.get("confidence"),
                        "positions": {
                            "yes_shares": round(yes_shares, 6),
                            "no_shares": round(no_shares, 6),
                        },
                        "mark_to_market": {
                            "yes_value": round(yes_value, 6),
                            "no_value": round(no_value, 6),
                            "total_value": round(yes_value + no_value, 6),
                        },
                    }
                )

        return jsonify({"user_id": user_id, "as_of": t.isoformat(), "markets": out})

    @app.post("/api/markets/<market_id>/buy")
    @require_auth # this is the auth middleware
    def buy(market_id: str):
        data = request.get_json(silent=True) or {}
        #user = (data.get("user") or "").strip() this was fola's old code
        user = g.clerk_user_id # this is the auth middleware
        display_name = request.headers.get("X-User-Name")
        side_raw = (data.get("side") or "").strip().upper()
        amount = data.get("amount")
        shares = data.get("shares")
        t_raw = data.get("t")
        if not user or not side_raw or (amount is None and shares is None):
            return jsonify({"error": "missing_fields", "required": ["user", "side", "amount_or_shares"]}), 400
        try:
            side = Side.YES if side_raw == "YES" else Side.NO if side_raw == "NO" else None
            if side is None:
                raise ValueError()
            amount_f = float(amount) if amount is not None else None
            shares_f = float(shares) if shares is not None else None
        except Exception:
            return jsonify({"error": "invalid_request"}), 400
        if amount_f is not None and amount_f <= 0:
            return jsonify({"error": "amount_must_be_positive"}), 400
        if shares_f is not None and shares_f <= 0:
            return jsonify({"error": "shares_must_be_positive"}), 400
        try:
            t = parse_dt(t_raw) if t_raw else now_utc()
        except Exception:
            return jsonify({"error": "invalid_datetime"}), 400

        try:
            with db.conn() as conn:
                conn.execute("BEGIN")
                from backend.db import append_buy, upsert_user_display_name

                upsert_user_display_name(conn, user, display_name)
                if shares_f is not None and amount_f is None:
                    # Convert desired shares to gross amount, using current displayed probability and fee.
                    m_before, _last_before = get_market_cached(conn, market_id)
                    p_yes = m_before.displayed_probability(t)
                    price = p_yes if side == Side.YES else (1.0 - p_yes)
                    price = max(min(price, 1.0 - 1e-6), 1e-6)
                    fee_rate = m_before.fee_rate(t, 1.0)
                    denom = max(1.0 - fee_rate, 1e-9)
                    amount_f = (shares_f * price) / denom
                append_buy(conn, market_id=market_id, user_id=user, side=side, amount=float(amount_f), t=t)
                m, last = get_market_cached(conn, market_id)
                trade = (last or {}).get("trade")
                conn.commit()
        except Exception as e:
            return jsonify({"error": "buy_failed", "detail": str(e)}), 400
        if not trade:
            return jsonify({"error": "buy_failed", "detail": "missing_trade"}), 400

        return jsonify(
            {
                "trade": {
                    "user": trade.user,
                    "side": trade.side.value,
                    "amount": trade.amount,
                    "timestamp": trade.timestamp.isoformat(),
                    "reputation": trade.reputation,
                    "confidence": trade.confidence,
                    "weight": trade.weight,
                },
                "state": m.market_state(t),
            }
        )

    @app.post("/api/markets/<market_id>/sell")
    @require_auth # this is the auth middleware
    def sell(market_id: str):
        data = request.get_json(silent=True) or {}
        user = g.clerk_user_id # this is the auth middleware
        display_name = request.headers.get("X-User-Name")
        #user = (data.get("user") or "").strip() this was fola's old code
        side_raw = (data.get("side") or "").strip().upper()
        shares = data.get("shares")
        t_raw = data.get("t")
        if not user or not side_raw or shares is None:
            return jsonify({"error": "missing_fields", "required": ["user", "side", "shares"]}), 400
        try:
            side = Side.YES if side_raw == "YES" else Side.NO if side_raw == "NO" else None
            if side is None:
                raise ValueError()
            shares_f = float(shares)
        except Exception:
            return jsonify({"error": "invalid_request"}), 400
        if shares_f <= 0:
            return jsonify({"error": "shares_must_be_positive"}), 400
        try:
            t = parse_dt(t_raw) if t_raw else now_utc()
        except Exception:
            return jsonify({"error": "invalid_datetime"}), 400

        try:
            with db.conn() as conn:
                conn.execute("BEGIN")
                from backend.db import append_sell, upsert_user_display_name

                upsert_user_display_name(conn, user, display_name)
                append_sell(conn, market_id=market_id, user_id=user, side=side, shares=shares_f, t=t)
                m, last = get_market_cached(conn, market_id)
                payout = (last or {}).get("payout")
                conn.commit()
        except Exception as e:
            return jsonify({"error": "sell_failed", "detail": str(e)}), 400
        if payout is None:
            return jsonify({"error": "sell_failed", "detail": "missing_payout"}), 400
        return jsonify({"payout": payout, "state": m.market_state(t)})

    @app.post("/api/markets/<market_id>/resolve")
    @require_auth # this is the auth middleware
    def resolve(market_id: str):
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        data = request.get_json(silent=True) or {}
        outcome_raw = (data.get("outcome") or "").strip().upper()
        if outcome_raw not in ("YES", "NO"):
            return jsonify({"error": "missing_or_invalid_outcome"}), 400
        outcome = Side.YES if outcome_raw == "YES" else Side.NO
        try:
            with db.conn() as conn:
                conn.execute("BEGIN")
                from backend.db import append_resolve

                m_before, _last_before = get_market_cached(conn, market_id)
                if m_before.resolved:
                    return jsonify({"error": "already_resolved"}), 400

                append_resolve(conn, market_id=market_id, outcome=outcome, t=now_utc())
                m, last = get_market_cached(conn, market_id)
                payouts = (last or {}).get("payouts")
                conn.commit()
        except Exception as e:
            return jsonify({"error": "resolve_failed", "detail": str(e)}), 400
        if payouts is None:
            return jsonify({"error": "resolve_failed", "detail": "missing_payouts"}), 400
        return jsonify({"outcome": outcome.value, "payouts": payouts})

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=True)
