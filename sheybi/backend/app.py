from __future__ import annotations

import os
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any

from flask import Flask, jsonify
from flask import request

from market import Market, Side

def create_app() -> Flask:
    app = Flask(__name__)

    markets: dict[str, Market] = {}

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

    @app.get("/health")
    def health():
        return jsonify({"ok": True})

    @app.post("/api/markets")
    def create_market():
        data = request.get_json(silent=True) or {}
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
        markets[market_id] = Market(start=start, close=close)
        return jsonify({"id": market_id, "start": start.isoformat(), "close": close.isoformat()}), 201

    @app.get("/api/markets")
    def list_markets():
        out = []
        for mid, m in markets.items():
            out.append({"id": mid, "start": m.start.isoformat(), "close": m.close.isoformat()})
        return jsonify({"markets": out})

    @app.get("/api/markets/<market_id>")
    def get_market(market_id: str):
        m = markets.get(market_id)
        if not m:
            return jsonify({"error": "not_found"}), 404
        t = now_utc()
        return jsonify(
            {
                "id": market_id,
                "start": m.start.isoformat(),
                "close": m.close.isoformat(),
                "state": m.market_state(t),
            }
        )

    @app.post("/api/markets/<market_id>/buy")
    def buy(market_id: str):
        m = markets.get(market_id)
        if not m:
            return jsonify({"error": "not_found"}), 404
        data = request.get_json(silent=True) or {}
        user = (data.get("user") or "").strip()
        side_raw = (data.get("side") or "").strip().upper()
        amount = data.get("amount")
        t_raw = data.get("t")
        if not user or not side_raw or amount is None:
            return jsonify({"error": "missing_fields", "required": ["user", "side", "amount"]}), 400
        try:
            side = Side.YES if side_raw == "YES" else Side.NO if side_raw == "NO" else None
            if side is None:
                raise ValueError()
            amount_f = float(amount)
        except Exception:
            return jsonify({"error": "invalid_request"}), 400
        if amount_f <= 0:
            return jsonify({"error": "amount_must_be_positive"}), 400
        try:
            t = parse_dt(t_raw) if t_raw else now_utc()
        except Exception:
            return jsonify({"error": "invalid_datetime"}), 400

        try:
            trade = m.buy(user, side, t, amount_f)
        except Exception as e:
            return jsonify({"error": "buy_failed", "detail": str(e)}), 400

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
    def sell(market_id: str):
        m = markets.get(market_id)
        if not m:
            return jsonify({"error": "not_found"}), 404
        data = request.get_json(silent=True) or {}
        user = (data.get("user") or "").strip()
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
            payout = m.sell(user, side, t, shares_f)
        except Exception as e:
            return jsonify({"error": "sell_failed", "detail": str(e)}), 400
        return jsonify({"payout": payout, "state": m.market_state(t)})

    @app.post("/api/markets/<market_id>/resolve")
    def resolve(market_id: str):
        m = markets.get(market_id)
        if not m:
            return jsonify({"error": "not_found"}), 404
        data = request.get_json(silent=True) or {}
        outcome_raw = (data.get("outcome") or "").strip().upper()
        if outcome_raw not in ("YES", "NO"):
            return jsonify({"error": "missing_or_invalid_outcome"}), 400
        outcome = Side.YES if outcome_raw == "YES" else Side.NO
        try:
            payouts = m.resolve(outcome)
        except Exception as e:
            return jsonify({"error": "resolve_failed", "detail": str(e)}), 400
        return jsonify({"outcome": outcome.value, "payouts": payouts})

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=True)
