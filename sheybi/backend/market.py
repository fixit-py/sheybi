from __future__ import annotations

import math
import os
from datetime import datetime, timezone
from typing import Any

DEFAULT_RESERVE = float(os.getenv("PLATFORM_RESERVE_NGN", "10000000"))


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def parse_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        parsed = float(value)
    except Exception:
        return default
    return parsed if parsed == parsed else default


def clean_text(value: str | None, max_len: int) -> str | None:
    if value is None:
        return None
    v = value.strip()
    if not v:
        return None
    return v[:max_len]


def normalize_options(options: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    rows = [item for item in (options or []) if isinstance(item, dict)]
    if len(rows) < 2:
        raise ValueError("at_least_two_options_required")
    if len(rows) > 4:
        raise ValueError("at_most_four_options_allowed")
    default_price = round(100.0 / len(rows), 2)
    cleaned: list[dict[str, Any]] = []
    for row in rows:
        label = clean_text(str(row.get("label") or row.get("name") or row.get("title") or ""), 80)
        if not label:
            raise ValueError("option_label_required")
        raw_price = row.get("price")
        price = float(raw_price) if raw_price is not None and str(raw_price).strip() != "" else default_price
        if price <= 0:
            raise ValueError("option_price_must_be_positive")
        cleaned.append(
            {
                "id": str(row.get("id") or os.urandom(8).hex()),
                "label": label,
                "basePrice": round(price, 2),
                "currentPrice": round(price, 2),
                "volume": 0.0,
            }
        )
    return cleaned


def parse_dt(value: str) -> datetime:
    v = value.strip()
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    dt = datetime.fromisoformat(v)
    if dt.tzinfo is None:
        local_tz = datetime.now().astimezone().tzinfo or timezone.utc
        dt = dt.replace(tzinfo=local_tz)
    return dt.astimezone(timezone.utc)


def market_status(row: dict[str, Any], *, now: datetime | None = None) -> str:
    status = str(row.get("status") or "open").lower()
    if status != "open":
        return status
    start_raw = row.get("start")
    if start_raw:
        try:
            current = now or datetime.now(timezone.utc)
            if parse_dt(str(start_raw)) > current:
                return "scheduled"
        except Exception:
            pass
    close_raw = row.get("close")
    if not close_raw:
        return "open"
    try:
        current = now or datetime.now(timezone.utc)
        return "closed" if parse_dt(str(close_raw)) <= current else "open"
    except Exception:
        return "open"


def market_options(row: dict[str, Any]) -> list[dict[str, Any]]:
    options = row.get("options")
    if not isinstance(options, list):
        return []
    return [item for item in options if isinstance(item, dict)]


def option_by_id(row: dict[str, Any], option_id: str) -> dict[str, Any]:
    for option in market_options(row):
        if str(option.get("id")) == option_id:
            return option
    raise KeyError("option not found")


def option_by_side(row: dict[str, Any], side_raw: str) -> dict[str, Any]:
    options = market_options(row)
    if len(options) < 2:
        raise KeyError("option not found")
    side = side_raw.strip().upper()
    if side == "YES":
        return options[0]
    if side == "NO":
        return options[1]
    raise KeyError("option not found")


def trade_amount(quantity: float, price: float) -> float:
    return round(max(quantity, 0.0) * max(price, 0.0), 2)


def option_price(option: dict[str, Any], *keys: str) -> float:
    if keys:
        for key in keys:
            value = parse_float(option.get(key))
            if value > 0:
                return round(value, 2)
    for key in ("currentPrice", "current_price", "askPrice", "ask_price", "bidPrice", "bid_price", "basePrice", "base_price"):
        value = parse_float(option.get(key))
        if value > 0:
            return round(value, 2)
    return 0.0


def market_spread_rate(risk_pressure: float) -> float:
    return round(clamp(0.02 + (risk_pressure * 0.05), 0.02, 0.10), 4)


def market_risk_cap_rate() -> float:
    return 0.05


def market_min_fee_rate() -> float:
    return 0.05


def market_max_fee_rate() -> float:
    return 0.20


def market_buy_fee_rate(risk_pressure: float) -> float:
    return 0.005


def market_risk_cap(reserve_balance: float | None = None) -> float:
    reserve = DEFAULT_RESERVE if reserve_balance is None else float(reserve_balance)
    return round(reserve * market_risk_cap_rate(), 2)


def market_option_inventory(row: dict[str, Any]) -> dict[str, float]:
    inventory: dict[str, float] = {}
    for option in market_options(row):
        option_id = str(option.get("id") or "")
        if not option_id:
            continue
        inventory[option_id] = round(
            parse_float(
                option.get("liability")
                or option.get("exposure")
                or option_price(option)
            ),
            2,
        )
    return inventory


def market_cash_collected(row: dict[str, Any]) -> float:
    return round(parse_float(row.get("cashCollected")), 2)


def market_liquidity_b(row: dict[str, Any]) -> float:
    stored = parse_float(row.get("liquidityB"), 0.0)
    if stored > 0:
        return stored
    option_count = max(len(market_options(row)), 2)
    risk_cap = parse_float(row.get("riskCap") or market_risk_cap(row.get("startReserveBalance")), 0.0)
    denom = 100.0 * math.log(max(option_count, 2))
    if denom <= 0:
        return 1.0
    return max(1.0, round(risk_cap / denom, 6))


def market_outstanding_shares_from_inventory(inventory: dict[str, float]) -> dict[str, float]:
    return {key: round(max(0.0, float(value) / 100.0), 6) for key, value in inventory.items()}


def lmsr_cost_from_shares(row: dict[str, Any], shares: dict[str, float]) -> float:
    options = market_options(row)
    if not options:
        return 0.0
    b = max(market_liquidity_b(row), 1e-9)
    option_ids = [str(option.get("id") or "") for option in options]
    values = [max(0.0, float(shares.get(option_id, 0.0))) for option_id in option_ids]
    max_q = max(values, default=0.0)
    shifted = sum(math.exp((value - max_q) / b) for value in values) or 1.0
    return round(100.0 * b * (math.log(shifted) + (max_q / b) - math.log(len(option_ids))), 6)


def lmsr_prices_from_inventory(row: dict[str, Any], inventory: dict[str, float]) -> dict[str, float]:
    options = market_options(row)
    if not options:
        return {}
    shares = market_outstanding_shares_from_inventory(inventory)
    b = max(market_liquidity_b(row), 1e-9)
    option_ids = [str(option.get("id") or "") for option in options]
    values = [max(0.0, float(shares.get(option_id, 0.0))) for option_id in option_ids]
    max_q = max(values, default=0.0)
    weights = [math.exp((value - max_q) / b) for value in values]
    total_weight = sum(weights) or 1.0
    return {option_id: round(100.0 * (weight / total_weight), 2) for option_id, weight in zip(option_ids, weights, strict=False)}


def lmsr_trade_cost_from_inventory(row: dict[str, Any], inventory: dict[str, float], option_id: str, quantity: float, *, direction: int) -> float:
    shares = market_outstanding_shares_from_inventory(inventory)
    before = lmsr_cost_from_shares(row, shares)
    shares[option_id] = round(max(0.0, float(shares.get(option_id, 0.0)) + (quantity * direction)), 6)
    after = lmsr_cost_from_shares(row, shares)
    delta = after - before
    return round(max(0.0, delta if direction > 0 else -delta), 6)


def market_state_from_inventory(
    row: dict[str, Any],
    inventory: dict[str, float],
    cash_collected: float,
) -> dict[str, Any]:
    options = market_options(row)
    total_inventory = round(sum(inventory.values()), 2)
    worst_case_payout = round(max(inventory.values(), default=0.0), 2)
    risk_cap = round(parse_float(row.get("riskCap") or market_risk_cap(row.get("startReserveBalance"))), 2)
    worst_case_loss = round(max(0.0, worst_case_payout - cash_collected), 2)
    risk_pressure = 1.0 if risk_cap <= 0 else clamp(worst_case_loss / risk_cap, 0.0, 1.0)
    prices = lmsr_prices_from_inventory(row, inventory)
    spread = market_spread_rate(risk_pressure)
    updated_options: list[dict[str, Any]] = []
    for option in options:
        oid = str(option.get("id") or "")
        mid = round(
            clamp(
                prices.get(oid, option_price(option)),
                0.01,
                99.99,
            ),
            2,
        )
        bid = round(max(0.01, mid * (1.0 - spread / 2.0)), 2)
        ask = round(max(bid + 0.01, mid * (1.0 + spread / 2.0)), 2)
        liability = round(parse_float(inventory.get(oid, 0.0)), 2)
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
        "total_liability": total_inventory,
        "worst_case_payout": worst_case_payout,
        "cash_collected": round(cash_collected, 2),
        "worst_case_loss": worst_case_loss,
        "risk_cap": risk_cap,
        "risk_pressure": round(risk_pressure, 4),
        "liquidity_b": market_liquidity_b(row),
    }


def market_risk_state(row: dict[str, Any]) -> dict[str, Any]:
    inventory = market_option_inventory(row)
    cash_collected = market_cash_collected(row)
    cached_total_liability = row.get("totalLiability")
    cached_worst_case_payout = row.get("worstCasePayout")
    cached_worst_case_loss = row.get("worstCaseLoss")
    cached_risk_cap = row.get("riskCap")
    cached_risk_pressure = row.get("riskPressure")
    total_inventory = round(parse_float(cached_total_liability), 2) if cached_total_liability is not None else round(sum(inventory.values()), 2)
    worst_case_payout = round(parse_float(cached_worst_case_payout), 2) if cached_worst_case_payout is not None else round(max(inventory.values(), default=0.0), 2)
    worst_case_loss = round(parse_float(cached_worst_case_loss), 2) if cached_worst_case_loss is not None else round(max(0.0, worst_case_payout - cash_collected), 2)
    risk_cap = round(parse_float(cached_risk_cap), 2) if cached_risk_cap is not None else market_risk_cap(row.get("startReserveBalance"))
    risk_pressure = round(parse_float(cached_risk_pressure), 4) if cached_risk_pressure is not None else (1.0 if risk_cap <= 0 else clamp(worst_case_loss / risk_cap, 0.0, 1.0))
    return {
        "liabilities": inventory,
        "total_liability": total_inventory,
        "worst_case_payout": worst_case_payout,
        "cash_collected": cash_collected,
        "worst_case_loss": worst_case_loss,
        "risk_cap": risk_cap,
        "risk_pressure": risk_pressure,
        "options_count": len(inventory),
        "liquidity_b": market_liquidity_b(row),
    }


def market_fee_rate(row: dict[str, Any], option_id: str | None = None) -> float:
    state = market_risk_state(row)
    inventory = state["liabilities"]
    total_inventory = max(parse_float(state["total_liability"]), 0.0)
    options = market_options(row)
    equal_share = 1.0 / max(len(options), 1)
    option_share = equal_share
    if option_id:
        if total_inventory > 0:
            option_share = clamp(parse_float(inventory.get(option_id, 0.0)) / total_inventory, 0.0, 1.0)
        else:
            option_share = equal_share
    imbalance = 0.0
    if equal_share > 0:
        imbalance = clamp(abs(option_share - equal_share) / equal_share, 0.0, 1.0)
    pressure = max(state["risk_pressure"], imbalance)
    fee = market_min_fee_rate() + ((market_max_fee_rate() - market_min_fee_rate()) * pressure)
    return round(clamp(fee, market_min_fee_rate(), market_max_fee_rate()), 4)


def market_buy_fee_rate_from_state(risk_pressure: float) -> float:
    return market_buy_fee_rate(risk_pressure)


def market_payload(row: dict[str, Any], risk_state: dict[str, Any] | None = None) -> dict[str, Any]:
    risk_state = risk_state or market_risk_state(row)
    return {
        "id": row.get("id"),
        "title": row.get("title"),
        "rules": row.get("rules"),
        "start": row.get("start"),
        "close": row.get("close"),
        "status": market_status(row),
        "closed_at": row.get("closedAt"),
        "winning_option_id": row.get("winningOptionId"),
        "winning_option_label": row.get("winningOptionLabel"),
        "resolved_at": row.get("resolvedAt"),
        "risk_cap": risk_state["risk_cap"],
        "worst_case_loss": risk_state["worst_case_loss"],
        "cash_collected": risk_state["cash_collected"],
        "risk_pressure": risk_state["risk_pressure"],
        "liquidity_b": risk_state.get("liquidity_b"),
        "options": [
            {
                "id": option.get("id"),
                "label": option.get("label"),
                "base_price": parse_float(option.get("basePrice")),
                "current_price": parse_float(option.get("currentPrice")),
                "bid_price": parse_float(option.get("bidPrice")),
                "ask_price": parse_float(option.get("askPrice")),
                "volume": parse_float(option.get("volume")),
                "liability": parse_float(option.get("liability") or option.get("exposure")),
                "exposure": parse_float(option.get("exposure")),
            }
            for option in market_options(row)
        ],
        "created_at": row.get("createdAt"),
        "updated_at": row.get("updatedAt"),
    }


# Compatibility wrappers for the existing Flask app helper names.
_clean_text = clean_text
_normalize_options = normalize_options
_market_status = market_status
_market_options = market_options
_parse_float = parse_float
_option_by_id = option_by_id
_option_by_side = option_by_side
_trade_amount = trade_amount
_market_spread_rate = lambda row: market_spread_rate(market_risk_state(row)["risk_pressure"])
_market_risk_cap_rate = market_risk_cap_rate
_market_min_fee_rate = market_min_fee_rate
_market_max_fee_rate = market_max_fee_rate
_market_buy_fee_rate = lambda row: market_buy_fee_rate(market_risk_state(row)["risk_pressure"])
_market_risk_cap = market_risk_cap
_market_liquidity_b = market_liquidity_b
_market_shares = lambda row: market_outstanding_shares_from_inventory(market_option_inventory(row))
_market_lmsr_cost_from_shares = lmsr_cost_from_shares
_market_lmsr_prices_from_shares = lmsr_prices_from_inventory
def _market_lmsr_trade_cost(row: dict[str, Any], option_id: str, quantity: float, *, direction: int) -> float:
    return lmsr_trade_cost_from_inventory(
        row,
        market_option_inventory(row),
        option_id,
        quantity,
        direction=direction,
    )

_market_open_shares = lambda row: {
    option_id: round(max(0.0, value / 100.0), 6)
    for option_id, value in market_option_inventory(row).items()
}
_market_option_liabilities = market_option_inventory
_market_cash_collected = market_cash_collected
_market_state_from_liabilities = market_state_from_inventory
_market_risk_state = market_risk_state
_market_fee_rate = market_fee_rate
_market_payload = market_payload
