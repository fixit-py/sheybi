from __future__ import annotations

import os
import math
import sys
import re
import uuid
from threading import Lock
from datetime import datetime, timedelta, timezone
from typing import Any

from dotenv import load_dotenv
from flask import Flask, g, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

load_dotenv()

os.environ.setdefault("DEV_AUTH", "1")
os.environ.setdefault("ADMIN_USER_IDS", "dev_admin")
DEFAULT_RESERVE = float(os.getenv("PLATFORM_RESERVE_NGN", "10000000"))
MAX_VERIFICATION_UPLOAD_BYTES = 5 * 1024 * 1024
TERMS_VERSION = "2026-06-11-v1"

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.admin import is_admin_user
from backend.auth import require_auth
from backend import market as market_engine
from backend.instant_store import admin_query, admin_transact


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app, origins=["http://localhost:3000"])
    platform_state_id = "00000000-0000-0000-0000-000000000001"
    market_locks: dict[str, Lock] = {}
    market_locks_guard = Lock()
    trade_lock = Lock()

    def _market_lock(market_id: str) -> Lock:
        with market_locks_guard:
            lock = market_locks.get(market_id)
            if lock is None:
                lock = Lock()
                market_locks[market_id] = lock
            return lock

    def parse_dt(value: str) -> datetime:
        v = value.strip()
        if v.endswith("Z"):
            v = v[:-1] + "+00:00"
        dt = datetime.fromisoformat(v)
        if dt.tzinfo is None:
            local_tz = datetime.now().astimezone().tzinfo or timezone.utc
            dt = dt.replace(tzinfo=local_tz)
        return dt.astimezone(timezone.utc)

    def now_utc() -> datetime:
        return datetime.now(timezone.utc)

    def now_ms() -> int:
        return int(now_utc().timestamp() * 1000)

    def _as_list(value: Any) -> list[dict[str, Any]]:
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            for key in ("markets", "market_events", "profiles", "users"):
                nested = value.get(key)
                if isinstance(nested, list):
                    return [item for item in nested if isinstance(item, dict)]
        return []

    def _query_markets() -> list[dict[str, Any]]:
        data = admin_query({"markets": {}})
        markets = _as_list(data.get("markets"))
        markets.sort(key=lambda item: item.get("createdAt", 0), reverse=True)
        return markets

    def _market_is_open(row: dict[str, Any]) -> bool:
        if _market_status(row) != "open":
            return False
        return True

    def _query_market(market_id: str) -> dict[str, Any] | None:
        data = admin_query({"markets": {"$": {"where": {"id": market_id}}}})
        markets = _as_list(data.get("markets"))
        return markets[0] if markets else None

    def _query_events(market_id: str) -> list[dict[str, Any]]:
        data = admin_query({"market_events": {"$": {"where": {"marketId": market_id}}}})
        events = _as_list(data.get("market_events"))
        events.sort(key=lambda item: item.get("createdAt", 0))
        return events

    def _query_user_events(user_id: str) -> list[dict[str, Any]]:
        data = admin_query({"market_events": {"$": {"where": {"userId": user_id}}}})
        events = _as_list(data.get("market_events"))
        events.sort(key=lambda item: item.get("createdAt", 0))
        return events

    def _query_all_events() -> list[dict[str, Any]]:
        data = admin_query({"market_events": {}})
        events = _as_list(data.get("market_events"))
        events.sort(key=lambda item: item.get("createdAt", 0), reverse=True)
        return events

    def _query_platform_ledger() -> list[dict[str, Any]]:
        try:
            data = admin_query({"platform_ledger": {}})
            rows = _as_list(data.get("platform_ledger"))
            rows.sort(key=lambda item: item.get("createdAt", 0), reverse=True)
            return rows
        except Exception:
            return []

    def _query_all_profiles() -> list[dict[str, Any]]:
        data = admin_query({"profiles": {}})
        profiles = _as_list(data.get("profiles"))
        profiles.sort(key=lambda item: item.get("updatedAt", item.get("createdAt", 0)), reverse=True)
        return profiles

    def _query_profile(user_id: str) -> dict[str, Any] | None:
        data = admin_query({"profiles": {"$": {"where": {"userId": user_id}}}})
        profiles = _as_list(data.get("profiles"))
        return profiles[0] if profiles else None

    def _serialize_profile(row: dict[str, Any] | None, user_id: str) -> dict[str, Any]:
        if not row:
            return {
                "user_id": user_id,
                "wallet_balance": 100000.0,
                "currency": "NGN",
                "verification_status": "unsubmitted",
                "verification_ready": False,
                "terms_accepted": False,
                "terms_accepted_at": None,
                "terms_version": None,
            }
        verification = _verification_fields(row)
        terms_accepted_at = row.get("terms_accepted_at") or row.get("termsAcceptedAt")
        terms_version = row.get("terms_version") or row.get("termsVersion")
        legal_name = row.get("display_name")
        kyc_ready = bool(
            legal_name
            and verification["verification_status"] == "approved"
            and verification["selfie_image_path"]
            and (
                verification["age_proof_image_path"]
                if verification["id_document_type"] == "no_id"
                else verification["id_document_image_path"]
            )
        )
        return {
            "user_id": row.get("userId") or user_id,
            "display_name": row.get("display_name"),
            "handle": row.get("handle"),
            "bio": row.get("bio"),
            "avatar_url": row.get("avatar_url"),
            "verified": verification["verification_status"] == "approved" or bool(row.get("verified")),
            "verification_status": verification["verification_status"],
            "verification_ready": kyc_ready,
            "id_document_type": verification["id_document_type"],
            "id_document_image_path": verification["id_document_image_path"],
            "age_proof_type": verification["age_proof_type"],
            "age_proof_image_path": verification["age_proof_image_path"],
            "selfie_image_path": verification["selfie_image_path"],
            "birth_certificate_image_path": verification["age_proof_image_path"],
            "terms_accepted": bool(terms_accepted_at),
            "terms_accepted_at": terms_accepted_at,
            "terms_version": terms_version,
            "wallet_balance": float(row.get("walletBalance") or 100000.0),
            "currency": row.get("currency") or "NGN",
            "created_at": row.get("createdAt"),
            "updated_at": row.get("updatedAt"),
        }

    def _clean_text(value: str | None, max_len: int) -> str | None:
        if value is None:
            return None
        v = value.strip()
        if not v:
            return None
        return v[:max_len]

    def _verification_root() -> str:
        root = os.path.join(os.path.dirname(__file__), "uploads", "verification")
        os.makedirs(root, exist_ok=True)
        return root

    def _profile_name_tokens(value: str | None) -> set[str]:
        if not value:
            return set()
        tokens = {
            re.sub(r"[^a-z0-9]", "", part.lower())
            for part in str(value).replace(",", " ").split()
        }
        return {token for token in tokens if token}

    def _name_match_count(a: str | None, b: str | None) -> int:
        return len(_profile_name_tokens(a) & _profile_name_tokens(b))

    def _save_verification_file(user_id: str, kind: str, file_obj: Any) -> str:
        if not file_obj or not getattr(file_obj, "filename", ""):
            raise ValueError(f"missing_{kind}_image")
        size = getattr(file_obj, "content_length", None)
        if size is None:
            stream = getattr(file_obj, "stream", None)
            if stream is not None and hasattr(stream, "tell") and hasattr(stream, "seek"):
                current = stream.tell()
                stream.seek(0, os.SEEK_END)
                size = stream.tell()
                stream.seek(current)
        if size is not None and int(size) > MAX_VERIFICATION_UPLOAD_BYTES:
            raise ValueError("verification_file_too_large")
        filename = secure_filename(file_obj.filename) or f"{kind}.jpg"
        stamp = now_ms()
        stored_name = f"{user_id}_{kind}_{stamp}_{filename}"
        path = os.path.join(_verification_root(), stored_name)
        file_obj.save(path)
        return stored_name

    def _verification_file_url(filename: str | None) -> str | None:
        if not filename:
            return None
        return f"/api/admin/verification/uploads/{filename}"

    def _verification_fields(profile: dict[str, Any] | None) -> dict[str, Any]:
        row = profile or {}
        verification_status = str(
            row.get("verification_status")
            or row.get("verificationStatus")
            or row.get("kyc_status")
            or row.get("kycStatus")
            or ("approved" if row.get("verified") else "unsubmitted")
        ).lower()
        id_document_type = row.get("id_document_type") or row.get("idDocumentType")
        return {
            "verified": verification_status == "approved" or bool(row.get("verified")),
            "verification_status": verification_status,
            "verification_notes": row.get("verification_notes") or row.get("verificationNotes"),
            "id_document_type": id_document_type,
            "id_document_image_path": row.get("id_document_image_path") or row.get("idDocumentImagePath"),
            "age_proof_type": row.get("age_proof_type") or row.get("ageProofType"),
            "age_proof_image_path": row.get("age_proof_image_path") or row.get("ageProofImagePath") or row.get("birth_certificate_image_path") or row.get("birthCertificateImagePath"),
            "birth_certificate_image_path": row.get("birth_certificate_image_path") or row.get("birthCertificateImagePath") or row.get("age_proof_image_path") or row.get("ageProofImagePath"),
            "selfie_image_path": row.get("selfie_image_path") or row.get("selfieImagePath"),
            "verification_submitted_at": row.get("verification_submitted_at") or row.get("verificationSubmittedAt"),
            "verification_reviewed_at": row.get("verification_reviewed_at") or row.get("verificationReviewedAt"),
        }

    def _normalize_options(options: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
        rows = [item for item in (options or []) if isinstance(item, dict)]
        if len(rows) < 2:
            raise ValueError("at_least_two_options_required")
        if len(rows) > 4:
            raise ValueError("at_most_four_options_allowed")
        default_price = round(100.0 / len(rows), 2)
        cleaned: list[dict[str, Any]] = []
        for row in rows:
            label = _clean_text(str(row.get("label") or row.get("name") or row.get("title") or ""), 80)
            if not label:
                raise ValueError("option_label_required")
            raw_price = row.get("price")
            price = float(raw_price) if raw_price is not None and str(raw_price).strip() != "" else default_price
            if price <= 0:
                raise ValueError("option_price_must_be_positive")
            cleaned.append(
                {
                    "id": str(row.get("id") or uuid.uuid4()),
                    "label": label,
                    "basePrice": round(price, 2),
                    "currentPrice": round(price, 2),
                    "volume": 0.0,
                }
            )
        return cleaned

    def _market_status(row: dict[str, Any]) -> str:
        status = str(row.get("status") or "open").lower()
        if status != "open":
            return status
        start_raw = row.get("start")
        if start_raw:
            try:
                if parse_dt(str(start_raw)) > now_utc():
                    return "scheduled"
            except Exception:
                pass
        close_raw = row.get("close")
        if not close_raw:
            return "open"
        try:
            return "closed" if parse_dt(str(close_raw)) <= now_utc() else "open"
        except Exception:
            return "open"

    def _market_options(row: dict[str, Any]) -> list[dict[str, Any]]:
        options = row.get("options")
        if not isinstance(options, list):
            return []
        return [item for item in options if isinstance(item, dict)]

    def _parse_float(value: Any, default: float = 0.0) -> float:
        if value is None:
            return default
        try:
            parsed = float(value)
        except Exception:
            return default
        return parsed if parsed == parsed else default

    def _option_by_id(row: dict[str, Any], option_id: str) -> dict[str, Any]:
        for option in _market_options(row):
            if str(option.get("id")) == option_id:
                return option
        raise KeyError("option not found")

    def _option_by_side(row: dict[str, Any], side_raw: str) -> dict[str, Any]:
        options = _market_options(row)
        if len(options) < 2:
            raise KeyError("option not found")
        side = side_raw.strip().upper()
        if side == "YES":
            return options[0]
        if side == "NO":
            return options[1]
        raise KeyError("option not found")

    def _market_payload(row: dict[str, Any]) -> dict[str, Any]:
        risk_state = _market_risk_state(row)
        return {
            "id": row.get("id"),
            "title": row.get("title"),
            "rules": row.get("rules"),
            "start": row.get("start"),
            "close": row.get("close"),
            "status": _market_status(row),
            "closed_at": row.get("closedAt"),
            "winning_option_id": row.get("winningOptionId"),
            "winning_option_label": row.get("winningOptionLabel"),
            "resolved_at": row.get("resolvedAt"),
            "risk_cap": risk_state["risk_cap"],
            "worst_case_loss": risk_state["worst_case_loss"],
            "cash_collected": risk_state["cash_collected"],
            "risk_pressure": risk_state["risk_pressure"],
            "options": [
                {
                    "id": option.get("id"),
                    "label": option.get("label"),
                    "base_price": _parse_float(option.get("basePrice") or option.get("base_price")),
                    "current_price": _parse_float(
                        option.get("currentPrice")
                        or option.get("current_price")
                        or option.get("askPrice")
                        or option.get("ask_price")
                        or option.get("bidPrice")
                        or option.get("bid_price")
                    ),
                    "bid_price": _parse_float(option.get("bidPrice") or option.get("bid_price")),
                    "ask_price": _parse_float(option.get("askPrice") or option.get("ask_price")),
                    "volume": _parse_float(option.get("volume")),
                    "liability": _parse_float(option.get("liability") or option.get("exposure")),
                    "exposure": _parse_float(option.get("exposure")),
                }
                for option in _market_options(row)
            ],
            "created_at": row.get("createdAt"),
            "updated_at": row.get("updatedAt"),
        }

    def _trade_amount(quantity: float, price: float) -> float:
        return round(max(quantity, 0.0) * max(price, 0.0), 2)

    def _trade_price_from_option(option: dict[str, Any]) -> float:
        return round(
            _parse_float(
                option.get("currentPrice")
                or option.get("current_price")
                or option.get("askPrice")
                or option.get("ask_price")
                or option.get("bidPrice")
                or option.get("bid_price")
                or option.get("basePrice")
                or option.get("base_price")
                or 0.0
            ),
            2,
        )

    def _user_market_positions(user_id: str, market_id: str) -> dict[str, float]:
        positions: dict[str, float] = {}
        for event in _query_user_events(user_id):
            if str(event.get("marketId") or "") != market_id:
                continue
            option_id = str(event.get("optionId") or "")
            if not option_id:
                continue
            quantity = _parse_float(event.get("quantity") or event.get("shares"))
            if quantity <= 0:
                continue
            typ = str(event.get("type") or "").upper()
            positions.setdefault(option_id, 0.0)
            if typ == "BUY":
                positions[option_id] += quantity
            elif typ == "SELL":
                positions[option_id] -= quantity
        return {key: round(value, 6) for key, value in positions.items()}

    def _market_user_ids(market_id: str) -> list[str]:
        user_ids = {
            str(event.get("userId"))
            for event in _query_events(market_id)
            if event.get("userId")
        }
        return sorted(user_ids)

    def _platform_state() -> dict[str, Any]:
        try:
            data = admin_query({"platform_state": {"$": {"where": {"id": platform_state_id}}}})
            rows = _as_list(data.get("platform_state"))
            if rows:
                return rows[0]
        except Exception:
            pass
        return {
            "id": platform_state_id,
            "reserveBalance": float(os.getenv("PLATFORM_RESERVE_NGN", "10000000")),
            "feeBalance": 0.0,
            "createdAt": now_ms(),
            "updatedAt": now_ms(),
        }

    def _platform_reserve() -> float:
        return float(_platform_state().get("reserveBalance") or 0.0)

    def _adjust_platform_reserve(delta: float, fee_delta: float = 0.0, market_id: str | None = None) -> None:
        state = _platform_state()
        reserve = float(state.get("reserveBalance") or 0.0) + float(delta)
        fee_balance = float(state.get("feeBalance") or 0.0) + float(fee_delta)
        if reserve < 0:
            raise ValueError("insufficient_platform_reserve")
        admin_transact(
            [
                [
                    "update",
                    "platform_state",
                    platform_state_id,
                    {
                        "id": platform_state_id,
                        "reserveBalance": round(reserve, 2),
                        "feeBalance": round(fee_balance, 2),
                        "createdAt": state.get("createdAt") or now_ms(),
                        "updatedAt": now_ms(),
                    },
                ]
            ]
        )
        admin_transact(
            [
                [
                    "update",
                    "platform_ledger",
                    str(uuid.uuid4()),
                    {
                        "marketId": market_id,
                        "deltaReserve": round(delta, 2),
                        "deltaFee": round(fee_delta, 2),
                        "reserveBalance": round(reserve, 2),
                        "feeBalance": round(fee_balance, 2),
                        "createdAt": now_ms(),
                        "updatedAt": now_ms(),
                    },
                ]
            ]
        )

    def _clamp(value: float, low: float, high: float) -> float:
        return max(low, min(high, value))

    def _market_spread_rate(row: dict[str, Any]) -> float:
        state = _market_risk_state(row)
        return round(_clamp(0.02 + (float(state.get("risk_pressure") or 0.0) * 0.05), 0.02, 0.10), 4)

    def _market_risk_cap_rate() -> float:
        return 0.05

    def _market_min_fee_rate() -> float:
        return 0.05

    def _market_max_fee_rate() -> float:
        return 0.20

    def _market_buy_fee_rate(row: dict[str, Any]) -> float:
        return 0.005

    def _market_risk_cap() -> float:
        return round(_platform_reserve() * _market_risk_cap_rate(), 2)

    def _market_liquidity_b(row: dict[str, Any]) -> float:
        stored = _parse_float(row.get("liquidityB"), 0.0)
        if stored > 0:
            return stored
        option_count = max(len(_market_options(row)), 2)
        risk_cap = _parse_float(row.get("riskCap") or _market_risk_cap(), 0.0)
        denom = 100.0 * math.log(max(option_count, 2))
        if denom <= 0:
            return 1.0
        return max(1.0, round(risk_cap / denom, 6))

    def _market_shares(row: dict[str, Any]) -> dict[str, float]:
        return {
            option_id: round(max(0.0, liability / 100.0), 6)
            for option_id, liability in _market_option_liabilities(row).items()
        }

    def _market_lmsr_cost_from_shares(row: dict[str, Any], shares: dict[str, float]) -> float:
        options = _market_options(row)
        if not options:
            return 0.0
        b = max(_market_liquidity_b(row), 1e-9)
        option_ids = [str(option.get("id") or "") for option in options]
        values = [max(0.0, _parse_float(shares.get(option_id, 0.0))) for option_id in option_ids]
        max_q = max(values, default=0.0)
        shifted = sum(math.exp((value - max_q) / b) for value in values) or 1.0
        return round(100.0 * b * (math.log(shifted) + (max_q / b) - math.log(len(option_ids))), 6)

    def _market_lmsr_prices_from_shares(row: dict[str, Any], shares: dict[str, float] | None = None) -> dict[str, float]:
        options = _market_options(row)
        if not options:
            return {}
        b = max(_market_liquidity_b(row), 1e-9)
        option_ids = [str(option.get("id") or "") for option in options]
        next_shares = shares or _market_shares(row)
        values = [max(0.0, _parse_float(next_shares.get(option_id, 0.0))) for option_id in option_ids]
        max_q = max(values, default=0.0)
        weights = [math.exp((value - max_q) / b) for value in values]
        total_weight = sum(weights) or 1.0
        return {
            option_id: round(100.0 * (weight / total_weight), 2)
            for option_id, weight in zip(option_ids, weights, strict=False)
        }

    def _market_lmsr_trade_cost(row: dict[str, Any], option_id: str, quantity: float, *, direction: int) -> float:
        shares = _market_shares(row)
        before = _market_lmsr_cost_from_shares(row, shares)
        next_shares = dict(shares)
        next_shares[option_id] = round(max(0.0, _parse_float(next_shares.get(option_id, 0.0)) + (quantity * direction)), 6)
        after = _market_lmsr_cost_from_shares(row, next_shares)
        delta = after - before
        return round(max(0.0, delta if direction > 0 else -delta), 6)

    def _market_open_shares(row: dict[str, Any]) -> dict[str, float]:
        shares: dict[str, float] = {}
        market_id = str(row.get("id") or "")
        for event in _query_events(market_id):
            option_id = str(event.get("optionId") or "")
            if not option_id:
                continue
            typ = str(event.get("type") or "").upper()
            if typ not in {"BUY", "SELL"}:
                continue
            quantity = _parse_float(event.get("quantity") or event.get("shares"))
            if quantity <= 0:
                continue
            shares.setdefault(option_id, 0.0)
            if typ == "BUY":
                shares[option_id] += quantity
            elif typ == "SELL":
                shares[option_id] -= quantity
        return {key: round(max(value, 0.0), 6) for key, value in shares.items()}

    def _market_option_liabilities(row: dict[str, Any]) -> dict[str, float]:
        liabilities: dict[str, float] = {}
        for option in _market_options(row):
            option_id = str(option.get("id") or "")
            if not option_id:
                continue
            liabilities[option_id] = round(_parse_float(option.get("liability") or option.get("exposure")), 2)
        return liabilities

    def _market_cash_collected(row: dict[str, Any]) -> float:
        cached = row.get("cashCollected")
        if cached is not None:
            return round(_parse_float(cached), 2)
        total = 0.0
        market_id = str(row.get("id") or "")
        for event in _query_events(market_id):
            typ = str(event.get("type") or "").upper()
            amount = _parse_float(event.get("amount"))
            if amount <= 0:
                continue
            if typ == "BUY":
                total += amount
            elif typ == "SELL":
                total -= amount
        return round(total, 2)

    def _market_state_from_liabilities(
        row: dict[str, Any],
        liabilities: dict[str, float],
        cash_collected: float,
    ) -> dict[str, Any]:
        options = _market_options(row)
        shares = {option_id: round(max(0.0, value / 100.0), 6) for option_id, value in liabilities.items()}
        total_liability = round(sum(liabilities.values()), 2)
        worst_case_payout = round(max(liabilities.values(), default=0.0), 2)
        risk_cap = round(_parse_float(row.get("riskCap") or _market_risk_cap()), 2)
        worst_case_loss = round(max(0.0, worst_case_payout - cash_collected), 2)
        risk_pressure = 1.0 if risk_cap <= 0 else _clamp(worst_case_loss / risk_cap, 0.0, 1.0)
        prices = _market_lmsr_prices_from_shares(row, shares)
        spread = _market_spread_rate(row)
        updated_options: list[dict[str, Any]] = []
        for option in options:
            oid = str(option.get("id") or "")
            fallback_price = _parse_float(
                option.get("currentPrice")
                or option.get("current_price")
                or option.get("askPrice")
                or option.get("ask_price")
                or option.get("bidPrice")
                or option.get("bid_price")
                or option.get("basePrice")
                or option.get("base_price")
                or 0.0
            )
            mid = round(_clamp(prices.get(oid, fallback_price), 0.01, 99.99), 2)
            bid = round(max(0.01, mid * (1.0 - spread / 2.0)), 2)
            ask = round(max(bid + 0.01, mid * (1.0 + spread / 2.0)), 2)
            liability = round(_parse_float(liabilities.get(oid, 0.0)), 2)
            updated_options.append(
                {
                    **option,
                    "currentPrice": mid,
                    "bidPrice": bid,
                    "askPrice": ask,
                    "liability": liability,
                    "exposure": liability,
                }
            )
        return {
            "options": updated_options,
            "total_liability": total_liability,
            "worst_case_payout": worst_case_payout,
            "cash_collected": round(cash_collected, 2),
            "worst_case_loss": worst_case_loss,
            "risk_cap": risk_cap,
            "risk_pressure": round(risk_pressure, 4),
        }

    def _market_risk_state(row: dict[str, Any]) -> dict[str, Any]:
        liabilities = _market_option_liabilities(row)
        cash_collected = _market_cash_collected(row)
        cached_total_liability = row.get("totalLiability")
        cached_worst_case_payout = row.get("worstCasePayout")
        cached_worst_case_loss = row.get("worstCaseLoss")
        cached_risk_cap = row.get("riskCap")
        cached_risk_pressure = row.get("riskPressure")
        total_liability = round(_parse_float(cached_total_liability), 2) if cached_total_liability is not None else round(sum(liabilities.values()), 2)
        worst_case_payout = round(_parse_float(cached_worst_case_payout), 2) if cached_worst_case_payout is not None else round(max(liabilities.values(), default=0.0), 2)
        worst_case_loss = round(_parse_float(cached_worst_case_loss), 2) if cached_worst_case_loss is not None else round(max(0.0, worst_case_payout - cash_collected), 2)
        risk_cap = round(_parse_float(cached_risk_cap), 2) if cached_risk_cap is not None else _market_risk_cap()
        risk_pressure = round(_parse_float(cached_risk_pressure), 4) if cached_risk_pressure is not None else (1.0 if risk_cap <= 0 else _clamp(worst_case_loss / risk_cap, 0.0, 1.0))
        return {
            "liabilities": liabilities,
            "total_liability": total_liability,
            "worst_case_payout": worst_case_payout,
            "cash_collected": cash_collected,
            "worst_case_loss": worst_case_loss,
            "risk_cap": risk_cap,
            "risk_pressure": risk_pressure,
            "options_count": len(liabilities),
        }

    def _market_reconciliation(row: dict[str, Any]) -> dict[str, Any]:
        market_id = str(row.get("id") or "")
        start_reserve = round(_parse_float(row.get("startReserveBalance")), 2)
        start_fee_balance = round(_parse_float(row.get("startFeeBalance")), 2)
        start_total_balance = round(start_reserve + start_fee_balance, 2)
        buy_cash_in = 0.0
        buy_fees = 0.0
        sell_cash_out = 0.0
        sell_fees = 0.0
        resolution_fees = 0.0
        winner_payouts = 0.0
        for event in _query_events(market_id):
            typ = str(event.get("type") or "").upper()
            amount = round(_parse_float(event.get("amount")), 2)
            fee = round(_parse_float(event.get("fee")), 2)
            fee_amount = round(_parse_float(event.get("feeAmount") or event.get("resolveFeeAmount")), 2)
            net_amount = round(_parse_float(event.get("netAmount") or amount), 2)
            if typ == "BUY":
                buy_cash_in += amount
                buy_fees += fee
            elif typ == "SELL":
                sell_cash_out += amount
                sell_fees += fee
            elif typ == "PAYOUT":
                winner_payouts += round(_parse_float(event.get("grossAmount") or amount), 2)
                resolution_fees += fee_amount
            elif typ == "RESOLVE":
                continue
        ledger_rows = [
            ledger_row
            for ledger_row in _query_platform_ledger()
            if str(ledger_row.get("marketId") or "") == market_id
        ]
        ledger_delta_reserve = round(sum(_parse_float(ledger_row.get("deltaReserve")) for ledger_row in ledger_rows), 2)
        ledger_delta_fee = round(sum(_parse_float(ledger_row.get("deltaFee")) for ledger_row in ledger_rows), 2)
        end_reserve = round(start_reserve + ledger_delta_reserve, 2)
        end_fee_balance = round(start_fee_balance + ledger_delta_fee, 2)
        end_total_balance = round(end_reserve + end_fee_balance, 2)
        expected_end_total = round(
            start_total_balance + buy_cash_in + buy_fees + sell_fees + resolution_fees - sell_cash_out - winner_payouts,
            2,
        )
        return {
            "market_id": market_id,
            "start_reserve": start_reserve,
            "start_fee_balance": start_fee_balance,
            "start_total_balance": start_total_balance,
            "buy_cash_in": round(buy_cash_in, 2),
            "buy_fees": round(buy_fees, 2),
            "sell_cash_out": round(sell_cash_out, 2),
            "sell_fees": round(sell_fees, 2),
            "resolution_fees": round(resolution_fees, 2),
            "fees_collected": round(buy_fees + sell_fees + resolution_fees, 2),
            "winner_payouts": round(winner_payouts, 2),
            "ledger_delta_reserve": round(ledger_delta_reserve, 2),
            "ledger_delta_fee": round(ledger_delta_fee, 2),
            "end_reserve": end_reserve,
            "end_fee_balance": end_fee_balance,
            "end_total_balance": end_total_balance,
            "expected_end_total": expected_end_total,
            "balance_delta": round(end_total_balance - expected_end_total, 2),
        }

    def _market_fee_rate(row: dict[str, Any], option_id: str | None = None) -> float:
        state = _market_risk_state(row)
        liabilities = state["liabilities"]
        total_liability = max(_parse_float(state["total_liability"]), 0.0)
        options = _market_options(row)
        equal_share = 1.0 / max(len(options), 1)
        option_share = equal_share
        if option_id:
            if total_liability > 0:
                option_share = _clamp(_parse_float(liabilities.get(option_id, 0.0)) / total_liability, 0.0, 1.0)
            else:
                option_share = equal_share
        imbalance = 0.0
        if equal_share > 0:
            imbalance = _clamp(abs(option_share - equal_share) / equal_share, 0.0, 1.0)
        pressure = max(state["risk_pressure"], imbalance)
        fee = _market_min_fee_rate() + ((_market_max_fee_rate() - _market_min_fee_rate()) * pressure)
        return round(_clamp(fee, _market_min_fee_rate(), _market_max_fee_rate()), 4)

    def _market_buy_fee_rate(row: dict[str, Any]) -> float:
        return 0.005

    def _market_quotes(row: dict[str, Any]) -> list[dict[str, Any]]:
        state = _market_state_from_liabilities(row, _market_option_liabilities(row), _market_cash_collected(row))
        return state["options"]

    def _market_reprice_options(
        row: dict[str, Any],
        *,
        liabilities: dict[str, float] | None = None,
        cash_collected: float | None = None,
        volume_deltas: dict[str, float] | None = None,
    ) -> dict[str, Any]:
        if not _market_options(row):
            return row
        next_liabilities = dict(_market_option_liabilities(row))
        if liabilities:
            next_liabilities.update({key: round(_parse_float(value), 2) for key, value in liabilities.items()})
        next_cash_collected = _market_cash_collected(row) if cash_collected is None else round(_parse_float(cash_collected), 2)
        state = _market_state_from_liabilities(row, next_liabilities, next_cash_collected)
        updated_options = state["options"]
        if volume_deltas:
            deltas = {key: round(_parse_float(value), 2) for key, value in volume_deltas.items()}
            for option in updated_options:
                oid = str(option.get("id") or "")
                if oid in deltas:
                    option["volume"] = round(_parse_float(option.get("volume")) + deltas[oid], 2)

        admin_transact(
            [
                [
                    "update",
                    "markets",
                    str(row.get("id")),
                    {
                        "options": updated_options,
                        "cashCollected": state["cash_collected"],
                        "totalLiability": state["total_liability"],
                        "worstCasePayout": state["worst_case_payout"],
                        "worstCaseLoss": state["worst_case_loss"],
                        "riskPressure": state["risk_pressure"],
                        "riskCap": state["risk_cap"],
                        "updatedAt": now_ms(),
                    },
                ]
            ]
        )
        refreshed = _query_market(str(row.get("id")))
        if not refreshed:
            raise RuntimeError("market_update_failed")
        return refreshed

    def _user_market_stakes(
        user_id: str,
        market_id: str,
        user_events: list[dict[str, Any]] | None = None,
    ) -> dict[str, float]:
        stakes: dict[str, float] = {}
        events = user_events if user_events is not None else _query_user_events(user_id)
        for event in events:
            if str(event.get("marketId") or "") != market_id:
                continue
            option_id = str(event.get("optionId") or "")
            if not option_id:
                continue
            amount = _parse_float(event.get("amount"))
            if amount <= 0:
                continue
            typ = str(event.get("type") or "").upper()
            stakes.setdefault(option_id, 0.0)
            if typ == "BUY":
                stakes[option_id] += amount
            elif typ == "SELL":
                stakes[option_id] -= amount
        return {key: round(value, 2) for key, value in stakes.items()}

    def _user_market_profit_summary(
        user_id: str,
        row: dict[str, Any],
        user_events: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        market_id = str(row.get("id") or "")
        positions = _user_market_positions(user_id, market_id)
        stakes = _user_market_stakes(user_id, market_id, user_events)
        open_positions = {option_id: qty for option_id, qty in positions.items() if qty > 0}

        invested = 0.0
        returned = 0.0
        payouts = 0.0
        trades = 0
        events = user_events if user_events is not None else _query_user_events(user_id)
        for event in events:
            if str(event.get("marketId") or "") != market_id:
                continue
            typ = str(event.get("type") or "").upper()
            amount = _parse_float(event.get("amount"))
            net_amount = _parse_float(event.get("netAmount") or event.get("net_amount") or amount)
            if typ == "BUY":
                invested += net_amount
                trades += 1
            elif typ == "SELL":
                returned += net_amount
                trades += 1
            elif typ in ("PAYOUT", "REFUND"):
                payouts += net_amount

        options_by_id = {str(option.get("id")): option for option in _market_options(row)}
        option_rows: list[dict[str, Any]] = []
        total_value = 0.0
        for option_id, shares in open_positions.items():
            option = options_by_id.get(option_id)
            if not option:
                continue
            current_price = _trade_price_from_option(option)
            stake_amount = max(_parse_float(stakes.get(option_id)), 0.0)
            market_value = round(shares * current_price, 2)
            total_value += market_value
            option_rows.append(
                {
                    "option_id": option_id,
                    "label": option.get("label"),
                    "shares": round(shares, 6),
                    "stake": round(stake_amount, 2),
                    "current_price": current_price,
                    "base_price": _parse_float(option.get("basePrice")),
                    "market_value": market_value,
                }
            )

        status = _market_status(row)
        unrealized_pnl = round(returned + total_value - invested, 2)
        realized_pnl = round(returned + payouts - invested, 2)
        return {
            "market_id": market_id,
            "title": row.get("title"),
            "rules": row.get("rules"),
            "start": row.get("start"),
            "close": row.get("close"),
            "status": status,
            "closed_at": row.get("closedAt"),
            "winning_option_id": row.get("winningOptionId"),
            "options": option_rows,
            "invested": round(invested, 2),
            "returned": round(returned, 2),
            "current_value": round(total_value, 2),
            "unrealized_pnl": unrealized_pnl,
            "realized_pnl": realized_pnl,
            "net_pnl": realized_pnl if status == "resolved" else unrealized_pnl,
            "trades": trades,
        }

    def _user_market_summary(
        user_id: str,
        row: dict[str, Any],
        user_events: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any] | None:
        summary = _user_market_profit_summary(user_id, row, user_events)
        if summary.get("status") == "resolved":
            return None
        if (
            summary.get("options")
            or _parse_float(summary.get("invested")) > 0
            or _parse_float(summary.get("returned")) > 0
            or _parse_float(summary.get("realized_pnl")) != 0
            or _parse_float(summary.get("trades")) > 0
        ):
            return summary
        return None

    def _get_option(row: dict[str, Any], option_id: str) -> dict[str, Any]:
        for option in _market_options(row):
            if str(option.get("id")) == option_id:
                return option
        raise KeyError("option not found")

    def _wallet_balance(user_id: str) -> float:
        profile = _query_profile(user_id)
        if not profile:
            return 100000.0
        if profile.get("walletBalance") is None:
            return 100000.0
        return float(profile.get("walletBalance") or 0.0)

    def _adjust_wallet(user_id: str, delta: float) -> dict[str, Any]:
        profile = _query_profile(user_id)
        if not profile:
            profile = {
                "userId": user_id,
                "walletBalance": 100000.0,
                "currency": "NGN",
                "verified": False,
                "createdAt": now_ms(),
                "updatedAt": now_ms(),
            }
        balance = float(profile.get("walletBalance") or 100000.0) + float(delta)
        if balance < 0:
            raise ValueError("insufficient_wallet_balance")
        payload = {
            "userId": user_id,
            "display_name": profile.get("display_name"),
            "handle": profile.get("handle"),
            "bio": profile.get("bio"),
            "avatar_url": profile.get("avatar_url"),
            **_verification_fields(profile),
            "walletBalance": round(balance, 2),
            "currency": profile.get("currency") or "NGN",
            "createdAt": profile.get("createdAt") or now_ms(),
            "updatedAt": now_ms(),
        }
        admin_transact([["update", "profiles", str(profile.get("id") or uuid.uuid4()), payload]])
        stored = _query_profile(user_id)
        if not stored:
            raise RuntimeError("wallet_update_failed")
        return stored

    def _reprice_market_option(row: dict[str, Any], option_id: str, *, direction: int, quantity: float) -> dict[str, Any]:
        options = _market_options(row)
        updated: list[dict[str, Any]] = []
        for option in options:
            next_option = dict(option)
            if str(option.get("id")) == option_id:
                current = float(option.get("currentPrice") or option.get("basePrice") or 0.0)
                delta = max(1.0, round(quantity * 1.0, 2))
                next_price = max(1.0, current + (delta * direction))
                next_option["currentPrice"] = round(next_price, 2)
                next_option["volume"] = round(float(option.get("volume") or 0.0) + quantity, 2)
            updated.append(next_option)
        admin_transact([["update", "markets", str(row.get("id")), {"options": updated, "updatedAt": now_ms()}]])
        refreshed = _query_market(str(row.get("id")))
        if not refreshed:
            raise RuntimeError("market_update_failed")
        return refreshed

    def _store_market(
        market_id: str,
        *,
        title: str | None,
        rules: str | None,
        start: datetime,
        close: datetime,
        options: list[dict[str, Any]],
    ) -> None:
        platform_state = _platform_state()
        option_count = max(len(options), 2)
        risk_cap = round(_parse_float(platform_state.get("reserveBalance")) * _market_risk_cap_rate(), 2)
        liquidity_b = max(1.0, round(risk_cap / (100.0 * math.log(option_count)), 6))
        admin_transact(
            [
                [
                    "update",
                    "markets",
                    market_id,
                    {
                        "title": _clean_text(title, 200),
                        "rules": _clean_text(rules, 4000),
                        "start": start.isoformat(),
                        "close": close.isoformat(),
                        "status": "open",
                        "options": options,
                        "cashCollected": 0.0,
                        "totalLiability": 0.0,
                        "worstCasePayout": 0.0,
                        "worstCaseLoss": 0.0,
                        "riskPressure": 0.0,
                        "riskCap": risk_cap,
                        "liquidityB": liquidity_b,
                        "startReserveBalance": round(_parse_float(platform_state.get("reserveBalance")), 2),
                        "startFeeBalance": round(_parse_float(platform_state.get("feeBalance")), 2),
                        "createdAt": now_ms(),
                    },
                ]
            ]
        )

    def _store_profile(
        user_id: str,
        *,
        display_name: str | None = None,
        handle: str | None = None,
        bio: str | None = None,
        avatar_url: str | None = None,
        terms_accepted: bool | None = None,
    ) -> dict[str, Any]:
        def clean(value: str | None, max_len: int) -> str | None:
            if value is None:
                return None
            v = value.strip()
            if not v:
                return None
            return v[:max_len]

        existing = _query_profile(user_id)
        existing = existing or {}
        profile = {
            "userId": user_id,
            "display_name": clean(display_name, 200) if display_name is not None else existing.get("display_name"),
            "handle": clean(handle, 50) if handle is not None else existing.get("handle"),
            "bio": clean(bio, 2000) if bio is not None else existing.get("bio"),
            "avatar_url": clean(avatar_url, 500) if avatar_url is not None else existing.get("avatar_url"),
            **_verification_fields(existing),
            "terms_accepted_at": existing.get("terms_accepted_at") or existing.get("termsAcceptedAt"),
            "terms_version": existing.get("terms_version") or existing.get("termsVersion"),
            "walletBalance": float(existing.get("walletBalance") or 100000.0) if existing else 100000.0,
            "currency": existing.get("currency") if existing and existing.get("currency") else "NGN",
            "updatedAt": now_ms(),
        }
        if terms_accepted:
            profile["terms_accepted_at"] = existing.get("terms_accepted_at") or existing.get("termsAcceptedAt") or now_ms()
            profile["terms_version"] = TERMS_VERSION
        profile_id = str(existing.get("id")) if existing and existing.get("id") else str(uuid.uuid4())
        if existing and existing.get("createdAt") is not None:
            profile["createdAt"] = existing.get("createdAt")
        else:
            profile["createdAt"] = now_ms()
        admin_transact([["update", "profiles", profile_id, profile]])
        stored = _query_profile(user_id)
        if stored:
            return _serialize_profile(stored, user_id)
        return _serialize_profile({"id": profile_id, **profile}, user_id)

    def _store_event(
        *,
        market_id: str,
        user_id: str | None,
        display_name: str | None,
        event_type: str,
        side: Side | None = None,
        amount: float | None = None,
        shares: float | None = None,
        outcome: Side | None = None,
        t: datetime,
    ) -> str:
        event_id = str(uuid.uuid4())
        admin_transact(
            [
                [
                    "update",
                    "market_events",
                    event_id,
                    {
                        "marketId": market_id,
                        "userId": user_id,
                        "displayName": display_name.strip() if display_name else None,
                        "type": event_type,
                        "side": side.value if side else None,
                        "amount": float(amount) if amount is not None else None,
                        "shares": float(shares) if shares is not None else None,
                        "outcome": outcome.value if outcome else None,
                        "t": t.isoformat(),
                        "createdAt": now_ms(),
                    },
                ]
            ]
        )
        return event_id

    # Rebind the core market engine to the extracted module.
    _clean_text = market_engine._clean_text
    _normalize_options = market_engine._normalize_options
    _market_status = market_engine._market_status
    _market_options = market_engine._market_options
    _parse_float = market_engine._parse_float
    _option_by_id = market_engine._option_by_id
    _option_by_side = market_engine._option_by_side
    _trade_amount = market_engine._trade_amount
    _market_spread_rate = market_engine._market_spread_rate
    _market_risk_cap_rate = market_engine._market_risk_cap_rate
    _market_min_fee_rate = market_engine._market_min_fee_rate
    _market_max_fee_rate = market_engine._market_max_fee_rate
    _market_buy_fee_rate = market_engine._market_buy_fee_rate
    _market_risk_cap = market_engine._market_risk_cap
    _market_liquidity_b = market_engine._market_liquidity_b
    _market_shares = market_engine._market_shares
    _market_lmsr_cost_from_shares = market_engine._market_lmsr_cost_from_shares
    _market_lmsr_prices_from_shares = market_engine._market_lmsr_prices_from_shares
    _market_lmsr_trade_cost = market_engine._market_lmsr_trade_cost
    _market_open_shares = market_engine._market_open_shares
    _market_option_liabilities = market_engine._market_option_liabilities
    _market_cash_collected = market_engine._market_cash_collected
    _market_state_from_liabilities = market_engine._market_state_from_liabilities
    _market_risk_state = market_engine._market_risk_state
    _market_fee_rate = market_engine._market_fee_rate
    _market_payload = market_engine._market_payload

    @app.get("/health")
    def health():
        return jsonify({"ok": True})

    @app.post("/api/markets")
    @require_auth
    def create_market():
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        data = request.get_json(silent=True) or {}
        title = (data.get("title") or "").strip() or None
        rules = (data.get("rules") or "").strip() or None
        start_raw = data.get("start")
        close_raw = data.get("close")
        options_raw = data.get("options")
        if not start_raw or not close_raw:
            return jsonify({"error": "missing_fields", "required": ["start", "close", "options"]}), 400
        try:
            start = parse_dt(start_raw)
            close = parse_dt(close_raw)
        except Exception:
            return jsonify({"error": "invalid_datetime"}), 400
        if close <= start:
            return jsonify({"error": "close_must_be_after_start"}), 400

        market_id = str(uuid.uuid4())
        try:
            options = _normalize_options(options_raw if isinstance(options_raw, list) else None)
            _store_market(market_id, title=title, rules=rules, start=start, close=close, options=options)
        except Exception as exc:
            return jsonify({"error": "market_create_failed", "detail": str(exc)}), 500

        return (
            jsonify(
                {
                    "id": market_id,
                    "title": title,
                    "rules": rules,
                    "start": start.isoformat(),
                    "close": close.isoformat(),
                    "status": "open",
                    "options": options,
                }
            ),
            201,
        )

    @app.get("/api/markets")
    @require_auth
    def list_markets():
        try:
            rows = [row for row in _query_markets() if _market_is_open(row)]
        except Exception as exc:
            return jsonify({"error": "markets_list_failed", "detail": str(exc)}), 500
        return jsonify(
            {
                "markets": [_market_payload(r) for r in rows]
            }
        )

    @app.get("/api/markets/<market_id>")
    @require_auth
    def get_market(market_id: str):
        try:
            row = _query_market(market_id)
            if not row:
                return jsonify({"error": "not_found"}), 404
        except KeyError:
            return jsonify({"error": "not_found"}), 404
        except Exception as exc:
            return jsonify({"error": "market_load_failed", "detail": str(exc)}), 500

        payload = _market_payload(row)
        try:
            payload["user_position"] = _user_market_profit_summary(g.clerk_user_id, row)
        except Exception:
            payload["user_position"] = None
        return jsonify(payload)

    @app.get("/api/markets/<market_id>/orderbook")
    @require_auth
    def orderbook(market_id: str):
        try:
            _row = _query_market(market_id)
            if not _row:
                return jsonify({"error": "not_found"}), 404
            events = _query_events(market_id)
        except Exception as exc:
            return jsonify({"error": "orderbook_failed", "detail": str(exc)}), 500
        unique_users = len({e.get("userId") for e in events if e.get("userId")})
        return jsonify(
            {
                "market_id": market_id,
                "unique_users": unique_users,
                "events": [
                    {
                        "id": event.get("id"),
                        "market_id": event.get("marketId"),
                        "user_id": event.get("userId"),
                        "display_name": event.get("displayName"),
                        "type": event.get("type"),
                        "option_id": event.get("optionId"),
                        "option_label": event.get("optionLabel"),
                        "amount": event.get("amount"),
                        "shares": event.get("shares"),
                        "price": event.get("price"),
                        "quantity": event.get("quantity"),
                        "outcome": event.get("outcome"),
                        "t": event.get("t"),
                        "created_at": event.get("createdAt"),
                    }
                    for event in events
                ],
            }
        )

    @app.get("/api/me")
    @require_auth
    def me():
        user_id = g.clerk_user_id
        try:
            profile = _query_profile(user_id)
        except Exception as exc:
            return jsonify({"error": "profile_load_failed", "detail": str(exc)}), 500
        return jsonify(_serialize_profile(profile, user_id))

    @app.put("/api/me/profile")
    @require_auth
    def update_profile():
        user_id = g.clerk_user_id
        data = request.get_json(silent=True) or {}
        try:
            profile = _store_profile(
                user_id,
                display_name=data.get("display_name"),
                handle=data.get("handle"),
                bio=data.get("bio"),
                avatar_url=data.get("avatar_url"),
                terms_accepted=bool(data.get("terms_accepted") or data.get("termsAccepted")),
            )
        except Exception as exc:
            return jsonify({"error": "profile_save_failed", "detail": str(exc)}), 500
        return jsonify(profile)

    @app.get("/api/me/verification")
    @require_auth
    def me_verification():
        user_id = g.clerk_user_id
        try:
            profile = _query_profile(user_id)
        except Exception as exc:
            return jsonify({"error": "verification_load_failed", "detail": str(exc)}), 500
        serialized = _serialize_profile(profile, user_id)
        return jsonify(
            {
                **serialized,
                "verification_status": serialized.get("verification_status"),
                "verification_ready": serialized.get("verification_ready"),
                "document_url": _verification_file_url(serialized.get("id_document_image_path")),
                "age_proof_url": _verification_file_url(serialized.get("age_proof_image_path")),
                "selfie_url": _verification_file_url(serialized.get("selfie_image_path")),
            }
        )

    @app.post("/api/me/verification")
    @require_auth
    def submit_verification():
        user_id = g.clerk_user_id
        try:
            profile = _query_profile(user_id) or {"userId": user_id, "walletBalance": 100000.0, "currency": "NGN"}
            display_name = str(profile.get("display_name") or "").strip()
            if not display_name:
                return jsonify({"error": "profile_incomplete"}), 400

            form = request.form or {}
            doc_type = str(form.get("document_type") or form.get("documentType") or "").strip().lower()
            if doc_type not in {"nin_slip", "voters_card", "passport", "no_id"}:
                return jsonify({"error": "invalid_document_type"}), 400

            id_file = request.files.get("document_image") or request.files.get("id_image")
            age_proof_type = str(form.get("age_proof_type") or form.get("ageProofType") or "").strip().lower()
            age_proof_file = request.files.get("age_proof_image") or request.files.get("ageProofImage")
            selfie_file = request.files.get("selfie_image")
            if not selfie_file:
                return jsonify({"error": "missing_files", "required": ["selfie_image"]}), 400
            if doc_type == "no_id":
                if age_proof_type not in {"work_id", "student_card", "university_id", "birth_certificate"}:
                    return jsonify({"error": "invalid_age_proof_type"}), 400
                if not age_proof_file:
                    return jsonify({"error": "missing_files", "required": ["age_proof_image"]}), 400
            elif not id_file:
                return jsonify({"error": "missing_files", "required": ["document_image"]}), 400

            stored_doc = _save_verification_file(user_id, "id", id_file) if id_file else None
            stored_age_proof = _save_verification_file(user_id, "age_proof", age_proof_file) if age_proof_file else None
            stored_selfie = _save_verification_file(user_id, "selfie", selfie_file)
            now_created = now_ms()
            payload = {
                "userId": user_id,
                "display_name": profile.get("display_name"),
                "handle": profile.get("handle"),
                "bio": profile.get("bio"),
                "avatar_url": profile.get("avatar_url"),
                "verified": False,
                "verification_status": "pending_review",
                "verification_notes": None,
                "id_document_type": doc_type,
                "id_document_image_path": stored_doc,
                "age_proof_type": age_proof_type or None,
                "age_proof_image_path": stored_age_proof,
                "selfie_image_path": stored_selfie,
                "birth_certificate_image_path": stored_age_proof,
                "verification_submitted_at": now_created,
                "verification_reviewed_at": None,
                "walletBalance": float(profile.get("walletBalance") or 100000.0),
                "currency": profile.get("currency") or "NGN",
                "createdAt": profile.get("createdAt") or now_created,
                "updatedAt": now_created,
            }
            profile_id = str(profile.get("id") or uuid.uuid4())
            admin_transact([["update", "profiles", profile_id, payload]])
            stored = _query_profile(user_id)
            if not stored:
                return jsonify({"error": "verification_save_failed"}), 500
            return jsonify(_serialize_profile(stored, user_id))
        except Exception as exc:
            return jsonify({"error": "verification_save_failed", "detail": str(exc)}), 500

    @app.get("/api/me/withdrawals")
    @require_auth
    def me_withdrawals():
        user_id = g.clerk_user_id
        try:
            data = admin_query({"withdrawal_requests": {"$": {"where": {"userId": user_id}}}})
            rows = _as_list(data.get("withdrawal_requests"))
            rows.sort(key=lambda item: item.get("createdAt", 0), reverse=True)
        except Exception as exc:
            return jsonify({"error": "withdrawals_load_failed", "detail": str(exc)}), 500
        return jsonify(
            {
                "withdrawals": [
                    {
                        "id": row.get("id"),
                        "amount": _parse_float(row.get("amount")),
                        "status": row.get("status"),
                        "bank_name": row.get("bankName"),
                        "account_name": row.get("accountName"),
                        "account_number": row.get("accountNumber"),
                        "note": row.get("note"),
                        "created_at": row.get("createdAt"),
                        "updated_at": row.get("updatedAt"),
                    }
                    for row in rows
                ]
            }
        )

    @app.post("/api/me/withdrawals")
    @require_auth
    def request_withdrawal():
        user_id = g.clerk_user_id
        data = request.get_json(silent=True) or {}
        try:
            amount = _parse_float(data.get("amount"))
            bank_name = _clean_text(str(data.get("bank_name") or data.get("bankName") or ""), 120)
            account_name = _clean_text(str(data.get("account_name") or data.get("accountName") or ""), 200)
            account_number = _clean_text(str(data.get("account_number") or data.get("accountNumber") or ""), 20)
            if amount <= 0:
                return jsonify({"error": "amount_must_be_positive"}), 400
            if not bank_name or not account_name or not account_number:
                return jsonify({"error": "missing_fields", "required": ["amount", "bank_name", "account_name", "account_number"]}), 400

            with trade_lock:
                profile = _query_profile(user_id)
                if not profile:
                    return jsonify({"error": "profile_not_found"}), 404
                verification_status = str(
                    profile.get("verification_status")
                    or profile.get("verificationStatus")
                    or ("approved" if profile.get("verified") else "unsubmitted")
                ).lower()
                if verification_status != "approved" or not profile.get("verified"):
                    return jsonify({"error": "verification_required"}), 400
                display_name = str(profile.get("display_name") or "").strip()
                if _name_match_count(display_name, account_name) < 2:
                    return jsonify({"error": "account_name_mismatch"}), 400

                wallet_before = _wallet_balance(user_id)
                if wallet_before < amount:
                    return jsonify({"error": "insufficient_wallet_balance"}), 400
                next_wallet_balance = round(wallet_before - amount, 2)
                profile_id = str(profile.get("id") or uuid.uuid4())
                updated_profile = {
                    "userId": user_id,
                    "display_name": profile.get("display_name"),
                    "handle": profile.get("handle"),
                    "bio": profile.get("bio"),
                    "avatar_url": profile.get("avatar_url"),
                    **_verification_fields(profile),
                    "walletBalance": next_wallet_balance,
                    "currency": profile.get("currency") or "NGN",
                    "createdAt": profile.get("createdAt") or now_ms(),
                    "updatedAt": now_ms(),
                }
                request_id = str(uuid.uuid4())
                created_at = now_ms()
                admin_transact(
                    [
                        ["update", "profiles", profile_id, updated_profile],
                        [
                            "update",
                            "withdrawal_requests",
                            request_id,
                            {
                                "userId": user_id,
                                "amount": round(amount, 2),
                                "status": "pending_review",
                                "bankName": bank_name,
                                "accountName": account_name,
                                "accountNumber": account_number,
                                "note": "Withdrawal request submitted",
                                "createdAt": created_at,
                                "updatedAt": created_at,
                            },
                        ],
                    ]
                )
                return jsonify(
                    {
                        "withdrawal": {
                            "id": request_id,
                            "amount": round(amount, 2),
                            "status": "pending_review",
                            "bank_name": bank_name,
                            "account_name": account_name,
                            "account_number": account_number,
                            "created_at": created_at,
                        },
                        "wallet_balance": _wallet_balance(user_id),
                    }
                )
        except Exception as exc:
            return jsonify({"error": "withdrawal_failed", "detail": str(exc)}), 400

    @app.get("/api/me/portfolio")
    @require_auth
    def portfolio():
        user_id = g.clerk_user_id
        t = now_utc()
        try:
            user_events = _query_user_events(user_id)
            market_ids = {
                str(event.get("marketId") or "")
                for event in user_events
                if str(event.get("marketId") or "")
            }
            markets_by_id = {
                str(r.get("id")): r
                for r in _query_markets()
                if str(r.get("id") or "") in market_ids
            }
            out: list[dict[str, Any]] = []
            for row in markets_by_id.values():
                summary = _user_market_summary(user_id, row, user_events)
                if summary:
                    out.append(summary)
        except Exception as exc:
            return jsonify({"error": "portfolio_failed", "detail": str(exc)}), 500

        profile = _serialize_profile(_query_profile(user_id), user_id)
        return jsonify(
            {
                "user_id": user_id,
                "as_of": t.isoformat(),
                "wallet_balance": profile.get("wallet_balance"),
                "currency": profile.get("currency"),
                "markets": out,
            }
        )

    @app.get("/api/me/history")
    @require_auth
    def history():
        user_id = g.clerk_user_id
        t = now_utc()
        try:
            user_events = _query_user_events(user_id)
            markets_by_id = {r.get("id"): r for r in _query_markets()}
            rows: list[dict[str, Any]] = []
            for event in user_events:
                market_id = str(event.get("marketId") or "")
                market = markets_by_id.get(market_id)
                rows.append(
                    {
                        "id": event.get("id"),
                        "market_id": market_id or None,
                        "market_title": market.get("title") if market else None,
                        "option_id": event.get("optionId"),
                        "option_label": event.get("optionLabel"),
                        "type": event.get("type"),
                        "side": event.get("side"),
                        "amount": event.get("amount"),
                        "shares": event.get("shares"),
                        "quantity": event.get("quantity"),
                        "price": event.get("price"),
                        "outcome": event.get("outcome"),
                        "t": event.get("t"),
                        "created_at": event.get("createdAt"),
                        "display_name": event.get("displayName"),
                    }
                )
        except Exception as exc:
            return jsonify({"error": "history_failed", "detail": str(exc)}), 500

        return jsonify({"user_id": user_id, "as_of": t.isoformat(), "transactions": rows})

    @app.post("/api/markets/<market_id>/buy")
    @require_auth
    def buy(market_id: str):
        data = request.get_json(silent=True) or {}
        user = g.clerk_user_id
        display_name = request.headers.get("X-User-Name")
        option_id = (data.get("option_id") or data.get("optionId") or "").strip()
        side_raw = (data.get("side") or "").strip().upper()
        quantity = data.get("quantity")
        t_raw = data.get("t")
        if not user or not (option_id or side_raw) or quantity is None:
            return jsonify({"error": "missing_fields", "required": ["user", "option_id", "quantity"]}), 400
        try:
            quantity_f = float(quantity)
        except Exception:
            return jsonify({"error": "invalid_request"}), 400
        if quantity_f <= 0:
            return jsonify({"error": "quantity_must_be_positive"}), 400
        try:
            t = parse_dt(t_raw) if t_raw else now_utc()
        except Exception:
            return jsonify({"error": "invalid_datetime"}), 400

        try:
            with trade_lock:
                row = _query_market(market_id)
                if not row:
                    return jsonify({"error": "not_found"}), 404
                if not _market_is_open(row):
                    return jsonify({"error": "market_closed"}), 400
                option = _option_by_id(row, option_id) if option_id else _option_by_side(row, side_raw)
                option_id = str(option.get("id"))
                state = _market_risk_state(row)
                next_liabilities = dict(state["liabilities"])
                next_liabilities[option_id] = round(next_liabilities.get(option_id, 0.0) + (quantity_f * 100.0), 2)
                gross_amount = _market_lmsr_trade_cost(row, option_id, quantity_f, direction=1)
                next_cash_collected = round(state["cash_collected"] + gross_amount, 2)
                next_worst_case_payout = round(max(next_liabilities.values(), default=0.0), 2)
                next_worst_case_loss = round(max(0.0, next_worst_case_payout - next_cash_collected), 2)
                risk_cap = _parse_float(row.get("riskCap")) or _market_risk_cap()
                risk_pressure = 1.0 if risk_cap <= 0 else _clamp(next_worst_case_loss / risk_cap, 0.0, 1.0)
                if risk_pressure >= 0.8:
                    admin_transact(
                        [
                            [
                                "update",
                                "market_events",
                                str(uuid.uuid4()),
                                {
                                    "marketId": market_id,
                                    "userId": user,
                                    "displayName": display_name.strip() if display_name else None,
                                    "type": "HIGH_RISK_PRESSURE",
                                    "optionId": option_id,
                                    "optionLabel": option.get("label"),
                                    "quantity": round(quantity_f, 6),
                                    "shares": round(quantity_f, 6),
                                    "amount": gross_amount,
                                    "riskPressure": round(risk_pressure, 4),
                                    "worstCaseLoss": next_worst_case_loss,
                                    "riskCap": risk_cap,
                                    "t": t.isoformat(),
                                    "createdAt": now_ms(),
                                },
                            ]
                        ]
                    )
                if next_worst_case_loss > risk_cap:
                    reject_payload = {
                        "error": "market_risk_cap_reached",
                        "required": next_worst_case_loss,
                        "available": risk_cap,
                    }
                    admin_transact(
                        [
                            [
                                "update",
                                "market_events",
                                str(uuid.uuid4()),
                                {
                                    "marketId": market_id,
                                    "userId": user,
                                    "displayName": display_name.strip() if display_name else None,
                                    "type": "RISK_REJECT",
                                    "optionId": option_id,
                                    "optionLabel": option.get("label"),
                                    "quantity": round(quantity_f, 6),
                                    "shares": round(quantity_f, 6),
                                    "amount": gross_amount,
                                    "required": next_worst_case_loss,
                                    "available": risk_cap,
                                    "t": t.isoformat(),
                                    "createdAt": now_ms(),
                                },
                            ]
                        ]
                    )
                    return jsonify(reject_payload), 400

                fee_rate = _market_buy_fee_rate(row)
                fee = round(gross_amount * fee_rate, 2)
                total_debit = round(gross_amount + fee, 2)
                profile = _query_profile(user) or {
                    "userId": user,
                    "walletBalance": 100000.0,
                    "currency": "NGN",
                    "verified": False,
                    "createdAt": now_ms(),
                    "updatedAt": now_ms(),
                }
                wallet_before = _parse_float(profile.get("walletBalance")) or 100000.0
                if wallet_before < total_debit:
                    return jsonify({"error": "insufficient_wallet_balance"}), 400
                profile_id = str(profile.get("id") or uuid.uuid4())
                next_wallet_balance = round(wallet_before - total_debit, 2)
                profile_name = profile.get("display_name") or (display_name.strip() if display_name else None)
                updated_profile = {
                    "userId": user,
                    "display_name": profile_name,
                    "handle": profile.get("handle"),
                    "bio": profile.get("bio"),
                    "avatar_url": profile.get("avatar_url"),
                    **_verification_fields(profile),
                    "walletBalance": next_wallet_balance,
                    "currency": profile.get("currency") or "NGN",
                    "createdAt": profile.get("createdAt") or now_ms(),
                    "updatedAt": now_ms(),
                }
                market_state = _market_state_from_liabilities(row, next_liabilities, next_cash_collected)
                updated_options = []
                for option_row in market_state["options"]:
                    next_option = dict(option_row)
                    if str(next_option.get("id") or "") == option_id:
                        next_option["volume"] = round(_parse_float(next_option.get("volume")) + quantity_f, 2)
                    updated_options.append(next_option)
                reserve_before = _parse_float(_platform_state().get("reserveBalance"))
                fee_balance_before = _parse_float(_platform_state().get("feeBalance"))
                updated_platform_state = {
                    "id": platform_state_id,
                    "reserveBalance": round(reserve_before + gross_amount, 2),
                    "feeBalance": round(fee_balance_before + fee, 2),
                    "createdAt": _platform_state().get("createdAt") or now_ms(),
                    "updatedAt": now_ms(),
                }
                now_created = now_ms()
                admin_transact(
                    [
                        ["update", "profiles", profile_id, updated_profile],
                        ["update", "platform_state", platform_state_id, updated_platform_state],
                        [
                            "update",
                            "platform_ledger",
                            str(uuid.uuid4()),
                            {
                                "marketId": market_id,
                                "deltaReserve": round(gross_amount, 2),
                                "deltaFee": round(fee, 2),
                                "reserveBalance": round(reserve_before + gross_amount, 2),
                                "feeBalance": round(fee_balance_before + fee, 2),
                                "createdAt": now_created,
                                "updatedAt": now_created,
                            },
                        ],
                        [
                            "update",
                            "market_events",
                            str(uuid.uuid4()),
                            {
                                "marketId": market_id,
                                "userId": user,
                                "displayName": profile_name,
                                "type": "BUY",
                                "optionId": option_id,
                                "optionLabel": option.get("label"),
                                "quantity": round(quantity_f, 6),
                                "shares": round(quantity_f, 6),
                                "price": round(gross_amount / quantity_f, 6),
                                "amount": gross_amount,
                                "fee": fee,
                                "feeRate": fee_rate,
                                "grossAmount": gross_amount,
                                "netAmount": total_debit,
                                "walletDelta": -total_debit,
                                "t": t.isoformat(),
                                "createdAt": now_created,
                            },
                        ],
                        [
                            "update",
                            "markets",
                            market_id,
                            {
                                "options": updated_options,
                                "cashCollected": market_state["cash_collected"],
                                "totalLiability": market_state["total_liability"],
                                "worstCasePayout": market_state["worst_case_payout"],
                                "worstCaseLoss": market_state["worst_case_loss"],
                                "riskPressure": market_state["risk_pressure"],
                                "riskCap": market_state["risk_cap"],
                                "liquidityB": market_state["liquidity_b"],
                                "updatedAt": now_created,
                            },
                        ],
                    ]
                )
                market_after = _query_market(market_id)
        except Exception as exc:
            return jsonify({"error": "buy_failed", "detail": str(exc)}), 400
        return jsonify(
            {
                "trade": {
                    "market_id": market_id,
                    "option_id": option_id,
                    "option_label": option.get("label"),
                    "quantity": round(quantity_f, 6),
                    "price": round(gross_amount / quantity_f, 6),
                    "amount": gross_amount,
                    "fee": fee,
                    "feeRate": fee_rate,
                    "wallet_delta": -total_debit,
                    "timestamp": t.isoformat(),
                },
                "market": _market_payload(market_after or row),
                "wallet_balance": _wallet_balance(user),
                "reserve_balance": _platform_reserve(),
            }
        )

    @app.post("/api/markets/<market_id>/sell")
    @require_auth
    def sell(market_id: str):
        data = request.get_json(silent=True) or {}
        user = g.clerk_user_id
        display_name = request.headers.get("X-User-Name")
        option_id = (data.get("option_id") or data.get("optionId") or "").strip()
        side_raw = (data.get("side") or "").strip().upper()
        quantity = data.get("quantity")
        t_raw = data.get("t")
        if not user or not (option_id or side_raw) or quantity is None:
            return jsonify({"error": "missing_fields", "required": ["user", "option_id", "quantity"]}), 400
        try:
            quantity_f = float(quantity)
        except Exception:
            return jsonify({"error": "invalid_request"}), 400
        if quantity_f <= 0:
            return jsonify({"error": "quantity_must_be_positive"}), 400
        try:
            t = parse_dt(t_raw) if t_raw else now_utc()
        except Exception:
            return jsonify({"error": "invalid_datetime"}), 400

        try:
            with trade_lock:
                row = _query_market(market_id)
                if not row:
                    return jsonify({"error": "not_found"}), 404
                if not _market_is_open(row):
                    return jsonify({"error": "market_closed"}), 400
                option = _option_by_id(row, option_id) if option_id else _option_by_side(row, side_raw)
                option_id = str(option.get("id"))
                positions = _user_market_positions(user, market_id)
                if _parse_float(positions.get(option_id)) < quantity_f:
                    return jsonify({"error": "insufficient_position"}), 400
                gross_amount = _market_lmsr_trade_cost(row, option_id, quantity_f, direction=-1)
                fee_rate = _market_fee_rate(row, option_id)
                fee = round(gross_amount * fee_rate, 2)
                total_credit = round(gross_amount - fee, 2)
                profile = _query_profile(user) or {
                    "userId": user,
                    "walletBalance": 100000.0,
                    "currency": "NGN",
                    "verified": False,
                    "createdAt": now_ms(),
                    "updatedAt": now_ms(),
                }
                profile_id = str(profile.get("id") or uuid.uuid4())
                wallet_before = _parse_float(profile.get("walletBalance")) or 100000.0
                next_wallet_balance = round(wallet_before + total_credit, 2)
                profile_name = profile.get("display_name") or (display_name.strip() if display_name else None)
                updated_profile = {
                    "userId": user,
                    "display_name": profile_name,
                    "handle": profile.get("handle"),
                    "bio": profile.get("bio"),
                    "avatar_url": profile.get("avatar_url"),
                    **_verification_fields(profile),
                    "walletBalance": next_wallet_balance,
                    "currency": profile.get("currency") or "NGN",
                    "createdAt": profile.get("createdAt") or now_ms(),
                    "updatedAt": now_ms(),
                }
                state = _market_risk_state(row)
                next_liabilities = dict(state["liabilities"])
                next_liabilities[option_id] = round(max(0.0, next_liabilities.get(option_id, 0.0) - (quantity_f * 100.0)), 2)
                next_cash_collected = round(state["cash_collected"] - gross_amount, 2)
                market_state = _market_state_from_liabilities(row, next_liabilities, next_cash_collected)
                updated_options = []
                for option_row in market_state["options"]:
                    next_option = dict(option_row)
                    if str(next_option.get("id") or "") == option_id:
                        next_option["volume"] = round(_parse_float(next_option.get("volume")) + quantity_f, 2)
                    updated_options.append(next_option)
                reserve_before = _parse_float(_platform_state().get("reserveBalance"))
                fee_balance_before = _parse_float(_platform_state().get("feeBalance"))
                now_created = now_ms()
                admin_transact(
                    [
                        ["update", "profiles", profile_id, updated_profile],
                        [
                            "update",
                            "platform_state",
                            platform_state_id,
                            {
                                "id": platform_state_id,
                                "reserveBalance": round(reserve_before - gross_amount, 2),
                                "feeBalance": round(fee_balance_before + fee, 2),
                                "createdAt": _platform_state().get("createdAt") or now_created,
                                "updatedAt": now_created,
                            },
                        ],
                        [
                            "update",
                            "platform_ledger",
                            str(uuid.uuid4()),
                            {
                                "marketId": market_id,
                                "deltaReserve": round(-gross_amount, 2),
                                "deltaFee": round(fee, 2),
                                "reserveBalance": round(reserve_before - gross_amount, 2),
                                "feeBalance": round(fee_balance_before + fee, 2),
                                "createdAt": now_created,
                                "updatedAt": now_created,
                            },
                        ],
                        [
                            "update",
                            "market_events",
                            str(uuid.uuid4()),
                            {
                                "marketId": market_id,
                                "userId": user,
                                "displayName": profile_name,
                                "type": "SELL",
                                "optionId": option_id,
                                "optionLabel": option.get("label"),
                                "quantity": round(quantity_f, 6),
                                "shares": round(quantity_f, 6),
                                "price": round(gross_amount / quantity_f, 6),
                                "amount": gross_amount,
                                "fee": fee,
                                "feeRate": fee_rate,
                                "grossAmount": gross_amount,
                                "netAmount": total_credit,
                                "walletDelta": total_credit,
                                "t": t.isoformat(),
                                "createdAt": now_created,
                            },
                        ],
                        [
                            "update",
                            "markets",
                            market_id,
                            {
                                "options": updated_options,
                                "cashCollected": market_state["cash_collected"],
                                "totalLiability": market_state["total_liability"],
                                "worstCasePayout": market_state["worst_case_payout"],
                                "worstCaseLoss": market_state["worst_case_loss"],
                                "riskPressure": market_state["risk_pressure"],
                                "riskCap": market_state["risk_cap"],
                                "liquidityB": market_state["liquidity_b"],
                                "updatedAt": now_created,
                            },
                        ],
                    ]
                )
                market_after = _query_market(market_id)
        except Exception as exc:
            return jsonify({"error": "sell_failed", "detail": str(exc)}), 400
        return jsonify(
            {
                "payout": total_credit,
                "trade": {
                    "market_id": market_id,
                    "option_id": option_id,
                    "option_label": option.get("label"),
                    "quantity": round(quantity_f, 6),
                    "price": round(gross_amount / quantity_f, 6),
                    "amount": gross_amount,
                    "fee": fee,
                    "wallet_delta": total_credit,
                    "timestamp": t.isoformat(),
                },
                "market": _market_payload(market_after or row),
                "wallet_balance": _wallet_balance(user),
                "reserve_balance": _platform_reserve(),
            }
        )

    @app.post("/api/admin/markets/<market_id>/close")
    @require_auth
    def close_market(market_id: str):
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        try:
            row = _query_market(market_id)
            if not row:
                return jsonify({"error": "not_found"}), 404
            admin_transact(
                [
                    [
                        "update",
                        "markets",
                        market_id,
                        {
                            "status": "closed",
                            "closedAt": now_ms(),
                            "updatedAt": now_ms(),
                        },
                    ]
                ]
            )
            refreshed = _query_market(market_id)
        except Exception as exc:
            return jsonify({"error": "close_failed", "detail": str(exc)}), 400
        return jsonify({"market": _market_payload(refreshed or row)})

    def _delete_markets_by_ids(market_ids: set[str]) -> tuple[int, int]:
        if not market_ids:
            return 0, 0
        markets = [row for row in _query_markets() if str(row.get("id") or "") in market_ids]
        if not markets:
            return 0, 0
        events = [
            event
            for event in _query_all_events()
            if str(event.get("marketId") or "") in market_ids
        ]

        delete_steps: list[list[Any]] = []
        for event in events:
            event_id = str(event.get("id") or "")
            if event_id:
                delete_steps.append(["delete", "market_events", event_id, {}])
        for row in markets:
            market_id = str(row.get("id") or "")
            if market_id:
                delete_steps.append(["delete", "markets", market_id, {}])

        chunk_size = 50
        for index in range(0, len(delete_steps), chunk_size):
            admin_transact(delete_steps[index : index + chunk_size])

        return len(markets), len(events)

    def _delete_profiles_by_user_ids(user_ids: set[str]) -> int:
        if not user_ids:
            return 0
        profiles = [row for row in _query_all_profiles() if str(row.get("userId") or "") in user_ids]
        if not profiles:
            return 0
        delete_steps: list[list[Any]] = []
        for row in profiles:
            profile_id = str(row.get("id") or "")
            if profile_id:
                delete_steps.append(["delete", "profiles", profile_id, {}])
        chunk_size = 50
        for index in range(0, len(delete_steps), chunk_size):
            admin_transact(delete_steps[index : index + chunk_size])
        return len(profiles)

    @app.post("/api/admin/markets/<market_id>/resolve")
    @require_auth
    def resolve_market(market_id: str):
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        data = request.get_json(silent=True) or {}
        winning_option_id = (
            data.get("winning_option_id")
            or data.get("winningOptionId")
            or ""
        ).strip()
        if not winning_option_id:
            return jsonify({"error": "missing_fields", "required": ["winning_option_id"]}), 400
        trade_lock.acquire()
        try:
            row = _query_market(market_id)
            if not row:
                trade_lock.release()
                return jsonify({"error": "not_found"}), 404
            current_status = _market_status(row)
            if current_status == "resolved":
                trade_lock.release()
                return jsonify({"error": "already_resolved"}), 400
            if current_status == "open":
                admin_transact(
                    [
                        [
                            "update",
                            "markets",
                            market_id,
                            {
                                "status": "closed",
                                "closedAt": now_ms(),
                                "updatedAt": now_ms(),
                            },
                        ]
                    ]
                )
                row = _query_market(market_id) or row

            if any(
                str(event.get("type") or "").upper() in {"RESOLVE", "PAYOUT"}
                for event in _query_events(market_id)
            ):
                trade_lock.release()
                return jsonify(
                    {
                        "error": "resolution_in_progress_or_partial",
                        "detail": "This market already has settlement events. Manual review is required before resolving again.",
                    }
                ), 400

            option = _option_by_id(row, winning_option_id)
            payout_price_display = 100.0
            payouts: list[dict[str, Any]] = []
            settlement_fee_rate = _market_fee_rate(row, winning_option_id)
            payout_per_share = round(payout_price_display * (1.0 - settlement_fee_rate), 2)
            total_gross_payout_required = 0.0
            total_net_payout_required = 0.0
            total_resolution_fees = 0.0

            market_events = _query_events(market_id)
            winning_shares_by_user: dict[str, float] = {}
            for event in market_events:
                typ = str(event.get("type") or "").upper()
                if typ not in {"BUY", "SELL"}:
                    continue
                if str(event.get("optionId") or "") != winning_option_id:
                    continue
                user_id = str(event.get("userId") or "")
                if not user_id:
                    continue
                quantity = _parse_float(event.get("quantity") or event.get("shares"))
                if quantity <= 0:
                    continue
                winning_shares_by_user.setdefault(user_id, 0.0)
                if typ == "BUY":
                    winning_shares_by_user[user_id] += quantity
                elif typ == "SELL":
                    winning_shares_by_user[user_id] -= quantity

            payout_plan: list[dict[str, Any]] = []
            for user_id, winning_shares in winning_shares_by_user.items():
                if winning_shares <= 0:
                    continue
                gross_payout = round(winning_shares * payout_price_display, 2)
                payout = round(winning_shares * payout_per_share, 2)
                fee_amount = round(max(0.0, gross_payout - payout), 2)
                if payout <= 0:
                    continue
                total_gross_payout_required += gross_payout
                total_net_payout_required += payout
                total_resolution_fees += fee_amount
                payout_plan.append(
                    {
                        "user_id": user_id,
                        "winning_shares": round(winning_shares, 6),
                        "gross_payout": gross_payout,
                        "fee_amount": fee_amount,
                        "payout": payout,
                    }
                )

            reserve_before = _platform_reserve()
            if reserve_before < total_gross_payout_required:
                trade_lock.release()
                return jsonify({"error": "insufficient_reserve", "required": total_gross_payout_required, "available": reserve_before}), 400

            profiles_by_user = {
                str(profile.get("userId")): profile
                for profile in _query_all_profiles()
                if profile.get("userId")
            }
            platform_state = _platform_state()
            current_reserve = _parse_float(platform_state.get("reserveBalance"))
            current_fee_balance = _parse_float(platform_state.get("feeBalance"))
            start_total_balance = round(
                _parse_float(row.get("startReserveBalance")) + _parse_float(row.get("startFeeBalance")),
                2,
            )
            resolved_at_ms = now_ms()
            resolved_at_iso = now_utc().isoformat()
            projected_reserve = round(current_reserve - total_gross_payout_required, 2)
            projected_fee_balance = round(current_fee_balance + total_resolution_fees, 2)
            projected_total_balance = round(projected_reserve + projected_fee_balance, 2)
            projected_actual_loss = max(0.0, start_total_balance - projected_total_balance)
            stored_risk_cap = _parse_float(row.get("riskCap")) or _market_risk_cap()
            if projected_actual_loss > stored_risk_cap:
                trade_lock.release()
                return jsonify({"error": "resolve_failed", "detail": "actual_platform_loss_exceeded_risk_cap"}), 400

            steps: list[list[Any]] = []
            for item in payout_plan:
                user_id = str(item["user_id"])
                winning_shares = _parse_float(item["winning_shares"])
                gross_payout = round(_parse_float(item["gross_payout"]), 2)
                fee_amount = round(_parse_float(item["fee_amount"]), 2)
                payout = round(_parse_float(item["payout"]), 2)
                profile = profiles_by_user.get(user_id) or {}
                profile_id = str(profile.get("id") or uuid.uuid4())
                wallet_before = _parse_float(profile.get("walletBalance")) or 100000.0
                next_balance = round(wallet_before + payout, 2)
                if next_balance < 0:
                    raise ValueError("insufficient_wallet_balance")
                profile_name = profile.get("display_name")
                updated_profile = {
                    "userId": user_id,
                    "display_name": profile_name,
                    "handle": profile.get("handle"),
                    "bio": profile.get("bio"),
                    "avatar_url": profile.get("avatar_url"),
                    **_verification_fields(profile),
                    "walletBalance": next_balance,
                    "currency": profile.get("currency") or "NGN",
                    "createdAt": profile.get("createdAt") or resolved_at_ms,
                    "updatedAt": resolved_at_ms,
                }
                steps.append(["update", "profiles", profile_id, updated_profile])
                steps.append(
                    [
                        "update",
                        "market_events",
                        str(uuid.uuid4()),
                        {
                            "marketId": market_id,
                            "userId": user_id,
                            "displayName": profile_name,
                            "type": "PAYOUT",
                            "optionId": winning_option_id,
                            "optionLabel": option.get("label"),
                            "quantity": round(winning_shares, 6),
                            "shares": round(winning_shares, 6),
                            "price": payout_per_share,
                            "grossPrice": payout_price_display,
                            "grossAmount": gross_payout,
                            "netAmount": payout,
                            "feeAmount": fee_amount,
                            "feeRate": settlement_fee_rate,
                            "amount": payout,
                            "walletDelta": payout,
                            "t": resolved_at_iso,
                            "createdAt": resolved_at_ms,
                        },
                    ]
                )
                profiles_by_user[user_id] = {**profile, **updated_profile, "id": profile_id}
                payouts.append(
                    {
                        "user_id": user_id,
                        "gross_amount": gross_payout,
                        "fee_amount": fee_amount,
                        "amount": payout,
                        "shares": round(winning_shares, 6),
                    }
                )

            updated_market = dict(row)
            updated_market["status"] = "resolved"
            updated_market["winningOptionId"] = winning_option_id
            updated_market["winningOptionLabel"] = option.get("label")
            updated_market["payoutPerShare"] = payout_per_share
            updated_market["grossPayoutPerShare"] = payout_price_display
            updated_market["resolveFeeRate"] = settlement_fee_rate
            updated_market["resolutionFeeTotal"] = round(total_resolution_fees, 2)
            updated_market["resolvedAt"] = resolved_at_ms
            updated_market["updatedAt"] = resolved_at_ms
            if current_status == "open":
                updated_market["closedAt"] = row.get("closedAt") or resolved_at_ms

            steps.extend(
                [
                    [
                        "update",
                        "platform_state",
                        platform_state_id,
                        {
                            "id": platform_state_id,
                            "reserveBalance": round(projected_reserve, 2),
                            "feeBalance": round(projected_fee_balance, 2),
                            "createdAt": platform_state.get("createdAt") or resolved_at_ms,
                            "updatedAt": resolved_at_ms,
                        },
                    ],
                    [
                        "update",
                        "platform_ledger",
                        str(uuid.uuid4()),
                        {
                            "marketId": market_id,
                            "deltaReserve": round(-total_gross_payout_required, 2),
                            "deltaFee": round(total_resolution_fees, 2),
                            "reserveBalance": round(projected_reserve, 2),
                            "feeBalance": round(projected_fee_balance, 2),
                            "createdAt": resolved_at_ms,
                            "updatedAt": resolved_at_ms,
                        },
                    ],
                    [
                        "update",
                        "markets",
                        market_id,
                        updated_market,
                    ],
                    [
                        "update",
                        "market_events",
                        str(uuid.uuid4()),
                        {
                            "marketId": market_id,
                            "userId": None,
                            "displayName": None,
                            "type": "RESOLVE",
                            "optionId": winning_option_id,
                            "optionLabel": option.get("label"),
                            "price": payout_price_display,
                            "grossPrice": payout_price_display,
                            "netPrice": payout_per_share,
                            "feeRate": settlement_fee_rate,
                            "grossAmount": round(total_gross_payout_required, 2),
                            "netAmount": round(total_net_payout_required, 2),
                            "feeAmount": round(total_resolution_fees, 2),
                            "amount": round(total_net_payout_required, 2),
                            "quantity": 0.0,
                            "t": resolved_at_iso,
                            "createdAt": resolved_at_ms,
                        },
                    ],
                ]
            )
            admin_transact(steps)
            refreshed = _query_market(market_id)
            reconciliation = _market_reconciliation(refreshed or updated_market)
            if float(reconciliation.get("balance_delta") or 0.0) != 0.0:
                raise ValueError(f"resolution_reconciliation_failed:{reconciliation.get('balance_delta')}")
            actual_platform_loss = max(0.0, start_total_balance - _parse_float(reconciliation.get("end_total_balance")))
            stored_risk_cap = _parse_float(row.get("riskCap")) or _market_risk_cap()
            if actual_platform_loss > stored_risk_cap:
                raise ValueError("actual_platform_loss_exceeded_risk_cap")
        except Exception as exc:
            trade_lock.release()
            return jsonify({"error": "resolve_failed", "detail": str(exc)}), 400
        trade_lock.release()
        return jsonify(
            {
                "market": _market_payload(refreshed or row),
                "winning_option_id": winning_option_id,
                "winning_option_label": option.get("label"),
                "payout_per_share": payout_per_share,
                "gross_payout_per_share": payout_price_display,
                "resolve_fee_rate": settlement_fee_rate,
                "resolution_fee_total": round(total_resolution_fees, 2),
                "reserve_balance": _platform_reserve(),
                "payouts": payouts,
                "reconciliation": reconciliation,
            }
        )

    @app.post("/api/admin/markets/purge-open")
    @app.post("/api/admin/markets/purge-all")
    @require_auth
    def purge_all_markets():
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        try:
            market_ids = {str(row.get("id") or "") for row in _query_markets() if row.get("id")}
            deleted_markets, deleted_events = _delete_markets_by_ids(market_ids)
            if not deleted_markets:
                return jsonify({"deleted_markets": 0, "deleted_events": 0, "message": "No markets found."})
            return jsonify(
                {
                    "deleted_markets": deleted_markets,
                    "deleted_events": deleted_events,
                    "message": "All markets purged.",
                }
            )
        except Exception as exc:
            return jsonify({"error": "purge_all_markets_failed", "detail": str(exc)}), 500

    @app.delete("/api/admin/markets/<market_id>")
    @require_auth
    def delete_market(market_id: str):
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        try:
            deleted_markets, deleted_events = _delete_markets_by_ids({market_id})
            if not deleted_markets:
                return jsonify({"deleted_markets": 0, "deleted_events": 0, "message": "Market not found."}), 404
            return jsonify(
                {
                    "deleted_markets": deleted_markets,
                    "deleted_events": deleted_events,
                    "message": "Market deleted.",
                }
            )
        except Exception as exc:
            return jsonify({"error": "delete_market_failed", "detail": str(exc)}), 500

    @app.delete("/api/admin/profiles/<user_id>")
    @require_auth
    def delete_profile(user_id: str):
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        try:
            deleted_profiles = _delete_profiles_by_user_ids({user_id})
            if not deleted_profiles:
                return jsonify({"deleted_profiles": 0, "message": "Profile not found."}), 404
            return jsonify({"deleted_profiles": deleted_profiles, "message": "Profile deleted."})
        except Exception as exc:
            return jsonify({"error": "delete_profile_failed", "detail": str(exc)}), 500

    @app.get("/api/admin/markets")
    @require_auth
    def admin_markets():
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        try:
            rows = _query_markets()
        except Exception as exc:
            return jsonify({"error": "markets_load_failed", "detail": str(exc)}), 500
        return jsonify({"markets": [_market_payload(row) for row in rows]})

    @app.get("/api/admin/users")
    @require_auth
    def admin_users():
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        try:
            profiles = _query_all_profiles()
            events = _query_all_events()
            markets = {str(r.get("id")): r for r in _query_markets()}
            withdrawals = _as_list(admin_query({"withdrawal_requests": {}}).get("withdrawal_requests"))
        except Exception as exc:
            return jsonify({"error": "admin_audit_failed", "detail": str(exc)}), 500

        users: list[dict[str, Any]] = []
        profiles_by_user_id = {str(p.get("userId")): p for p in profiles if p.get("userId")}
        events_by_user_id: dict[str, list[dict[str, Any]]] = {}
        for event in events:
            user_id = event.get("userId")
            if not user_id:
                continue
            events_by_user_id.setdefault(str(user_id), []).append(event)

        withdrawals_by_user_id: dict[str, list[dict[str, Any]]] = {}
        for row in withdrawals:
            user_id = row.get("userId")
            if not user_id:
                continue
            withdrawals_by_user_id.setdefault(str(user_id), []).append(row)

        for user_id, profile in profiles_by_user_id.items():
            user_events = events_by_user_id.get(user_id, [])
            serial = _serialize_profile(profile, user_id)
            user_withdrawals = withdrawals_by_user_id.get(user_id, [])
            users.append(
                {
                    "user_id": user_id,
                    "display_name": serial.get("display_name"),
                    "handle": serial.get("handle"),
                    "bio": serial.get("bio"),
                    "avatar_url": serial.get("avatar_url"),
                    "verified": serial.get("verified"),
                    "verification_status": serial.get("verification_status"),
                    "verification_ready": serial.get("verification_ready"),
                    "id_document_type": serial.get("id_document_type"),
                    "id_document_image_path": serial.get("id_document_image_path"),
                    "id_document_url": _verification_file_url(serial.get("id_document_image_path")),
                    "age_proof_type": serial.get("age_proof_type"),
                    "age_proof_image_path": serial.get("age_proof_image_path"),
                    "age_proof_url": _verification_file_url(serial.get("age_proof_image_path")),
                    "selfie_image_path": serial.get("selfie_image_path"),
                    "selfie_url": _verification_file_url(serial.get("selfie_image_path")),
                    "verification_notes": serial.get("verification_notes"),
                    "verification_submitted_at": serial.get("verification_submitted_at"),
                    "verification_reviewed_at": serial.get("verification_reviewed_at"),
                    "terms_accepted": serial.get("terms_accepted"),
                    "terms_accepted_at": serial.get("terms_accepted_at"),
                    "terms_version": serial.get("terms_version"),
                    "wallet_balance": serial.get("wallet_balance"),
                    "currency": serial.get("currency"),
                    "updated_at": serial.get("updated_at"),
                    "created_at": serial.get("created_at"),
                    "withdrawals": [
                        {
                            "id": row.get("id"),
                            "amount": _parse_float(row.get("amount")),
                            "status": row.get("status"),
                            "bank_name": row.get("bankName"),
                            "account_name": row.get("accountName"),
                            "account_number": row.get("accountNumber"),
                            "note": row.get("note"),
                            "created_at": row.get("createdAt"),
                            "updated_at": row.get("updatedAt"),
                        }
                        for row in user_withdrawals
                    ],
                    "transactions": [
                        {
                            "id": event.get("id"),
                            "market_id": event.get("marketId"),
                            "market_title": markets.get(str(event.get("marketId")), {}).get("title"),
                            "option_id": event.get("optionId"),
                            "option_label": event.get("optionLabel"),
                            "type": event.get("type"),
                            "side": event.get("side"),
                            "amount": event.get("amount"),
                            "shares": event.get("shares"),
                            "quantity": event.get("quantity"),
                            "price": event.get("price"),
                            "outcome": event.get("outcome"),
                            "t": event.get("t"),
                            "created_at": event.get("createdAt"),
                            "display_name": event.get("displayName"),
                        }
                        for event in user_events
                    ],
                }
            )

        users.sort(key=lambda item: item.get("updated_at", item.get("created_at", 0)), reverse=True)
        return jsonify({"users": users, "total_users": len(users), "total_transactions": len(events)})

    @app.get("/api/admin/verification")
    @require_auth
    def admin_verification_queue():
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        try:
            profiles = _query_all_profiles()
        except Exception as exc:
            return jsonify({"error": "admin_verification_failed", "detail": str(exc)}), 500
        queue: list[dict[str, Any]] = []
        for profile in profiles:
            verification_status = str(
                profile.get("verification_status")
                or profile.get("verificationStatus")
                or ("approved" if profile.get("verified") else "unsubmitted")
            ).lower()
            if verification_status not in {"pending_review", "approved", "rejected"}:
                continue
            queue.append(
                {
                    "user_id": profile.get("userId"),
                    "display_name": profile.get("display_name"),
                    "handle": profile.get("handle"),
                    "verification_status": verification_status,
                    "verified": bool(profile.get("verified")),
                    "id_document_type": profile.get("id_document_type") or profile.get("idDocumentType"),
                    "document_url": _verification_file_url(profile.get("id_document_image_path") or profile.get("idDocumentImagePath")),
                    "age_proof_url": _verification_file_url(profile.get("age_proof_image_path") or profile.get("ageProofImagePath") or profile.get("birth_certificate_image_path") or profile.get("birthCertificateImagePath")),
                    "selfie_url": _verification_file_url(profile.get("selfie_image_path") or profile.get("selfieImagePath")),
                    "submitted_at": profile.get("verification_submitted_at") or profile.get("verificationSubmittedAt"),
                    "reviewed_at": profile.get("verification_reviewed_at") or profile.get("verificationReviewedAt"),
                    "notes": profile.get("verification_notes") or profile.get("verificationNotes"),
                }
            )
        queue.sort(key=lambda item: item.get("submitted_at", 0), reverse=True)
        return jsonify({"verifications": queue, "total": len(queue)})

    @app.post("/api/admin/verification/<user_id>/approve")
    @require_auth
    def admin_verification_approve(user_id: str):
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        try:
            profile = _query_profile(user_id)
            if not profile:
                return jsonify({"error": "not_found"}), 404
            payload = {
                "userId": user_id,
                "display_name": profile.get("display_name"),
                "handle": profile.get("handle"),
                "bio": profile.get("bio"),
                "avatar_url": profile.get("avatar_url"),
                **_verification_fields(profile),
                "verified": True,
                "verification_status": "approved",
                "verification_notes": None,
                "verification_reviewed_at": now_ms(),
                "walletBalance": float(profile.get("walletBalance") or 100000.0),
                "currency": profile.get("currency") or "NGN",
                "createdAt": profile.get("createdAt") or now_ms(),
                "updatedAt": now_ms(),
            }
            profile_id = str(profile.get("id") or uuid.uuid4())
            admin_transact([["update", "profiles", profile_id, payload]])
            return jsonify({"ok": True, "user_id": user_id, "verification_status": "approved"})
        except Exception as exc:
            return jsonify({"error": "verification_approve_failed", "detail": str(exc)}), 500

    @app.post("/api/admin/verification/<user_id>/reject")
    @require_auth
    def admin_verification_reject(user_id: str):
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        data = request.get_json(silent=True) or {}
        note = _clean_text(str(data.get("note") or data.get("reason") or ""), 500)
        try:
            profile = _query_profile(user_id)
            if not profile:
                return jsonify({"error": "not_found"}), 404
            payload = {
                "userId": user_id,
                "display_name": profile.get("display_name"),
                "handle": profile.get("handle"),
                "bio": profile.get("bio"),
                "avatar_url": profile.get("avatar_url"),
                **_verification_fields(profile),
                "verified": False,
                "verification_status": "rejected",
                "verification_notes": note,
                "verification_reviewed_at": now_ms(),
                "walletBalance": float(profile.get("walletBalance") or 100000.0),
                "currency": profile.get("currency") or "NGN",
                "createdAt": profile.get("createdAt") or now_ms(),
                "updatedAt": now_ms(),
            }
            profile_id = str(profile.get("id") or uuid.uuid4())
            admin_transact([["update", "profiles", profile_id, payload]])
            return jsonify({"ok": True, "user_id": user_id, "verification_status": "rejected"})
        except Exception as exc:
            return jsonify({"error": "verification_reject_failed", "detail": str(exc)}), 500

    @app.get("/api/admin/verification/uploads/<path:filename>")
    @require_auth
    def admin_verification_upload(filename: str):
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        root = _verification_root()
        if not filename or ".." in filename or filename.startswith("/"):
            return jsonify({"error": "invalid_path"}), 400
        return send_from_directory(root, filename)

    @app.get("/api/admin/withdrawals")
    @require_auth
    def admin_withdrawals():
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        try:
            data = admin_query({"withdrawal_requests": {}})
            rows = _as_list(data.get("withdrawal_requests"))
            rows.sort(key=lambda item: item.get("createdAt", 0), reverse=True)
        except Exception as exc:
            return jsonify({"error": "withdrawals_load_failed", "detail": str(exc)}), 500
        return jsonify(
            {
                "withdrawals": [
                    {
                        "id": row.get("id"),
                        "user_id": row.get("userId"),
                        "amount": _parse_float(row.get("amount")),
                        "status": row.get("status"),
                        "bank_name": row.get("bankName"),
                        "account_name": row.get("accountName"),
                        "account_number": row.get("accountNumber"),
                        "note": row.get("note"),
                        "created_at": row.get("createdAt"),
                        "updated_at": row.get("updatedAt"),
                    }
                    for row in rows
                ]
            }
        )

    @app.post("/api/admin/withdrawals/<withdrawal_id>/approve")
    @require_auth
    def admin_withdrawal_approve(withdrawal_id: str):
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        try:
            data = admin_query({"withdrawal_requests": {"$": {"where": {"id": withdrawal_id}}}})
            rows = _as_list(data.get("withdrawal_requests"))
            row = rows[0] if rows else None
            if not row:
                return jsonify({"error": "not_found"}), 404
            if str(row.get("status") or "").lower() in {"approved", "rejected", "paid"}:
                return jsonify({"error": "already_processed"}), 400
            payload = dict(row)
            payload["status"] = "paid"
            payload["note"] = "Withdrawal approved and finalized"
            payload["updatedAt"] = now_ms()
            admin_transact([["update", "withdrawal_requests", str(row.get("id")), payload]])
            return jsonify({"ok": True, "withdrawal_id": withdrawal_id, "status": "paid"})
        except Exception as exc:
            return jsonify({"error": "withdrawal_approve_failed", "detail": str(exc)}), 500

    @app.post("/api/admin/withdrawals/<withdrawal_id>/reject")
    @require_auth
    def admin_withdrawal_reject(withdrawal_id: str):
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        data = request.get_json(silent=True) or {}
        note = _clean_text(str(data.get("note") or data.get("reason") or "Rejected"), 500) or "Rejected"
        try:
            data_rows = admin_query({"withdrawal_requests": {"$": {"where": {"id": withdrawal_id}}}})
            rows = _as_list(data_rows.get("withdrawal_requests"))
            row = rows[0] if rows else None
            if not row:
                return jsonify({"error": "not_found"}), 404
            if str(row.get("status") or "").lower() in {"approved", "rejected", "paid"}:
                return jsonify({"error": "already_processed"}), 400
            user_id = str(row.get("userId") or "")
            amount = _parse_float(row.get("amount"))
            profile = _query_profile(user_id) or {}
            next_balance = round(_parse_float(profile.get("walletBalance")) + amount, 2)
            profile_payload = {
                "userId": user_id,
                "display_name": profile.get("display_name"),
                "handle": profile.get("handle"),
                "bio": profile.get("bio"),
                "avatar_url": profile.get("avatar_url"),
                **_verification_fields(profile),
                "walletBalance": next_balance,
                "currency": profile.get("currency") or "NGN",
                "createdAt": profile.get("createdAt") or now_ms(),
                "updatedAt": now_ms(),
            }
            payload = dict(row)
            payload["status"] = "rejected"
            payload["note"] = note
            payload["updatedAt"] = now_ms()
            profile_id = str(profile.get("id") or uuid.uuid4())
            admin_transact(
                [
                    ["update", "profiles", profile_id, profile_payload],
                    ["update", "withdrawal_requests", str(row.get("id")), payload],
                ]
            )
            return jsonify({"ok": True, "withdrawal_id": withdrawal_id, "status": "rejected"})
        except Exception as exc:
            return jsonify({"error": "withdrawal_reject_failed", "detail": str(exc)}), 500

    @app.get("/api/admin/dashboard")
    @require_auth
    def admin_dashboard():
        if not is_admin_user(g.clerk_user_id):
            return jsonify({"error": "forbidden"}), 403
        try:
            markets = _query_markets()
            events = _query_all_events()
            profiles = _query_all_profiles()
            platform_state = _platform_state()
            ledger = _query_platform_ledger()
        except Exception as exc:
            return jsonify({"error": "admin_dashboard_failed", "detail": str(exc)}), 500

        now = now_utc()
        day_ago = now - timedelta(days=1)

        def event_dt(event: dict[str, Any]) -> datetime | None:
            raw = event.get("createdAt") or event.get("t")
            if raw is None:
                return None
            try:
                if isinstance(raw, (int, float)):
                    return datetime.fromtimestamp(float(raw) / 1000.0, tz=timezone.utc)
                text = str(raw)
                if text.endswith("Z"):
                    text = text[:-1] + "+00:00"
                dt = datetime.fromisoformat(text)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.astimezone(timezone.utc)
            except Exception:
                return None

        open_markets: list[dict[str, Any]] = []
        resolved_markets: list[dict[str, Any]] = []
        largest_exposure = 0.0
        total_exposure = 0.0
        all_market_rows: list[dict[str, Any]] = []
        for row in markets:
            state = _market_risk_state(row)
            recon = _market_reconciliation(row)
            market_summary = {
                "id": row.get("id"),
                "title": row.get("title"),
                "status": row.get("status") or _market_status(row),
                "start": row.get("start"),
                "close": row.get("close"),
                "risk_cap": round(_parse_float(state.get("risk_cap")), 2),
                "current_exposure": round(_parse_float(state.get("worst_case_loss")), 2),
                "total_exposure": round(_parse_float(state.get("total_liability")), 2),
                "utilization": round(
                    0.0
                    if _parse_float(state.get("risk_cap")) <= 0
                    else _clamp(_parse_float(state.get("worst_case_loss")) / _parse_float(state.get("risk_cap")), 0.0, 1.0),
                    4,
                ),
                "lmsr_b": round(_parse_float(row.get("liquidityB")), 6),
                "spread": _market_spread_rate(row),
                "risk_pressure": round(_parse_float(state.get("risk_pressure")), 4),
                "worst_case_loss": round(_parse_float(state.get("worst_case_loss")), 2),
                "fees_collected": round(_parse_float(recon.get("fees_collected")), 2),
                "buy_volume": round(_parse_float(recon.get("buy_cash_in")), 2),
                "sell_volume": round(_parse_float(recon.get("sell_cash_out")), 2),
                "options": [
                    {
                        "id": option.get("id"),
                        "label": option.get("label"),
                        "current_price": round(_parse_float(option.get("currentPrice") or option.get("current_price")), 2),
                        "base_price": round(_parse_float(option.get("basePrice") or option.get("base_price")), 2),
                    }
                    for option in _market_options(row)
                ],
            }
            all_market_rows.append(market_summary)
            total_exposure += market_summary["current_exposure"]
            largest_exposure = max(largest_exposure, market_summary["current_exposure"])
            if market_summary["status"] == "open":
                open_markets.append(market_summary)
            elif market_summary["status"] == "resolved":
                resolved_markets.append(market_summary)

        recent_events = [event for event in events if (event_dt(event) or now) >= day_ago]
        trade_events = [event for event in recent_events if str(event.get("type") or "").upper() in {"BUY", "SELL"}]
        risk_events = [
            {
                "timestamp": event.get("t") or event.get("createdAt"),
                "user": event.get("displayName") or event.get("userId"),
                "market": event.get("marketId"),
                "type": event.get("type"),
                "option": event.get("optionLabel"),
                "shares": event.get("shares"),
                "cost": event.get("amount"),
                "fee": event.get("fee") or event.get("feeAmount"),
                "worst_case_loss": event.get("worstCaseLoss"),
                "risk_cap": event.get("riskCap"),
                "risk_pressure": event.get("riskPressure"),
            }
            for event in recent_events
            if str(event.get("type") or "").upper() in {"RISK_REJECT", "HIGH_RISK_PRESSURE"}
        ]
        risk_rejections_today = sum(1 for event in risk_events if event.get("type") == "RISK_REJECT")
        active_users_today = len({str(event.get("userId")) for event in trade_events if event.get("userId")})
        total_volume_24h = round(
            sum(_parse_float(event.get("amount")) for event in trade_events),
            2,
        )
        fees_collected = round(_parse_float(platform_state.get("feeBalance")), 2)
        open_count = len(open_markets)
        resolved_count = len(resolved_markets)

        reserve_change_24h = 0.0
        recent_ledger = [entry for entry in ledger if (event_dt(entry) or now) >= day_ago]
        if recent_ledger:
          earliest = recent_ledger[-1]
          reserve_change_24h = round(
              _parse_float(platform_state.get("reserveBalance")) - _parse_float(earliest.get("reserveBalance")),
              2,
          )

        # user risk surface
        profiles_by_user = {str(profile.get("userId")): profile for profile in profiles if profile.get("userId")}
        wallet_moves: dict[str, float] = {}
        trade_counts: dict[str, int] = {}
        volume_by_user: dict[str, float] = {}
        for event in events:
            user_id = str(event.get("userId") or "")
            if not user_id:
                continue
            wallet_delta = _parse_float(event.get("walletDelta"))
            wallet_moves[user_id] = wallet_moves.get(user_id, 0.0) + wallet_delta
            if str(event.get("type") or "").upper() in {"BUY", "SELL", "PAYOUT"}:
                trade_counts[user_id] = trade_counts.get(user_id, 0) + 1
                volume_by_user[user_id] = volume_by_user.get(user_id, 0.0) + _parse_float(event.get("amount") or event.get("grossAmount"))

        user_risk_rows = [
            {
                "user_id": user_id,
                "display_name": profile.get("display_name"),
                "handle": profile.get("handle"),
                "wallet_balance": round(_parse_float(profile.get("walletBalance")), 2),
                "net_pnl": round(wallet_moves.get(user_id, 0.0), 2),
                "volume": round(volume_by_user.get(user_id, 0.0), 2),
                "trade_count": trade_counts.get(user_id, 0),
                "verified": bool(profile.get("verified")),
            }
            for user_id, profile in profiles_by_user.items()
        ]

        def sort_desc(rows: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
            return sorted(rows, key=lambda item: _parse_float(item.get(key)), reverse=True)

        top_winners = sort_desc(user_risk_rows, "net_pnl")[:5]
        top_losers = sorted(user_risk_rows, key=lambda item: _parse_float(item.get("net_pnl")))[:5]
        largest_traders = sort_desc(user_risk_rows, "volume")[:5]
        most_profitable = top_winners
        most_active = sort_desc(user_risk_rows, "trade_count")[:5]

        engine_health = {
            "reconciliation_failures": sum(1 for row in all_market_rows if abs(_parse_float(row.get("worst_case_loss")) - _parse_float(row.get("current_exposure"))) > 0.01 and row.get("status") == "resolved"),
            "balance_delta_errors": sum(1 for row in all_market_rows if abs(_parse_float(row.get("fees_collected")) + _parse_float(row.get("buy_volume")) - _parse_float(row.get("sell_volume"))) < -1),
            "cap_violations": sum(1 for row in all_market_rows if _parse_float(row.get("current_exposure")) > _parse_float(row.get("risk_cap"))),
            "failed_resolutions": sum(1 for row in all_market_rows if row.get("status") == "closed" and not row.get("winning_option_id")),
            "failed_trades": risk_rejections_today,
        }

        market_events_recent = [
            {
                "timestamp": event.get("t") or event.get("createdAt"),
                "user": event.get("displayName") or event.get("userId"),
                "market": event.get("marketId"),
                "type": event.get("type"),
                "option": event.get("optionLabel"),
                "shares": _parse_float(event.get("shares") or event.get("quantity")),
                "cost": _parse_float(event.get("amount") or event.get("grossAmount")),
                "fee": _parse_float(event.get("fee") or event.get("feeAmount") or event.get("resolveFeeAmount")),
            }
            for event in trade_events
        ]
        market_events_recent.sort(key=lambda item: item.get("timestamp") or "", reverse=True)

        resolution_log = [
            {
                "market": row.get("title") or row.get("id"),
                "market_id": row.get("id"),
                "winner": row.get("winning_option_label") or row.get("winningOptionLabel"),
                "winner_payout": _parse_float(row.get("payoutPerShare") or row.get("grossPayoutPerShare")),
                "fees_collected": _parse_float(row.get("resolutionFeeTotal")),
                "platform_pnl": round(_platform_reserve() + _parse_float(_platform_state().get("feeBalance")) - _parse_float(row.get("startReserveBalance")) - _parse_float(row.get("startFeeBalance")), 2),
                "actual_loss": round(max(0.0, (_parse_float(row.get("startReserveBalance")) + _parse_float(row.get("startFeeBalance"))) - (_platform_reserve() + _parse_float(_platform_state().get("feeBalance")))), 2),
                "worst_case_loss": _parse_float(_market_risk_state(row).get("worst_case_loss")),
            }
            for row in markets
            if str(row.get("status") or "").lower() == "resolved"
        ]
        resolution_log.sort(key=lambda item: item.get("market_id") or "", reverse=True)

        return jsonify(
            {
                "summary": {
                    "reserve_balance": round(_parse_float(platform_state.get("reserveBalance")), 2),
                    "fee_balance": round(_parse_float(platform_state.get("feeBalance")), 2),
                    "fees_collected": fees_collected,
                    "open_markets": open_count,
                    "resolved_markets": resolved_count,
                    "total_volume_24h": total_volume_24h,
                    "active_users_today": active_users_today,
                },
                "risk": {
                    "current_reserve": round(_parse_float(platform_state.get("reserveBalance")), 2),
                    "reserve_change_24h": reserve_change_24h,
                    "largest_market_exposure": round(largest_exposure, 2),
                    "total_exposure": round(total_exposure, 2),
                    "risk_rejections_today": risk_rejections_today,
                },
                "markets": all_market_rows,
                "open_markets": open_markets,
                "resolved_markets": resolved_markets,
                "trade_audit": market_events_recent[:200],
                "risk_events": risk_events[:100],
                "resolution_log": resolution_log[:100],
                "user_risk": {
                    "top_winners": top_winners,
                    "top_losers": top_losers,
                    "largest_traders": largest_traders,
                    "most_profitable": most_profitable,
                    "most_active": most_active,
                },
                "engine_health": engine_health,
            }
        )

    return app


if __name__ == "__main__":
    app = create_app()
    debug_enabled = os.getenv("FLASK_DEBUG", "").strip() in ("1", "true", "TRUE", "yes", "YES")
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "5000")),
        debug=debug_enabled,
        use_reloader=debug_enabled,
    )
