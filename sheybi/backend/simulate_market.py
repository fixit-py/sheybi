from __future__ import annotations

import argparse
import csv
import heapq
import multiprocessing as mp
import math
import json
import os
import random
import statistics
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
import uuid

os.environ.setdefault("DEV_AUTH", "1")
os.environ.setdefault("ADMIN_USER_IDS", "dev_admin")

from backend.app import create_app
from backend.instant_store import admin_transact


STARTING_WALLET = 100000.0
DEFAULT_RESERVE = 10000000.0
MIN_FEE_RATE = 0.05
MAX_FEE_RATE = 0.20
SPREAD_RATE = 0.02
PLATFORM_STATE_ID = "00000000-0000-0000-0000-000000000001"
MARKET_CLOSE_MINUTES = 30


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def money(value: float) -> float:
    return round(float(value or 0.0), 2)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def format_iso(value: datetime | str) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value)


def read_json(res) -> dict[str, Any]:
    text = res.get_data(as_text=True)
    if not text:
        return {}
    try:
        return json.loads(text)
    except Exception:
        return {"raw": text}


def is_ok(res) -> bool:
    return 200 <= int(getattr(res, "status_code", 0)) < 300


def option_labels(count: int) -> list[str]:
    if count == 2:
        return ["YES", "NO"]
    return [f"Option {idx + 1}" for idx in range(count)]


def trade_mode(mode: str) -> str:
    return (mode or "random").strip().lower()


def stress_profile_name(value: str) -> str:
    return (value or "normal").strip().lower()


def market_liquidity_b(market: dict[str, Any]) -> float:
    stored = float(market.get("liquidity_b") or market.get("liquidityB") or 0.0)
    if stored > 0:
        return stored
    option_count = max(len(market.get("options") or []), 2)
    risk_cap = float(market.get("risk_cap") or market.get("riskCap") or DEFAULT_RESERVE * 0.05)
    denom = 100.0 * math.log(max(option_count, 2))
    if denom <= 0:
        return 1.0
    return max(1.0, round(risk_cap / denom, 6))


def market_shares_from_liabilities(liabilities: dict[str, float]) -> dict[str, float]:
    return {key: round(max(0.0, float(value) / 100.0), 6) for key, value in liabilities.items()}


def lmsr_cost_from_shares(market: dict[str, Any], shares: dict[str, float]) -> float:
    options = market.get("options") or []
    if not options:
        return 0.0
    b = max(market_liquidity_b(market), 1e-9)
    option_ids = [str(option.get("id") or "") for option in options]
    values = [max(0.0, float(shares.get(option_id, 0.0))) for option_id in option_ids]
    max_q = max(values, default=0.0)
    shifted = sum(math.exp((value - max_q) / b) for value in values) or 1.0
    return money(100.0 * b * (math.log(shifted) + (max_q / b) - math.log(len(option_ids))))


def lmsr_prices_from_liabilities(market: dict[str, Any], liabilities: dict[str, float]) -> dict[str, float]:
    options = market.get("options") or []
    if not options:
        return {}
    shares = market_shares_from_liabilities(liabilities)
    b = max(market_liquidity_b(market), 1e-9)
    option_ids = [str(option.get("id") or "") for option in options]
    values = [max(0.0, float(shares.get(option_id, 0.0))) for option_id in option_ids]
    max_q = max(values, default=0.0)
    weights = [math.exp((value - max_q) / b) for value in values]
    total_weight = sum(weights) or 1.0
    return {
        option_id: round(100.0 * (weight / total_weight), 2)
        for option_id, weight in zip(option_ids, weights, strict=False)
    }


def lmsr_trade_cost(market: dict[str, Any], liabilities: dict[str, float], option_id: str, quantity: float, *, direction: int) -> float:
    shares = market_shares_from_liabilities(liabilities)
    before = lmsr_cost_from_shares(market, shares)
    shares[option_id] = round(max(0.0, float(shares.get(option_id, 0.0)) + (quantity * direction)), 6)
    after = lmsr_cost_from_shares(market, shares)
    delta = after - before
    return round(max(0.0, delta if direction > 0 else -delta), 6)


def stress_profile_name(value: str) -> str:
    return (value or "normal").strip().lower()


def choose_action(mode: str, has_positions: bool) -> str:
    mode = trade_mode(mode)
    if mode == "adversarial":
        return "sell" if has_positions and random.random() < 0.55 else "buy"
    if mode == "mixed":
        return "sell" if has_positions and random.random() < 0.45 else "buy"
    return "sell" if has_positions and random.random() < 0.40 else "buy"


def choose_trade_quantity(mode: str, stress_profile: str, *, whale_size: float = 50000.0) -> float:
    profile = stress_profile_name(stress_profile)
    mode = trade_mode(mode)
    if profile == "whale":
        return round(random.choice([50000.0, 100000.0, 500000.0, whale_size]), 2)
    if profile == "adversarial":
        return round(random.uniform(25.0, 100.0), 2)
    if profile == "long-run":
        return round(random.uniform(1.0, 10.0), 2)
    if mode == "adversarial":
        return round(random.uniform(10.0, 40.0), 2)
    if mode == "mixed":
        return round(random.uniform(2.0, 30.0), 2)
    return round(random.uniform(1.0, 25.0), 2)


def choose_trade_quantity(
    *,
    mode: str,
    stress_profile: str,
    holding_qty: float | None = None,
    whale_size: float = 50000.0,
) -> float:
    profile = stress_profile_name(stress_profile)
    mode = trade_mode(mode)
    if profile == "one-sided":
        return round(random.uniform(5.0, 25.0), 2)
    if profile == "whale":
        sizes = [50000.0, 100000.0, 500000.0, whale_size]
        return round(random.choice([size for size in sizes if size > 0]), 2)
    if profile == "adversarial":
        return round(random.uniform(25.0, 100.0), 2)
    if profile == "long-run":
        return round(random.uniform(1.0, 10.0), 2)
    if mode == "adversarial":
        return round(random.uniform(10.0, 40.0), 2)
    if mode == "mixed":
        return round(random.uniform(2.0, 30.0), 2)
    return round(random.uniform(1.0, 25.0), 2)


def choose_buy_option(mode: str, options: list[dict[str, Any]]) -> dict[str, Any]:
    if not options:
        raise ValueError("no_options")
    mode = trade_mode(mode)
    if mode == "adversarial":
        return max(
            options,
            key=lambda option: (
                float(option.get("current_price") or option.get("ask_price") or 0.0),
                float(option.get("liability") or option.get("exposure") or 0.0),
                str(option.get("id") or ""),
            ),
        )
    return random.choice(options)


def choose_final_winner(mode: str, options: list[dict[str, Any]]) -> dict[str, Any]:
    if not options:
        raise ValueError("no_options")
    mode = trade_mode(mode)
    if mode == "adversarial":
        return max(
            options,
            key=lambda option: (
                float(option.get("liability") or option.get("exposure") or 0.0),
                float(option.get("current_price") or option.get("ask_price") or 0.0),
                str(option.get("id") or ""),
            ),
        )
    return random.choice(options)


def choose_sell_option(mode: str, options: list[dict[str, Any]], held_options: list[tuple[str, float]]) -> str:
    if not held_options:
        raise ValueError("no_positions")
    mode = trade_mode(mode)
    held_ids = {option_id for option_id, qty in held_options if qty > 0}
    held_rows = [option for option in options if str(option.get("id")) in held_ids]
    if not held_rows:
        return str(random.choice(held_options)[0])
    if mode == "adversarial":
        return str(
            max(
                held_rows,
                key=lambda option: (
                    float(option.get("current_price") or option.get("bid_price") or 0.0),
                    float(option.get("liability") or option.get("exposure") or 0.0),
                    str(option.get("id") or ""),
                ),
            ).get("id")
        )
    return str(random.choice(held_rows).get("id"))


def compute_fee_rate(market: dict[str, Any], option_id: str) -> float:
    options = market.get("options") or []
    if not options:
        return MIN_FEE_RATE
    equal_share = 1.0 / len(options)
    liabilities = {
        str(option.get("id")): float(option.get("liability") or option.get("exposure") or 0.0)
        for option in options
    }
    total_liability = sum(liabilities.values())
    risk_pressure = float(market.get("risk_pressure") or 0.0)
    option_share = equal_share if total_liability <= 0 else clamp(liabilities.get(option_id, 0.0) / total_liability, 0.0, 1.0)
    imbalance = clamp(abs(option_share - equal_share) / equal_share, 0.0, 1.0) if equal_share > 0 else 0.0
    pressure = max(risk_pressure, imbalance)
    return round(clamp(MIN_FEE_RATE + ((MAX_FEE_RATE - MIN_FEE_RATE) * pressure), MIN_FEE_RATE, MAX_FEE_RATE), 4)


def estimate_win_loss(
    *,
    market: dict[str, Any],
    option_id: str,
    quantity: float,
    executed_price: float,
) -> dict[str, float]:
    fee_rate = compute_fee_rate(market, option_id)
    estimated_resolve_price = round(100.0 * (1.0 - fee_rate), 2)
    estimated_win_pnl = round(quantity * (estimated_resolve_price - executed_price), 2)
    estimated_loss_pnl = round(-quantity * executed_price, 2)
    return {
        "estimated_resolve_fee_rate": fee_rate,
        "estimated_resolve_price": estimated_resolve_price,
        "estimated_win_pnl": estimated_win_pnl,
        "estimated_loss_pnl": estimated_loss_pnl,
    }


def build_trade_audit_snapshot(
    *,
    market_before: dict[str, Any],
    market_after: dict[str, Any],
    wallet_before: float,
    wallet_after: float,
    reserve_before: float,
    reserve_after: float,
    gross_amount: float,
    fee: float,
    fee_rate: float,
    trade_cost: float,
    timestamp: str | None,
) -> dict[str, Any]:
    cash_before = money(wallet_before)
    cash_after = money(wallet_after)
    worst_case_loss_before = money(float(market_before.get("worst_case_loss") or 0.0))
    worst_case_loss_after = money(float(market_after.get("worst_case_loss") or 0.0))
    risk_cap = money(float(market_after.get("risk_cap") or market_before.get("risk_cap") or DEFAULT_RESERVE * 0.05))
    liquidity_b = round(float(market_after.get("liquidity_b") or market_before.get("liquidity_b") or market_liquidity_b(market_before)), 6)
    reserve_before_m = money(reserve_before)
    reserve_after_m = money(reserve_after)
    invariant = {
        "cash_non_negative": cash_after >= -0.005,
        "reserve_non_negative": reserve_after_m >= -0.005,
        "liabilities_non_negative": all(float(option.get("liability") or option.get("exposure") or 0.0) >= -0.005 for option in (market_after.get("options") or [])),
        "risk_cap_respected": worst_case_loss_after <= (risk_cap + 0.01),
    }
    return {
        "cash_before": cash_before,
        "cash_after": cash_after,
        "worst_case_loss_before": worst_case_loss_before,
        "worst_case_loss_after": worst_case_loss_after,
        "risk_cap": risk_cap,
        "reserve_before": reserve_before_m,
        "reserve_after": reserve_after_m,
        "fee": money(fee),
        "fee_rate": round(fee_rate, 4),
        "trade_cost": money(trade_cost),
        "liquidity_b": liquidity_b,
        "timestamp": timestamp,
        "invariant": invariant,
    }


def build_market_summary_record(
    *,
    market: dict[str, Any],
    trade_rows: list[dict[str, Any]],
    payouts: list[dict[str, Any]],
    resolution_fee_total: float,
    actual_platform_pnl: float,
    reconciliation: dict[str, Any],
    winning_option_id: str,
    winning_option_label: str,
    risk_rejections: int,
) -> dict[str, Any]:
    executed_trades = [row for row in trade_rows if row.get("status") == "executed"]
    participants = {str(row.get("user_id") or "") for row in executed_trades if row.get("user_id")}
    winning_users = {str(row.get("user_id") or "") for row in payouts if row.get("user_id")}
    participant_count = len(participants)
    buy_volume = round(sum(float(row.get("gross_amount") or 0.0) for row in trade_rows if row.get("action") == "buy" and row.get("status") == "executed"), 2)
    sell_volume = round(sum(float(row.get("gross_amount") or 0.0) for row in trade_rows if row.get("action") == "sell" and row.get("status") == "executed"), 2)
    avg_trade_cost = round(sum(float(row.get("gross_amount") or 0.0) for row in executed_trades) / len(executed_trades), 2) if executed_trades else 0.0
    max_trade_size = round(max((float(row.get("gross_amount") or 0.0) for row in executed_trades), default=0.0), 2)
    fees_collected = round(sum(float(row.get("fee") or 0.0) for row in trade_rows if row.get("status") == "executed") + float(resolution_fee_total or 0.0), 2)
    cash_collected = round(float(market.get("cash_collected") or 0.0), 2)
    worst_case_loss = round(float(market.get("worst_case_loss") or 0.0), 2)
    risk_cap = round(float(market.get("risk_cap") or DEFAULT_RESERVE * 0.05), 2)
    winner_payout = round(sum(float(row.get("amount") or 0.0) for row in payouts), 2)
    actual_platform_loss = round(max(0.0, -float(actual_platform_pnl or 0.0)), 2)
    actual_loss_ratio = round(actual_platform_loss / worst_case_loss, 6) if worst_case_loss > 0 else 0.0
    return {
        "market_id": market.get("id"),
        "market_title": market.get("title"),
        "trades": sum(1 for row in trade_rows if row.get("status") == "executed"),
        "winner_count": len(winning_users),
        "loser_count": max(0, participant_count - len(winning_users)),
        "buy_volume": buy_volume,
        "sell_volume": sell_volume,
        "avg_trade_cost": avg_trade_cost,
        "max_trade_size": max_trade_size,
        "fees_collected": fees_collected,
        "cash_collected": cash_collected,
        "worst_case_loss": worst_case_loss,
        "risk_cap": risk_cap,
        "winner_payout": winner_payout,
        "actual_platform_pnl": money(actual_platform_pnl),
        "actual_platform_loss": actual_platform_loss,
        "actual_loss": actual_platform_loss,
        "actual_loss_ratio": actual_loss_ratio,
        "reconciliation_delta": money(float(reconciliation.get("balance_delta") or 0.0)),
        "winning_option_id": winning_option_id,
        "winning_option": winning_option_label,
        "risk_rejections": risk_rejections,
    }


def local_market_state_from_liabilities(
    row: dict[str, Any],
    liabilities: dict[str, float],
    cash_collected: float,
) -> dict[str, Any]:
    options = row.get("options") or []
    total_liability = round(sum(liabilities.values()), 2)
    worst_case_payout = round(max(liabilities.values(), default=0.0), 2)
    risk_cap = round(float(row.get("risk_cap") or row.get("riskCap") or DEFAULT_RESERVE * 0.05), 2)
    worst_case_loss = round(max(0.0, worst_case_payout - cash_collected), 2)
    risk_pressure = 1.0 if risk_cap <= 0 else clamp(worst_case_loss / risk_cap, 0.0, 1.0)
    prices = lmsr_prices_from_liabilities(row, liabilities)
    updated_options: list[dict[str, Any]] = []
    for option in options:
        oid = str(option.get("id") or "")
        mid = round(clamp(prices.get(oid, float(option.get("current_price") or option.get("base_price") or 0.0)), 0.01, 99.99), 2)
        spread = clamp(SPREAD_RATE + (risk_pressure * 0.05), SPREAD_RATE, 0.10)
        bid = round(max(0.01, mid * (1.0 - spread / 2.0)), 2)
        ask = round(max(bid + 0.01, mid * (1.0 + spread / 2.0)), 2)
        liability = round(float(liabilities.get(oid, 0.0)), 2)
        updated_options.append(
            {
                **option,
                "current_price": mid,
                "bid_price": bid,
                "ask_price": ask,
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


def local_reprice_market(
    row: dict[str, Any],
    *,
    liabilities: dict[str, float] | None = None,
    cash_collected: float | None = None,
    volume_deltas: dict[str, float] | None = None,
) -> dict[str, Any]:
    next_liabilities = dict(row.get("_liabilities") or {})
    if liabilities:
        next_liabilities.update({key: round(float(value), 2) for key, value in liabilities.items()})
    next_cash_collected = float(row.get("cash_collected") or 0.0) if cash_collected is None else round(float(cash_collected), 2)
    state = local_market_state_from_liabilities(row, next_liabilities, next_cash_collected)
    updated_options = state["options"]
    if volume_deltas:
        deltas = {key: round(float(value), 2) for key, value in volume_deltas.items()}
        for option in updated_options:
            oid = str(option.get("id") or "")
            if oid in deltas:
                option["volume"] = round(float(option.get("volume") or 0.0) + deltas[oid], 2)
    row.update(
        {
            "options": updated_options,
            "cash_collected": state["cash_collected"],
            "total_liability": state["total_liability"],
            "worst_case_payout": state["worst_case_payout"],
            "worst_case_loss": state["worst_case_loss"],
            "risk_pressure": state["risk_pressure"],
            "risk_cap": state["risk_cap"],
            "_liabilities": next_liabilities,
        }
    )
    return row


def local_market_fee_rate(market: dict[str, Any], option_id: str | None = None) -> float:
    options = market.get("options") or []
    if not options:
        return MIN_FEE_RATE
    equal_share = 1.0 / max(len(options), 1)
    liabilities = {
        str(option.get("id")): float(option.get("liability") or option.get("exposure") or 0.0)
        for option in options
    }
    total_liability = sum(liabilities.values())
    risk_pressure = float(market.get("risk_pressure") or 0.0)
    option_share = equal_share if total_liability <= 0 else clamp(liabilities.get(option_id or "", 0.0) / total_liability, 0.0, 1.0)
    imbalance = clamp(abs(option_share - equal_share) / equal_share, 0.0, 1.0) if equal_share > 0 else 0.0
    pressure = max(risk_pressure, imbalance)
    fee = MIN_FEE_RATE + ((MAX_FEE_RATE - MIN_FEE_RATE) * pressure)
    return round(clamp(fee, MIN_FEE_RATE, MAX_FEE_RATE), 4)


def local_buy_fee_rate(market: dict[str, Any]) -> float:
    return 0.005


def choose_sell_option_from_positions(mode: str, options: list[dict[str, Any]], held_options: list[tuple[str, float]]) -> str:
    return choose_sell_option(mode, options, held_options)


def scenario_summary(
    *,
    market: dict[str, Any],
    current_reserve: float,
    fee_balance: float,
    wallets: dict[str, float],
    positions: dict[str, dict[str, float]],
    start_reserve: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    options = market.get("options") or []
    scenarios: list[dict[str, Any]] = []
    resolution_rows: list[dict[str, Any]] = []
    for option in options:
        winning_option_id = str(option.get("id"))
        fee_rate = compute_fee_rate(market, winning_option_id)
        payout_per_share = round(100.0 * (1.0 - fee_rate), 2)
        user_results: list[dict[str, Any]] = []
        total_payout = 0.0
        total_gross = 0.0
        for user_id, user_positions in positions.items():
            shares = money(user_positions.get(winning_option_id, 0.0))
            wallet_before = money(wallets.get(user_id, STARTING_WALLET))
            if shares <= 0:
                final_wallet = wallet_before
                resolution_rows.append(
                    {
                        "user_id": user_id,
                        "winning_option_id": winning_option_id,
                        "winning_option_label": option.get("label"),
                        "shares": 0.0,
                        "resolve_fee_rate": fee_rate,
                        "gross_resolve_price": 100.0,
                        "resolve_price": payout_per_share,
                        "gross_payout": 0.0,
                        "resolution_fee_amount": 0.0,
                        "payout": 0.0,
                        "wallet_before": wallet_before,
                        "wallet_after": final_wallet,
                        "pnl": money(final_wallet - STARTING_WALLET),
                        "outcome": "lose",
                    }
                )
                user_results.append(
                    {"user_id": user_id, "shares": 0.0, "payout": 0.0, "wallet": final_wallet, "pnl": money(final_wallet - STARTING_WALLET)}
                )
                continue
            gross_payout = round(shares * 100.0, 2)
            payout = round(shares * payout_per_share, 2)
            fee_amount = round(max(0.0, gross_payout - payout), 2)
            total_payout += payout
            total_gross += gross_payout
            final_wallet = money(wallet_before + payout)
            resolution_rows.append(
                {
                    "user_id": user_id,
                    "winning_option_id": winning_option_id,
                    "winning_option_label": option.get("label"),
                    "shares": shares,
                    "resolve_fee_rate": fee_rate,
                    "gross_resolve_price": 100.0,
                    "resolve_price": payout_per_share,
                    "gross_payout": gross_payout,
                    "resolution_fee_amount": fee_amount,
                    "payout": payout,
                    "wallet_before": wallet_before,
                    "wallet_after": final_wallet,
                    "pnl": money(final_wallet - STARTING_WALLET),
                    "outcome": "win",
                }
            )
            user_results.append(
                {"user_id": user_id, "shares": shares, "payout": payout, "wallet": final_wallet, "pnl": money(final_wallet - STARTING_WALLET)}
            )

        resolution_fee_total = money(max(0.0, total_gross - total_payout))
        final_reserve = money(current_reserve - total_payout)
        final_fee_balance = money(fee_balance + resolution_fee_total)
        platform_pnl = money(final_reserve + final_fee_balance - start_reserve)
        winners = [row for row in user_results if row["pnl"] > 0]
        losers = [row for row in user_results if row["pnl"] < 0]
        breakeven = [row for row in user_results if row["pnl"] == 0]
        user_results.sort(key=lambda row: row["pnl"], reverse=True)
        scenarios.append(
            {
                "winning_option_id": winning_option_id,
                "winning_option_label": option.get("label"),
                "resolve_fee_rate": fee_rate,
                "payout_per_share": payout_per_share,
                "total_payout": money(total_payout),
                "resolution_fee_total": resolution_fee_total,
                "platform_end_reserve": final_reserve,
                "platform_end_fee_balance": final_fee_balance,
                "platform_pnl": platform_pnl,
                "winner_count": len(winners),
                "loser_count": len(losers),
                "breakeven_count": len(breakeven),
                "best_user": winners[0] if winners else None,
                "worst_user": losers[-1] if losers else None,
                "top_10_winners": winners[:10],
                "top_10_losers": losers[-10:],
            }
        )
    return scenarios, resolution_rows


def run_single_simulation_local(
    *,
    seed: int,
    users: int,
    trades: int,
    option_count: int,
    attempt_multiplier: int,
    title: str,
    log_file: str,
    mode: str,
    close_minutes: int,
    stress_profile: str = "normal",
    whale_size: float = 50000.0,
    forced_outcome_index: int | None = None,
    compact: bool = False,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    random.seed(seed)
    log_path = Path(log_file) if log_file and not compact else None
    if log_path is not None:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        if log_path.exists():
            log_path.unlink()

    def emit(entry: dict[str, Any]) -> None:
        if log_path is None:
            return
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, sort_keys=True, default=str) + "\n")

    labels = option_labels(option_count)
    option_ids = [str(uuid.uuid4()) for _ in labels]
    options = [
        {
            "id": option_id,
            "label": label,
            "base_price": round(100.0 / option_count, 2),
            "current_price": round(100.0 / option_count, 2),
            "bid_price": round(max(0.01, (100.0 / option_count) * (1.0 - SPREAD_RATE / 2.0)), 2),
            "ask_price": round(max(0.01, (100.0 / option_count) * (1.0 + SPREAD_RATE / 2.0)), 2),
            "volume": 0.0,
            "liability": 0.0,
            "exposure": 0.0,
        }
        for option_id, label in zip(option_ids, labels, strict=True)
    ]
    market_start = now_utc() - timedelta(minutes=1)
    market_close = market_start + timedelta(minutes=close_minutes)
    market_id = str(uuid.uuid4())
    risk_cap = round(DEFAULT_RESERVE * 0.05, 2)
    liquidity_b = max(1.0, round(risk_cap / (100.0 * math.log(max(option_count, 2))), 6))
    market: dict[str, Any] = {
        "id": market_id,
        "title": title,
        "rules": "Simulation market for algorithm testing.",
        "start": format_iso(market_start),
        "close": format_iso(market_close),
        "status": "open",
        "closed_at": None,
        "winning_option_id": None,
        "winning_option_label": None,
        "resolved_at": None,
        "start_reserve_balance": DEFAULT_RESERVE,
        "start_fee_balance": 0.0,
        "options": options,
        "cash_collected": 0.0,
        "total_liability": 0.0,
        "worst_case_payout": 0.0,
        "worst_case_loss": 0.0,
        "risk_pressure": 0.0,
        "risk_cap": risk_cap,
        "liquidity_b": liquidity_b,
        "_liabilities": {option_id: 0.0 for option_id in option_ids},
    }

    emit({"type": "market_created", "elapsed_ms": 0.0, "market": market})
    user_ids = [f"sim_user_{idx:04d}" for idx in range(1, users + 1)]
    user_names = {user_id: user_id.replace("_", " ").title() for user_id in user_ids}
    wallets = {user_id: STARTING_WALLET for user_id in user_ids}
    positions: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    trade_rows: list[dict[str, Any]] = []

    successful_trades = 0
    attempts = 0
    rejected_trades = 0
    risk_rejections = 0
    cumulative_buy_fees = 0.0
    cumulative_sell_fees = 0.0
    cumulative_fee_balance = 0.0
    reserve_balance = DEFAULT_RESERVE
    max_risk_pressure = float(market.get("risk_pressure") or 0.0)
    max_worst_case_loss = float(market.get("worst_case_loss") or 0.0)
    current_market = market
    close_window_seconds = max(1, close_minutes * 60)
    mode = trade_mode(mode)
    stress_profile = stress_profile_name(stress_profile)

    def validate_market_invariants(market_row: dict[str, Any], reserve_balance: float, context: str) -> None:
        if reserve_balance < -0.005:
            raise SystemExit(f"{context}: negative reserve balance {reserve_balance}")
        if float(market_row.get("worst_case_loss") or 0.0) < -0.005:
            raise SystemExit(f"{context}: negative worst-case loss {market_row.get('worst_case_loss')}")
        for option_row in market_row.get("options") or []:
            liability = float(option_row.get("liability") or option_row.get("exposure") or 0.0)
            shares = float(option_row.get("shares") or 0.0)
            price = float(option_row.get("current_price") or option_row.get("currentPrice") or 0.0)
            if liability < -0.005:
                raise SystemExit(f"{context}: negative liability for option {option_row.get('id')}")
            if shares < -0.005:
                raise SystemExit(f"{context}: negative shares for option {option_row.get('id')}")
            if price < 0.01 - 1e-9 or price > 99.99 + 1e-9:
                raise SystemExit(f"{context}: invalid price {price} for option {option_row.get('id')}")

    def append_trade_row(
        *,
        action: str,
        status: str,
        user_id: str,
        user_name: str,
        option: dict[str, Any],
        quantity: float,
        trade_index: int,
        attempt_index: int,
        elapsed_ms: float,
        wallet_before: float,
        reserve_before: float,
        market_before: dict[str, Any],
        response: dict[str, Any],
        request_body: dict[str, Any],
    ) -> None:
        trade = response.get("trade") or {}
        market_after = response.get("market") or market_before
        executed_price = float(trade.get("price") or option.get("ask_price") or option.get("bid_price") or option.get("current_price") or 0.0)
        gross_amount = float(trade.get("amount") or (executed_price * quantity) or 0.0)
        fee = float(trade.get("fee") or 0.0)
        fee_rate = float(trade.get("feeRate") or (fee / gross_amount if gross_amount > 0 else 0.0))
        estimate = estimate_win_loss(
            market=market_before,
            option_id=str(option.get("id") or ""),
            quantity=quantity,
            executed_price=executed_price,
        )
        wallet_after = float(response.get("wallet_balance") or wallet_before)
        reserve_after = float(response.get("reserve_balance") or reserve_before)
        audit = build_trade_audit_snapshot(
            market_before=market_before,
            market_after=market_after,
            wallet_before=wallet_before,
            wallet_after=wallet_after,
            reserve_before=reserve_before,
            reserve_after=reserve_after,
            gross_amount=gross_amount,
            fee=fee,
            fee_rate=fee_rate,
            trade_cost=gross_amount,
            timestamp=trade.get("timestamp") or request_body.get("t"),
        )
        trade_rows.append(
            {
                "run_mode": mode,
                "seed": seed,
                "market_id": market_id,
                "market_title": title,
                "trade_index": trade_index,
                "attempt_index": attempt_index,
                "elapsed_ms": elapsed_ms,
                "user_id": user_id,
                "user_name": user_name,
                "action": action,
                "status": status,
                "option_id": str(option.get("id") or ""),
                "option_label": option.get("label"),
                "quantity": quantity,
                "ask_price": float(option.get("ask_price") or option.get("current_price") or 0.0),
                "bid_price": float(option.get("bid_price") or option.get("current_price") or 0.0),
                "executed_price": executed_price,
                "gross_amount": money(gross_amount),
                "fee_rate": round(fee_rate, 4),
                "fee": money(fee),
                "fee_amount": money(fee),
                "net_amount": money(gross_amount + fee if action == "buy" else gross_amount - fee),
                "estimated_resolve_fee_rate": estimate["estimated_resolve_fee_rate"],
                "estimated_resolve_price": estimate["estimated_resolve_price"],
                "estimated_win_pnl": estimate["estimated_win_pnl"],
                "estimated_loss_pnl": estimate["estimated_loss_pnl"],
                "wallet_before": money(wallet_before),
                "wallet_after": money(wallet_after),
                "wallet_delta": money(wallet_after - wallet_before),
                "reserve_before": money(reserve_before),
                "reserve_after": money(reserve_after),
                "cash_before": money(wallet_before),
                "cash_after": money(wallet_after),
                "cash_collected_after": money(float(market_after.get("cash_collected") or 0.0)),
                "risk_pressure_after": round(float(market_after.get("risk_pressure") or 0.0), 6),
                "worst_case_loss_after": money(float(market_after.get("worst_case_loss") or 0.0)),
                "worst_case_loss_before": money(float(market_before.get("worst_case_loss") or 0.0)),
                "risk_cap": money(float(market_after.get("risk_cap") or market_before.get("risk_cap") or DEFAULT_RESERVE * 0.05)),
                "liquidity_b": round(float(market_after.get("liquidity_b") or market_before.get("liquidity_b") or market_liquidity_b(market_before)), 6),
                "trade_cost": money(gross_amount),
                "liability_after": money(float(option.get("liability") or option.get("exposure") or 0.0)),
                "request_quantity": float(request_body.get("quantity") or 0.0),
                "request_t": request_body.get("t"),
                "error": response.get("error"),
                **audit,
            }
        )

    while successful_trades < trades and attempts < trades * attempt_multiplier:
        attempts += 1
        user_id = random.choice(user_ids)
        current_options = current_market.get("options") or []
        if not current_options:
            break

        active_positions = positions[user_id]
        held_options = [(opt_id, qty) for opt_id, qty in active_positions.items() if qty > 0]
        if stress_profile == "one-sided":
            action = "buy"
        elif stress_profile == "whale":
            action = "buy" if not held_options or random.random() < 0.75 else "sell"
        elif stress_profile == "adversarial":
            action = "sell" if held_options and random.random() < 0.7 else "buy"
        else:
            action = choose_action(mode, bool(held_options))
        trade_time = market_start + timedelta(seconds=random.randint(0, close_window_seconds - 1))

        if action == "sell":
            try:
                option_id = choose_sell_option_from_positions(mode, current_options, held_options)
            except Exception:
                action = "buy"
            else:
                held_qty = float(active_positions.get(option_id, 0.0))
                if held_qty > 0:
                    floor = 5.0 if mode in {"adversarial", "whale"} or stress_profile in {"adversarial", "whale"} else 0.1
                    quantity = round(min(held_qty, random.uniform(floor, max(held_qty, floor))), 2)
                    if quantity > 0:
                        option = next((opt for opt in current_options if str(opt.get("id")) == option_id), None)
                        if option is None:
                            action = "buy"
                            continue
                        wallet_before = float(wallets[user_id])
                        reserve_before = float(reserve_balance)
                        market_before = json.loads(json.dumps(current_market))
                        amount_f = lmsr_trade_cost(current_market, current_market.get("_liabilities") or {}, option_id, quantity, direction=-1)
                        fee_rate = local_buy_fee_rate(current_market)
                        fee = round(amount_f * fee_rate, 2)
                        total_credit = round(amount_f - fee, 2)
                        if float(active_positions.get(option_id, 0.0)) < quantity:
                            payload = {"error": "insufficient_position"}
                            rejected_trades += 1
                            append_trade_row(
                                action="sell",
                                status="rejected",
                                user_id=user_id,
                                user_name=user_names[user_id],
                                option=option,
                                quantity=quantity,
                                trade_index=successful_trades + 1,
                                attempt_index=attempts,
                                elapsed_ms=0.0,
                                wallet_before=wallet_before,
                                reserve_before=reserve_before,
                                market_before=market_before,
                                response=payload,
                                request_body={"option_id": option_id, "quantity": quantity, "t": format_iso(trade_time)},
                            )
                            continue
                        wallets[user_id] = money(wallet_before + total_credit)
                        cumulative_sell_fees += fee
                        cumulative_fee_balance += fee
                        reserve_balance = money(reserve_balance - amount_f)
                        positions[user_id][option_id] = round(active_positions.get(option_id, 0.0) - quantity, 6)
                        if positions[user_id][option_id] <= 0:
                            positions[user_id].pop(option_id, None)
                        current_market["_liabilities"][option_id] = round(max(0.0, current_market["_liabilities"].get(option_id, 0.0) - (quantity * 100.0)), 2)
                        current_market = local_reprice_market(
                            current_market,
                            liabilities=current_market["_liabilities"],
                            cash_collected=float(current_market.get("cash_collected") or 0.0) - amount_f,
                            volume_deltas={option_id: quantity},
                        )
                        validate_market_invariants(current_market, reserve_balance, "sell_trade")
                        max_risk_pressure = max(max_risk_pressure, float(current_market.get("risk_pressure") or 0.0))
                        max_worst_case_loss = max(max_worst_case_loss, float(current_market.get("worst_case_loss") or 0.0))
                        payload = {
                            "trade": {
                                "market_id": market_id,
                                "option_id": option_id,
                                "option_label": option.get("label"),
                                "quantity": round(quantity, 6),
                                "price": round(amount_f / quantity, 6) if quantity > 0 else 0.0,
                                "amount": amount_f,
                                "fee": fee,
                                "feeRate": fee_rate,
                                "wallet_delta": total_credit,
                                "timestamp": format_iso(trade_time),
                            },
                            "market": current_market,
                            "wallet_balance": wallets[user_id],
                            "reserve_balance": reserve_balance,
                        }
                        successful_trades += 1
                        append_trade_row(
                            action="sell",
                            status="executed",
                            user_id=user_id,
                            user_name=user_names[user_id],
                            option=option,
                            quantity=quantity,
                            trade_index=successful_trades,
                            attempt_index=attempts,
                            elapsed_ms=0.0,
                            wallet_before=wallet_before,
                            reserve_before=reserve_before,
                            market_before=market_before,
                            response=payload,
                            request_body={"option_id": option_id, "quantity": quantity, "t": format_iso(trade_time)},
                        )
                        emit({"type": "trade", "trade_index": successful_trades, "attempt_index": attempts, "action": action, "user_id": user_id, "market_id": market_id, "request": {"option_id": option_id, "quantity": quantity, "t": format_iso(trade_time)}, "response": payload, "market_snapshot": current_market, "wallet_balance": wallets[user_id], "positions": dict(positions[user_id]), "cumulative_sell_fees": money(cumulative_sell_fees), "cumulative_fee_balance": money(cumulative_fee_balance)})
                        continue

        option = choose_buy_option(mode, current_options)
        option_id = str(option.get("id"))
        quantity = choose_trade_quantity(mode=mode, stress_profile=stress_profile, whale_size=whale_size)
        if stress_profile == "one-sided":
            option = current_options[0]
            option_id = str(option.get("id"))
        body = {"option_id": option_id, "quantity": quantity, "t": format_iso(trade_time)}
        retries = 0
        while retries < 4:
            wallet_before = float(wallets[user_id])
            reserve_before = float(reserve_balance)
            market_before = json.loads(json.dumps(current_market))
            option_row = next((opt for opt in current_options if str(opt.get("id")) == option_id), option)
            amount_f = lmsr_trade_cost(current_market, current_market.get("_liabilities") or {}, option_id, quantity, direction=1)
            fee_rate = local_buy_fee_rate(current_market)
            fee = round(amount_f * fee_rate, 2)
            next_liabilities = dict(current_market["_liabilities"])
            next_liabilities[option_id] = round(next_liabilities.get(option_id, 0.0) + (quantity * 100.0), 2)
            next_cash_collected = float(current_market.get("cash_collected") or 0.0) + amount_f
            next_state = local_market_state_from_liabilities(current_market, next_liabilities, next_cash_collected)
            if next_state["worst_case_loss"] > next_state["risk_cap"]:
                payload = {"error": "market_risk_cap_reached", "required": next_state["worst_case_loss"], "available": next_state["risk_cap"]}
                rejected_trades += 1
                risk_rejections += 1
                append_trade_row(
                    action="buy",
                    status="rejected",
                    user_id=user_id,
                    user_name=user_names[user_id],
                    option=option_row,
                    quantity=quantity,
                    trade_index=successful_trades + 1,
                    attempt_index=attempts,
                    elapsed_ms=0.0,
                    wallet_before=wallet_before,
                    reserve_before=reserve_before,
                    market_before=market_before,
                    response=payload,
                    request_body=body,
                )
                emit(
                    {
                        "type": "RISK_REJECT",
                        "market_id": market_id,
                        "user_id": user_id,
                        "option_id": option_id,
                        "required": payload["required"],
                        "available": payload["available"],
                        "request": body,
                    }
                )
                error = payload["error"]
                if error in {"market_risk_cap_reached", "insufficient_wallet_balance"}:
                    quantity = round(quantity * 0.5, 2)
                    if quantity < 0.01:
                        break
                    body["quantity"] = quantity
                    retries += 1
                    continue
                break
            total_debit = round(amount_f + fee, 2)
            if wallet_before < total_debit:
                payload = {"error": "insufficient_wallet_balance"}
                rejected_trades += 1
                append_trade_row(
                    action="buy",
                    status="rejected",
                    user_id=user_id,
                    user_name=user_names[user_id],
                    option=option_row,
                    quantity=quantity,
                    trade_index=successful_trades + 1,
                    attempt_index=attempts,
                    elapsed_ms=0.0,
                    wallet_before=wallet_before,
                    reserve_before=reserve_before,
                    market_before=market_before,
                    response=payload,
                    request_body=body,
                )
                quantity = round(quantity * 0.5, 2)
                if quantity < 0.01:
                    break
                body["quantity"] = quantity
                retries += 1
                continue
            wallets[user_id] = money(wallet_before - total_debit)
            cumulative_fee_balance += fee
            reserve_balance = money(reserve_balance + amount_f)
            current_market["_liabilities"] = next_liabilities
            current_market = local_reprice_market(current_market, liabilities=next_liabilities, cash_collected=next_cash_collected, volume_deltas={option_id: quantity})
            validate_market_invariants(current_market, reserve_balance, "buy_trade")
            max_risk_pressure = max(max_risk_pressure, float(current_market.get("risk_pressure") or 0.0))
            max_worst_case_loss = max(max_worst_case_loss, float(current_market.get("worst_case_loss") or 0.0))
            payload = {
                "trade": {
                    "market_id": market_id,
                    "option_id": option_id,
                    "option_label": option_row.get("label"),
                    "quantity": round(quantity, 6),
                    "price": round(amount_f / quantity, 6) if quantity > 0 else 0.0,
                    "amount": amount_f,
                    "fee": fee,
                    "feeRate": fee_rate,
                    "wallet_delta": -total_debit,
                    "timestamp": format_iso(trade_time),
                },
                "market": current_market,
                "wallet_balance": wallets[user_id],
                "reserve_balance": reserve_balance,
            }
            positions[user_id][option_id] = round(active_positions.get(option_id, 0.0) + quantity, 6)
            successful_trades += 1
            append_trade_row(
                action="buy",
                status="executed",
                user_id=user_id,
                user_name=user_names[user_id],
                option=option_row,
                quantity=quantity,
                trade_index=successful_trades,
                attempt_index=attempts,
                elapsed_ms=0.0,
                wallet_before=wallet_before,
                reserve_before=reserve_before,
                market_before=market_before,
                response=payload,
                request_body=body,
            )
            emit({"type": "trade", "trade_index": successful_trades, "attempt_index": attempts, "action": action, "user_id": user_id, "market_id": market_id, "request": body, "response": payload, "market_snapshot": current_market, "wallet_balance": wallets[user_id], "positions": dict(positions[user_id]), "cumulative_sell_fees": money(cumulative_sell_fees), "cumulative_fee_balance": money(cumulative_fee_balance)})
            break

    scenario_data, resolution_rows = scenario_summary(
        market=current_market,
        current_reserve=reserve_balance,
        fee_balance=cumulative_fee_balance,
        wallets=wallets,
        positions={key: dict(value) for key, value in positions.items()},
        start_reserve=DEFAULT_RESERVE,
    )
    for item in scenario_data:
        emit({"type": "scenario", **item})

    if forced_outcome_index is not None and current_market.get("options"):
        forced_index = max(0, min(len(current_market["options"]) - 1, forced_outcome_index))
        winner_option = current_market["options"][forced_index]
    else:
        winner_option = choose_final_winner(mode, current_market.get("options") or [])
    winning_option_id = str(winner_option.get("id") or "")
    winning_option_label = winner_option.get("label")
    fee_rate = local_market_fee_rate(current_market, winning_option_id)
    payout_per_share = round(100.0 * (1.0 - fee_rate), 2)
    payouts: list[dict[str, Any]] = []
    payout_total = 0.0
    resolution_fee_total = 0.0
    for user_id in user_ids:
        shares = money(positions[user_id].get(winning_option_id, 0.0))
        if shares <= 0:
            continue
        gross_payout = round(shares * 100.0, 2)
        payout = round(shares * payout_per_share, 2)
        fee_amount = round(max(0.0, gross_payout - payout), 2)
        payout_total += payout
        resolution_fee_total += fee_amount
        wallets[user_id] = money(wallets[user_id] + payout)
        reserve_balance = money(reserve_balance - gross_payout)
        payouts.append({"user_id": user_id, "gross_amount": gross_payout, "fee_amount": fee_amount, "amount": payout, "shares": shares})
    cumulative_fee_balance = money(cumulative_fee_balance + resolution_fee_total)
    current_reserve = money(reserve_balance)
    actual_platform_pnl = money(current_reserve + cumulative_fee_balance - DEFAULT_RESERVE)
    for row in payouts:
        emit({"type": "payout", **row})
    emit({"type": "market_closed", "market_id": market_id, "market_title": title, "closed_market": {"status": "closed", "closed_at": format_iso(now_utc()), **current_market}})
    reconciliation = {
        "start_reserve": money(DEFAULT_RESERVE),
        "start_fee_balance": 0.0,
        "start_total_balance": money(DEFAULT_RESERVE),
        "buy_cash_in": money(sum(float(row.get("gross_amount") or row.get("amount") or 0.0) for row in trade_rows if row.get("action") == "buy" and row.get("status") == "executed")),
        "buy_fees": money(sum(float(row.get("fee") or 0.0) for row in trade_rows if row.get("action") == "buy" and row.get("status") == "executed")),
        "sell_cash_out": money(sum(float(row.get("gross_amount") or row.get("amount") or 0.0) for row in trade_rows if row.get("action") == "sell" and row.get("status") == "executed")),
        "sell_fees": money(sum(float(row.get("fee") or 0.0) for row in trade_rows if row.get("action") == "sell" and row.get("status") == "executed")),
        "resolution_fees": money(resolution_fee_total),
        "fees_collected": money(sum(float(row.get("fee") or 0.0) for row in trade_rows if row.get("action") == "buy" and row.get("status") == "executed") + sum(float(row.get("fee") or 0.0) for row in trade_rows if row.get("action") == "sell" and row.get("status") == "executed") + resolution_fee_total),
        "winner_payouts": money(sum(float(row.get("gross_amount") or 0.0) for row in payouts)),
        "end_reserve": current_reserve,
        "end_fee_balance": cumulative_fee_balance,
        "end_total_balance": money(current_reserve + cumulative_fee_balance),
        "expected_end_total": money(DEFAULT_RESERVE + sum(float(row.get("gross_amount") or row.get("amount") or 0.0) for row in trade_rows if row.get("action") == "buy" and row.get("status") == "executed") + sum(float(row.get("fee") or 0.0) for row in trade_rows if row.get("action") == "buy" and row.get("status") == "executed") + sum(float(row.get("fee") or 0.0) for row in trade_rows if row.get("action") == "sell" and row.get("status") == "executed") + resolution_fee_total - sum(float(row.get("gross_amount") or row.get("amount") or 0.0) for row in trade_rows if row.get("action") == "sell" and row.get("status") == "executed") - sum(float(row.get("gross_amount") or 0.0) for row in payouts)),
    }
    reconciliation["balance_delta"] = money(reconciliation["end_total_balance"] - reconciliation["expected_end_total"])
    validate_market_invariants(current_market, current_reserve, "resolution")
    emit({"type": "market_reconciliation", "market_id": market_id, "market_title": title, **reconciliation})
    emit({"type": "market_resolved", "market_id": market_id, "market_title": title, "winning_option_id": winning_option_id, "winning_option_label": winning_option_label, "resolve_fee_rate": fee_rate, "gross_payout_per_share": 100.0, "payout_per_share": payout_per_share, "resolution_fee_total": money(resolution_fee_total), "payout_total": money(payout_total), "platform_pnl_actual": actual_platform_pnl, "payouts": payouts, "reconciliation": reconciliation})

    market_summary = build_market_summary_record(
        market=current_market,
        trade_rows=trade_rows,
        payouts=payouts,
        resolution_fee_total=resolution_fee_total,
        actual_platform_pnl=actual_platform_pnl,
        reconciliation=reconciliation,
        winning_option_id=winning_option_id,
        winning_option_label=winning_option_label,
        risk_rejections=risk_rejections,
    )
    emit({"type": "market_summary", **market_summary})

    summary = {
        "type": "summary",
        "market_id": market_id,
        "market_title": title,
        "seed": seed,
        "mode": mode,
        "users": users,
        "target_trades": trades,
        "successful_trades": successful_trades,
        "attempts": attempts,
        "rejected_trades": rejected_trades,
        "log_file": str(log_path),
        "trade_runtime_ms": {"create_market": 0.0, "final_market_lookup": 0.0, "final_admin_lookup": 0.0},
        "start_reserve": DEFAULT_RESERVE,
        "end_reserve": current_reserve,
        "actual_platform_pnl": actual_platform_pnl,
        "winning_option_id": winning_option_id,
        "winning_option_label": winning_option_label,
        "resolution_fee_total": money(resolution_fee_total),
        "payout_total": money(payout_total),
        "fee_balance": money(cumulative_fee_balance),
        "platform_pnl_if_resolved_now_min": min(float(item["platform_pnl"]) for item in scenario_data) if scenario_data else 0.0,
        "platform_pnl_if_resolved_now_max": max(float(item["platform_pnl"]) for item in scenario_data) if scenario_data else 0.0,
        "platform_pnl_if_resolved_now_avg": round(sum(float(item["platform_pnl"]) for item in scenario_data) / len(scenario_data), 2) if scenario_data else 0.0,
        "max_risk_pressure_seen": round(max_risk_pressure, 4),
        "max_worst_case_loss_seen": money(max_worst_case_loss),
        "current_market": current_market,
        "user_count_traded": len([user_id for user_id, pos in positions.items() if pos]),
        "admin_users_count": users,
        "admin_transactions_count": successful_trades + len(payouts),
        "market_reserve_cap": money(DEFAULT_RESERVE * 0.05),
        "spread_rate": SPREAD_RATE,
        "fee_range": {"min": MIN_FEE_RATE, "max": MAX_FEE_RATE},
        "balance_delta": reconciliation["balance_delta"],
        "risk_rejections": risk_rejections,
        "reconciliation_delta": reconciliation["balance_delta"],
    }
    if not compact:
        summary["trade_runtime_ms"] = {"create_market": 0.0, "final_market_lookup": 0.0, "final_admin_lookup": 0.0}
        summary["current_market"] = current_market
        summary["log_file"] = str(log_path)
        summary["user_count_traded"] = len([user_id for user_id, pos in positions.items() if pos])
        summary["admin_users_count"] = users
        summary["admin_transactions_count"] = successful_trades + len(payouts)
        print(json.dumps(summary, indent=2, default=str))
        print(f"JSONL log written to {log_path}")
    else:
        summary["user_count_traded"] = len([user_id for user_id, pos in positions.items() if pos])
        summary["admin_users_count"] = users
        summary["admin_transactions_count"] = successful_trades + len(payouts)
    emit(summary)
    if compact:
        trade_rows = []
        resolution_rows = []
    return summary, trade_rows, resolution_rows, market_summary


def execute_simulation_job(job: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any], int, str, int]:
    index = int(job["index"])
    run_seed = int(job["seed"])
    seed_start = int(job["seed_start"])
    trade_min = int(job["trade_min"])
    trade_max = int(job["trade_max"])
    option_min = int(job["option_min"])
    option_max = int(job["option_max"])
    mode_sequence = list(job["mode_sequence"])
    stress_profile_sequence = list(job.get("stress_profile_sequence") or [])
    default_mode = str(job["mode"])
    runs = int(job["runs"])
    output_dir = Path(job["output_dir"])
    users = int(job["users"])
    trades = int(job["trades"])
    attempt_multiplier = int(job["attempt_multiplier"])
    title = str(job["title"])
    close_minutes = int(job["close_minutes"])
    parallel = bool(job["parallel"])
    stress_profile = str(job.get("stress_profile") or "normal")
    whale_size = float(job.get("whale_size") or 50000.0)
    forced_outcome_index = job.get("forced_outcome_index")
    forced_outcome_index = int(forced_outcome_index) if forced_outcome_index is not None else None
    compact = bool(job.get("compact"))

    run_rng = random.Random(run_seed ^ seed_start)
    run_trades = run_rng.randint(trade_min, trade_max)
    run_mode = mode_sequence[(index - 1) % len(mode_sequence)] if mode_sequence else default_mode
    run_stress_profile = (
        stress_profile_sequence[(index - 1) % len(stress_profile_sequence)]
        if stress_profile_sequence
        else str(job.get("stress_profile") or "normal")
    )
    run_option_count = run_rng.randint(option_min, option_max)
    if stress_profile_name(run_stress_profile) == "forced-outcomes" and forced_outcome_index is None:
        forced_outcome_index = (index - 1) % max(run_option_count, 1)
    run_log = str(output_dir / "runs" / f"seed_{run_seed}.jsonl")
    use_local = parallel or stress_profile_name(run_stress_profile) != "normal" or forced_outcome_index is not None
    runner = run_single_simulation_local if use_local else run_single_simulation
    run_kwargs: dict[str, Any] = {
        "seed": run_seed,
        "users": users,
        "trades": run_trades,
        "option_count": run_option_count,
        "attempt_multiplier": attempt_multiplier,
        "title": title,
        "log_file": run_log,
        "mode": run_mode,
        "close_minutes": close_minutes,
        "compact": compact,
    }
    if use_local:
        run_kwargs.update(
            {
                "stress_profile": run_stress_profile,
                "whale_size": whale_size,
                "forced_outcome_index": forced_outcome_index,
            }
        )
    summary, trade_rows, resolution_rows, market_summary = runner(**run_kwargs)
    summary["run_index"] = index
    summary["trades_planned"] = run_trades
    summary["mode"] = run_mode
    summary["option_count"] = run_option_count
    return summary, trade_rows, resolution_rows, market_summary, run_trades, run_mode, run_option_count


def run_single_simulation(
    *,
    seed: int,
    users: int,
    trades: int,
    option_count: int,
    attempt_multiplier: int,
    title: str,
    log_file: str,
    mode: str,
    close_minutes: int,
    compact: bool = False,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    random.seed(seed)

    app = create_app()
    client = app.test_client()
    log_path = Path(log_file) if log_file and not compact else None
    if log_path is not None:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        if log_path.exists():
            log_path.unlink()

    def emit(entry: dict[str, Any]) -> None:
        if log_path is None:
            return
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, sort_keys=True, default=str) + "\n")

    def call(method: str, path: str, *, headers: dict[str, str] | None = None, body: dict[str, Any] | None = None):
        started = time.perf_counter()
        kwargs: dict[str, Any] = {"headers": headers or {}}
        if body is not None:
            kwargs["json"] = body
        response = client.open(path, method=method, **kwargs)
        elapsed_ms = round((time.perf_counter() - started) * 1000.0, 2)
        return response, elapsed_ms

    try:
        now_ms = int(now_utc().timestamp() * 1000)
        admin_transact(
            [
                [
                    "update",
                    "platform_state",
                    PLATFORM_STATE_ID,
                    {
                        "id": PLATFORM_STATE_ID,
                        "reserveBalance": DEFAULT_RESERVE,
                        "feeBalance": 0.0,
                        "createdAt": now_ms,
                        "updatedAt": now_ms,
                    },
                ]
            ]
        )
    except Exception as exc:
        raise SystemExit(f"failed to reset platform state: {exc}")

    admin_headers = {"X-Dev-User-Id": "dev_admin", "X-Dev-User-Name": "Admin"}
    labels = option_labels(option_count)
    options = [{"label": label, "price": round(100.0 / option_count, 2)} for label in labels]
    market_start = now_utc() - timedelta(minutes=1)
    market_close = market_start + timedelta(minutes=close_minutes)
    create_res, create_ms = call(
        "POST",
        "/api/markets",
        headers=admin_headers,
        body={
            "title": title,
            "rules": "Simulation market for algorithm testing.",
            "start": format_iso(market_start),
            "close": format_iso(market_close),
            "options": options,
        },
    )
    create_json = read_json(create_res)
    if not is_ok(create_res):
        emit({"type": "market_create_failed", "status": create_res.status_code, "elapsed_ms": create_ms, "response": create_json})
        raise SystemExit(f"failed to create market: {create_json}")

    market = create_json.get("market") or create_json
    market_id = str(market.get("id"))
    emit({"type": "market_created", "elapsed_ms": create_ms, "market": market})

    user_ids = [f"sim_user_{idx:04d}" for idx in range(1, users + 1)]
    user_names = {user_id: user_id.replace("_", " ").title() for user_id in user_ids}
    wallets = {user_id: STARTING_WALLET for user_id in user_ids}
    positions: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    trade_rows: list[dict[str, Any]] = []

    successful_trades = 0
    attempts = 0
    rejected_trades = 0
    risk_rejections = 0
    cumulative_sell_fees = 0.0
    cumulative_fee_balance = 0.0
    max_risk_pressure = float(market.get("risk_pressure") or 0.0)
    max_worst_case_loss = float(market.get("worst_case_loss") or 0.0)
    current_market = market
    current_reserve = float(create_json.get("reserve_balance") or DEFAULT_RESERVE)
    mode = trade_mode(mode)
    close_window_seconds = max(1, close_minutes * 60)

    def append_trade_row(
        *,
        action: str,
        status: str,
        user_id: str,
        user_name: str,
        option: dict[str, Any],
        quantity: float,
        trade_index: int,
        attempt_index: int,
        elapsed_ms: float,
        wallet_before: float,
        reserve_before: float,
        market_before: dict[str, Any],
        response: dict[str, Any],
        request_body: dict[str, Any],
    ) -> None:
        trade = response.get("trade") or {}
        market_after = response.get("market") or market_before
        executed_price = float(trade.get("price") or option.get("ask_price") or option.get("bid_price") or option.get("current_price") or 0.0)
        gross_amount = float(trade.get("amount") or (executed_price * quantity) or 0.0)
        fee = float(trade.get("fee") or 0.0)
        fee_rate = float(trade.get("feeRate") or (fee / gross_amount if gross_amount > 0 else 0.0))
        estimate = estimate_win_loss(
            market=market_before,
            option_id=str(option.get("id") or ""),
            quantity=quantity,
            executed_price=executed_price,
        )
        wallet_after = float(response.get("wallet_balance") or wallet_before)
        reserve_after = float(response.get("reserve_balance") or reserve_before)
        audit = build_trade_audit_snapshot(
            market_before=market_before,
            market_after=market_after,
            wallet_before=wallet_before,
            wallet_after=wallet_after,
            reserve_before=reserve_before,
            reserve_after=reserve_after,
            gross_amount=gross_amount,
            fee=fee,
            fee_rate=fee_rate,
            trade_cost=gross_amount,
            timestamp=trade.get("timestamp") or request_body.get("t"),
        )
        trade_rows.append(
            {
                "run_mode": mode,
                "seed": seed,
                "market_id": market_id,
                "market_title": title,
                "trade_index": trade_index,
                "attempt_index": attempt_index,
                "elapsed_ms": elapsed_ms,
                "user_id": user_id,
                "user_name": user_name,
                "action": action,
                "status": status,
                "option_id": str(option.get("id") or ""),
                "option_label": option.get("label"),
                "quantity": quantity,
                "ask_price": float(option.get("ask_price") or option.get("current_price") or 0.0),
                "bid_price": float(option.get("bid_price") or option.get("current_price") or 0.0),
                "executed_price": executed_price,
                "gross_amount": money(gross_amount),
                "fee_rate": round(fee_rate, 4),
                "fee": money(fee),
                "fee_amount": money(fee),
                "net_amount": money(gross_amount + fee if action == "buy" else gross_amount - fee),
                "estimated_resolve_fee_rate": estimate["estimated_resolve_fee_rate"],
                "estimated_resolve_price": estimate["estimated_resolve_price"],
                "estimated_win_pnl": estimate["estimated_win_pnl"],
                "estimated_loss_pnl": estimate["estimated_loss_pnl"],
                "wallet_before": money(wallet_before),
                "wallet_after": money(wallet_after),
                "wallet_delta": money(wallet_after - wallet_before),
                "reserve_before": money(reserve_before),
                "reserve_after": money(reserve_after),
                "cash_before": money(wallet_before),
                "cash_after": money(wallet_after),
                "cash_collected_after": money(float(market_after.get("cash_collected") or 0.0)),
                "risk_pressure_after": round(float(market_after.get("risk_pressure") or 0.0), 6),
                "worst_case_loss_after": money(float(market_after.get("worst_case_loss") or 0.0)),
                "worst_case_loss_before": money(float(market_before.get("worst_case_loss") or 0.0)),
                "risk_cap": money(float(market_after.get("risk_cap") or market_before.get("risk_cap") or DEFAULT_RESERVE * 0.05)),
                "liquidity_b": round(float(market_after.get("liquidity_b") or market_before.get("liquidity_b") or market_liquidity_b(market_before)), 6),
                "trade_cost": money(gross_amount),
                "liability_after": money(float(option.get("liability") or option.get("exposure") or 0.0)),
                "request_quantity": float(request_body.get("quantity") or 0.0),
                "request_t": request_body.get("t"),
                "error": response.get("error"),
                **audit,
            }
        )

    while successful_trades < trades and attempts < trades * attempt_multiplier:
        attempts += 1
        user_id = random.choice(user_ids)
        headers = {"X-Dev-User-Id": user_id, "X-Dev-User-Name": user_names[user_id]}
        current_options = current_market.get("options") or []
        if not current_options:
            break

        active_positions = positions[user_id]
        held_options = [(opt_id, qty) for opt_id, qty in active_positions.items() if qty > 0]
        action = choose_action(mode, bool(held_options))

        if action == "sell":
            try:
                option_id = choose_sell_option(mode, current_options, held_options)
            except Exception:
                action = "buy"
            else:
                held_qty = float(active_positions.get(option_id, 0.0))
                if held_qty > 0:
                    floor = 5.0 if mode == "adversarial" else 0.1
                    quantity = round(min(held_qty, random.uniform(floor, max(held_qty, floor))), 2)
                    if quantity > 0:
                        option = next((opt for opt in current_options if str(opt.get("id")) == option_id), None)
                        if option is None:
                            action = "buy"
                            continue
                        trade_time = market_start + timedelta(seconds=random.randint(0, close_window_seconds - 1))
                        body = {"option_id": option_id, "quantity": quantity, "t": format_iso(trade_time)}
                        wallet_before = float(wallets[user_id])
                        reserve_before = float(current_reserve)
                        market_before = current_market
                        response, elapsed_ms = call("POST", f"/api/markets/{market_id}/sell", headers=headers, body=body)
                        payload = read_json(response)
                        if is_ok(response):
                            fee = float((payload.get("trade") or {}).get("fee") or 0.0)
                            successful_trades += 1
                            cumulative_sell_fees += fee
                            cumulative_fee_balance += fee
                            wallets[user_id] = float(payload.get("wallet_balance") or wallets[user_id])
                            current_reserve = float(payload.get("reserve_balance") or current_reserve)
                            positions[user_id][option_id] = round(active_positions.get(option_id, 0.0) - quantity, 6)
                            if positions[user_id][option_id] <= 0:
                                positions[user_id].pop(option_id, None)
                            current_market = payload.get("market") or current_market
                            max_risk_pressure = max(max_risk_pressure, float(current_market.get("risk_pressure") or 0.0))
                            max_worst_case_loss = max(max_worst_case_loss, float(current_market.get("worst_case_loss") or 0.0))
                            append_trade_row(
                                action="sell",
                                status="executed",
                                user_id=user_id,
                                user_name=user_names[user_id],
                                option=option,
                                quantity=quantity,
                                trade_index=successful_trades,
                                attempt_index=attempts,
                                elapsed_ms=elapsed_ms,
                                wallet_before=wallet_before,
                                reserve_before=reserve_before,
                                market_before=market_before,
                                response=payload,
                                request_body=body,
                            )
                            emit(
                                {
                                    "type": "trade",
                                    "trade_index": successful_trades,
                                    "attempt_index": attempts,
                                    "action": action,
                                    "elapsed_ms": elapsed_ms,
                                    "user_id": user_id,
                                    "market_id": market_id,
                                    "request": body,
                                    "response": payload,
                                    "market_snapshot": current_market,
                                    "wallet_balance": wallets[user_id],
                                    "positions": dict(positions[user_id]),
                                    "cumulative_sell_fees": money(cumulative_sell_fees),
                                    "cumulative_fee_balance": money(cumulative_fee_balance),
                                }
                            )
                            continue
                        rejected_trades += 1
                        append_trade_row(
                            action="sell",
                            status="rejected",
                            user_id=user_id,
                            user_name=user_names[user_id],
                            option=option,
                            quantity=quantity,
                            trade_index=successful_trades + 1,
                            attempt_index=attempts,
                            elapsed_ms=elapsed_ms,
                            wallet_before=wallet_before,
                            reserve_before=reserve_before,
                            market_before=market_before,
                            response=payload,
                            request_body=body,
                        )
                        emit(
                            {
                                "type": "trade_rejected",
                                "trade_index": successful_trades + 1,
                                "attempt_index": attempts,
                                "action": action,
                                "elapsed_ms": elapsed_ms,
                                "user_id": user_id,
                                "market_id": market_id,
                                "request": body,
                                "status": response.status_code,
                                "response": payload,
                            }
                        )
                        if payload.get("error") not in {"insufficient_position", "invalid_request"}:
                            continue
                        action = "buy"

        if action == "buy":
            option = choose_buy_option(mode, current_options)
            option_id = str(option.get("id"))
            if mode == "adversarial":
                quantity = round(random.uniform(10.0, 40.0), 2)
            elif mode == "mixed" and random.random() < 0.5:
                quantity = round(random.uniform(2.0, 30.0), 2)
            else:
                quantity = round(random.uniform(1.0, 25.0), 2)
            trade_time = market_start + timedelta(seconds=random.randint(0, close_window_seconds - 1))
            body = {"option_id": option_id, "quantity": quantity, "t": format_iso(trade_time)}
            retries = 0
            while retries < 4:
                wallet_before = float(wallets[user_id])
                reserve_before = float(current_reserve)
                market_before = current_market
                response, elapsed_ms = call("POST", f"/api/markets/{market_id}/buy", headers=headers, body=body)
                payload = read_json(response)
                if is_ok(response):
                    successful_trades += 1
                    fee = float((payload.get("trade") or {}).get("fee") or 0.0)
                    wallets[user_id] = float(payload.get("wallet_balance") or wallets[user_id])
                    current_reserve = float(payload.get("reserve_balance") or current_reserve)
                    cumulative_buy_fees += fee
                    cumulative_fee_balance += fee
                    positions[user_id][option_id] = round(active_positions.get(option_id, 0.0) + quantity, 6)
                    current_market = payload.get("market") or current_market
                    max_risk_pressure = max(max_risk_pressure, float(current_market.get("risk_pressure") or 0.0))
                    max_worst_case_loss = max(max_worst_case_loss, float(current_market.get("worst_case_loss") or 0.0))
                    append_trade_row(
                        action="buy",
                        status="executed",
                        user_id=user_id,
                        user_name=user_names[user_id],
                        option=option,
                        quantity=quantity,
                        trade_index=successful_trades,
                        attempt_index=attempts,
                        elapsed_ms=elapsed_ms,
                        wallet_before=wallet_before,
                        reserve_before=reserve_before,
                        market_before=market_before,
                        response=payload,
                        request_body=body,
                    )
                    emit(
                        {
                            "type": "trade",
                            "trade_index": successful_trades,
                            "attempt_index": attempts,
                            "action": action,
                            "elapsed_ms": elapsed_ms,
                            "user_id": user_id,
                            "market_id": market_id,
                            "request": body,
                            "response": payload,
                            "market_snapshot": current_market,
                            "wallet_balance": wallets[user_id],
                            "positions": dict(positions[user_id]),
                            "cumulative_buy_fees": money(cumulative_buy_fees),
                            "cumulative_sell_fees": money(cumulative_sell_fees),
                            "cumulative_fee_balance": money(cumulative_fee_balance),
                        }
                    )
                    break

                rejected_trades += 1
                append_trade_row(
                    action="buy",
                    status="rejected",
                    user_id=user_id,
                    user_name=user_names[user_id],
                    option=option,
                    quantity=quantity,
                    trade_index=successful_trades + 1,
                    attempt_index=attempts,
                    elapsed_ms=elapsed_ms,
                    wallet_before=wallet_before,
                    reserve_before=reserve_before,
                    market_before=market_before,
                    response=payload,
                    request_body=body,
                )
                emit(
                    {
                        "type": "trade_rejected",
                        "trade_index": successful_trades + 1,
                        "attempt_index": attempts,
                        "action": action,
                        "elapsed_ms": elapsed_ms,
                        "user_id": user_id,
                        "market_id": market_id,
                        "request": body,
                        "status": response.status_code,
                        "response": payload,
                    }
                )
                if str(payload.get("error") or "") == "market_risk_cap_reached":
                    risk_rejections += 1
                    emit(
                        {
                            "type": "RISK_REJECT",
                            "market_id": market_id,
                            "user_id": user_id,
                            "option_id": option_id,
                            "required": payload.get("required"),
                            "available": payload.get("available"),
                            "request": body,
                        }
                    )

                error = str(payload.get("error") or "")
                if error in {"market_risk_cap_reached", "insufficient_wallet_balance"}:
                    quantity = round(quantity * 0.5, 2)
                    if quantity < 0.01:
                        break
                    body["quantity"] = quantity
                    retries += 1
                    continue
                break

    final_market_res, final_market_ms = call("GET", f"/api/markets/{market_id}", headers=admin_headers)
    final_market = read_json(final_market_res)
    if not is_ok(final_market_res):
        raise SystemExit(f"failed to load final market: {final_market}")

    final_admin_res, final_admin_ms = call("GET", "/api/admin/users", headers=admin_headers)
    final_admin = read_json(final_admin_res)
    if not is_ok(final_admin_res):
        raise SystemExit(f"failed to load admin audit: {final_admin}")

    scenario_data, resolution_rows = scenario_summary(
        market=final_market,
        current_reserve=current_reserve,
        fee_balance=cumulative_fee_balance,
        wallets=wallets,
        positions={key: dict(value) for key, value in positions.items()},
        start_reserve=DEFAULT_RESERVE,
    )
    for item in scenario_data:
        emit({"type": "scenario", **item})

    close_res, close_ms = call("POST", f"/api/admin/markets/{market_id}/close", headers=admin_headers)
    close_json = read_json(close_res)
    if not is_ok(close_res):
        raise SystemExit(f"failed to close market: {close_json}")

    winner_option = choose_final_winner(mode, (close_json.get("market") or final_market).get("options") or [])
    winning_option_id = str(winner_option.get("id") or "")
    resolve_res, resolve_ms = call(
        "POST",
        f"/api/admin/markets/{market_id}/resolve",
        headers=admin_headers,
        body={"winning_option_id": winning_option_id},
    )
    resolve_json = read_json(resolve_res)
    if not is_ok(resolve_res):
        raise SystemExit(f"failed to resolve market: {resolve_json}")

    payouts = resolve_json.get("payouts") or []
    resolution_fee_total = money(resolve_json.get("resolution_fee_total") or 0.0)
    payout_total = 0.0
    for payout in payouts:
        user_id = str(payout.get("user_id") or "")
        amount = money(payout.get("amount") or 0.0)
        if not user_id:
            continue
        wallets[user_id] = money(wallets.get(user_id, STARTING_WALLET) + amount)
        payout_total += amount

    resolved_market = resolve_json.get("market") or final_market
    current_market = resolved_market
    final_market = resolved_market
    current_reserve = float(resolve_json.get("reserve_balance") or current_reserve)
    cumulative_fee_balance = money(cumulative_fee_balance + resolution_fee_total)
    actual_platform_pnl = money(current_reserve + cumulative_fee_balance - DEFAULT_RESERVE)
    winning_option_label = resolve_json.get("winning_option_label") or winner_option.get("label")

    final_user_rows: list[dict[str, Any]] = []
    for user_id in user_ids:
        final_wallet = money(wallets.get(user_id, STARTING_WALLET))
        user_positions = dict(positions[user_id])
        winning_shares = money(user_positions.get(winning_option_id, 0.0))
        final_user_rows.append(
            {
                "type": "user_final",
                "market_id": market_id,
                "market_title": title,
                "winning_option_id": winning_option_id,
                "winning_option_label": winning_option_label,
                "user_id": user_id,
                "user_name": user_names[user_id],
                "shares_on_winner": winning_shares,
                "wallet_after_close": final_wallet,
                "profit_loss": money(final_wallet - STARTING_WALLET),
                "result": "win" if final_wallet > STARTING_WALLET else ("loss" if final_wallet < STARTING_WALLET else "break_even"),
                "open_positions": user_positions,
            }
        )
    for row in final_user_rows:
        emit(row)
    emit(
        {
            "type": "market_closed",
            "market_id": market_id,
            "market_title": title,
            "close_elapsed_ms": close_ms,
            "closed_market": close_json.get("market") or close_json,
        }
    )
    emit(
        {
            "type": "market_resolved",
            "market_id": market_id,
            "market_title": title,
            "resolve_elapsed_ms": resolve_ms,
            "winning_option_id": winning_option_id,
            "winning_option_label": winning_option_label,
            "resolve_fee_rate": resolve_json.get("resolve_fee_rate"),
            "gross_payout_per_share": resolve_json.get("gross_payout_per_share"),
            "payout_per_share": resolve_json.get("payout_per_share"),
            "resolution_fee_total": resolution_fee_total,
            "payout_total": money(payout_total),
            "platform_pnl_actual": actual_platform_pnl,
            "payouts": payouts,
            "reconciliation": resolve_json.get("reconciliation"),
        }
    )

    market_summary = build_market_summary_record(
        market=final_market,
        trade_rows=trade_rows,
        payouts=payouts,
        resolution_fee_total=resolution_fee_total,
        actual_platform_pnl=actual_platform_pnl,
        reconciliation=resolve_json.get("reconciliation") or {},
        winning_option_id=winning_option_id,
        winning_option_label=winning_option_label,
        risk_rejections=risk_rejections,
    )
    emit({"type": "market_summary", **market_summary})

    platform_pnls = [float(item["platform_pnl"]) for item in scenario_data]
    summary = {
        "type": "summary",
        "market_id": market_id,
        "market_title": final_market.get("title"),
        "seed": seed,
        "mode": mode,
        "users": users,
        "target_trades": trades,
        "successful_trades": successful_trades,
        "attempts": attempts,
        "rejected_trades": rejected_trades,
        "log_file": str(log_path),
        "trade_runtime_ms": {
            "create_market": create_ms,
            "final_market_lookup": final_market_ms,
            "final_admin_lookup": final_admin_ms,
        },
        "start_reserve": DEFAULT_RESERVE,
        "end_reserve": current_reserve,
        "actual_platform_pnl": actual_platform_pnl,
        "winning_option_id": winning_option_id,
        "winning_option_label": winning_option_label,
        "resolution_fee_total": resolution_fee_total,
        "payout_total": money(payout_total),
        "fee_balance": money(cumulative_fee_balance),
        "platform_pnl_if_resolved_now_min": min(platform_pnls) if platform_pnls else 0.0,
        "platform_pnl_if_resolved_now_max": max(platform_pnls) if platform_pnls else 0.0,
        "platform_pnl_if_resolved_now_avg": round(sum(platform_pnls) / len(platform_pnls), 2) if platform_pnls else 0.0,
        "max_risk_pressure_seen": round(max_risk_pressure, 4),
        "max_worst_case_loss_seen": money(max_worst_case_loss),
        "current_market": final_market,
        "user_count_traded": len([user_id for user_id, pos in positions.items() if pos]),
        "admin_users_count": final_admin.get("total_users"),
        "admin_transactions_count": final_admin.get("total_transactions"),
        "market_reserve_cap": money(final_market.get("risk_cap") or (DEFAULT_RESERVE * 0.05)),
        "spread_rate": SPREAD_RATE,
        "fee_range": {"min": MIN_FEE_RATE, "max": MAX_FEE_RATE},
        "balance_delta": money((resolve_json.get("reconciliation") or {}).get("balance_delta") or 0.0),
        "risk_rejections": risk_rejections,
        "reconciliation_delta": money((resolve_json.get("reconciliation") or {}).get("balance_delta") or 0.0),
    }
    if not compact:
        summary["trade_runtime_ms"] = {
            "create_market": create_ms,
            "final_market_lookup": final_market_ms,
            "final_admin_lookup": final_admin_ms,
        }
        summary["current_market"] = final_market
        summary["log_file"] = str(log_path)
        print(json.dumps(summary, indent=2, default=str))
        print(f"JSONL log written to {log_path}")
    else:
        summary["trade_runtime_ms"] = {
            "create_market": create_ms,
            "final_market_lookup": final_market_ms,
            "final_admin_lookup": final_admin_ms,
        }
    emit(summary)
    if compact:
        trade_rows = []
        resolution_rows = []
    return summary, trade_rows, resolution_rows, market_summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Run tester market simulations against the real Flask + Instant backend.")
    parser.add_argument("--users", type=int, default=1000, help="Number of synthetic user accounts to include.")
    parser.add_argument("--trades", type=int, default=300, help="Number of trades per run when not using a range.")
    parser.add_argument("--trades-min", type=int, default=None, help="Minimum trades per run when batching.")
    parser.add_argument("--trades-max", type=int, default=None, help="Maximum trades per run when batching.")
    parser.add_argument("--seed", type=int, default=42, help="Seed for a single run or as the starting seed for batches.")
    parser.add_argument("--seed-start", type=int, default=None, help="Starting seed for batch runs.")
    parser.add_argument("--runs", type=int, default=1, help="How many runs to execute.")
    parser.add_argument("--mode", type=str, default="random", choices=["random", "adversarial", "mixed"], help="Trade selection mode.")
    parser.add_argument("--mode-sequence", type=str, default=None, help="Comma-separated per-run mode sequence, for example random,adversarial,random.")
    parser.add_argument("--stress-profile", type=str, default="normal", choices=["normal", "one-sided", "whale", "forced-outcomes", "adversarial", "long-run"], help="Stress profile to use for the local simulator.")
    parser.add_argument("--stress-profile-sequence", type=str, default=None, help="Comma-separated per-run stress profile sequence, for example one-sided,whale,forced-outcomes,adversarial.")
    parser.add_argument("--whale-size", type=float, default=50000.0, help="Fallback whale order size when using the whale profile.")
    parser.add_argument("--forced-outcome-index", type=int, default=None, help="Force a specific winning option index in the local simulator.")
    parser.add_argument("--output-dir", type=str, default="backend/logs/batch_output", help="Directory where all batch outputs are written.")
    parser.add_argument("--log-file", type=str, default=None, help="Optional per-run base JSONL path. If omitted, files stay inside --output-dir.")
    parser.add_argument("--csv", type=str, default=None, help="Optional path to the merged CSV audit output.")
    parser.add_argument("--title", type=str, default="tester", help="Title to use for the simulated market.")
    parser.add_argument("--option-count", type=int, default=2, choices=[2, 3, 4], help="How many options to create.")
    parser.add_argument("--option-count-min", type=int, default=None, choices=[2, 3, 4], help="Minimum number of options to choose per run.")
    parser.add_argument("--option-count-max", type=int, default=None, choices=[2, 3, 4], help="Maximum number of options to choose per run.")
    parser.add_argument("--close-minutes", type=int, default=MARKET_CLOSE_MINUTES, help="How long each simulated market stays open.")
    parser.add_argument("--attempt-multiplier", type=int, default=4, help="Maximum attempts per successful trade target.")
    parser.add_argument("--parallel", action="store_true", help="Run isolated market simulations in parallel worker processes.")
    parser.add_argument("--audit-report", type=str, default=None, help="Path to the batch audit summary JSON. Defaults inside --output-dir.")
    parser.add_argument("--merged-jsonl", type=str, default=None, help="Path to a single merged JSONL file for the whole batch. Defaults inside --output-dir.")
    parser.add_argument("--compact-output", action="store_true", help="Write only compact batch summaries instead of detailed per-trade logs.")
    args = parser.parse_args()

    runs = max(1, int(args.runs))
    seed_start = args.seed_start if args.seed_start is not None else args.seed
    seeds = [seed_start + idx for idx in range(runs)]
    trade_min = args.trades_min if args.trades_min is not None else args.trades
    trade_max = args.trades_max if args.trades_max is not None else args.trades
    if trade_min > trade_max:
        trade_min, trade_max = trade_max, trade_min
    mode_sequence = [item.strip() for item in (args.mode_sequence or "").split(",") if item.strip()]
    stress_profile_sequence = [item.strip() for item in (args.stress_profile_sequence or "").split(",") if item.strip()]
    option_min = args.option_count_min if args.option_count_min is not None else args.option_count
    option_max = args.option_count_max if args.option_count_max is not None else args.option_count
    if option_min > option_max:
        option_min, option_max = option_max, option_min
    compact_mode = bool(args.compact_output or runs >= 10000)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    jobs = [
        {
            "index": index,
            "seed": run_seed,
            "seed_start": seed_start,
            "trade_min": trade_min,
            "trade_max": trade_max,
            "option_min": option_min,
            "option_max": option_max,
            "mode_sequence": mode_sequence,
            "mode": args.mode,
            "runs": runs,
            "users": args.users,
            "trades": args.trades,
            "attempt_multiplier": args.attempt_multiplier,
            "title": args.title,
            "close_minutes": args.close_minutes,
            "parallel": args.parallel,
            "stress_profile": args.stress_profile,
            "stress_profile_sequence": stress_profile_sequence,
            "whale_size": args.whale_size,
            "forced_outcome_index": args.forced_outcome_index,
            "output_dir": str(output_dir),
            "compact": compact_mode,
        }
        for index, run_seed in enumerate(seeds, start=1)
    ]

    if compact_mode:
        market_summaries_path = output_dir / "market_summaries.jsonl"
        market_summaries_path.parent.mkdir(parents=True, exist_ok=True)
        pnls: list[float] = []
        balance_deltas: list[float] = []
        risk_rejections_total = 0
        reconciliation_failures = 0
        cap_violations = 0
        best_market: dict[str, Any] | None = None
        worst_market: dict[str, Any] | None = None
        samples: list[dict[str, Any]] = []

        if args.parallel and runs > 1:
            executor_ctx = ProcessPoolExecutor(max_workers=min(runs, os.cpu_count() or 1), mp_context=mp.get_context("spawn"))
            result_iter = executor_ctx.map(execute_simulation_job, jobs)
        else:
            executor_ctx = None
            result_iter = (execute_simulation_job(job) for job in jobs)

        try:
            with market_summaries_path.open("w", encoding="utf-8") as market_handle:
                for index, result in enumerate(result_iter, start=1):
                    summary, _trade_rows, _resolution_rows, market_summary, run_trades, run_mode, run_option_count = result
                    pnl = float(summary.get("actual_platform_pnl") or 0.0)
                    balance_delta = float(summary.get("balance_delta") or 0.0)
                    pnls.append(pnl)
                    balance_deltas.append(balance_delta)
                    risk_rejections_total += int(summary.get("risk_rejections") or 0)
                    if abs(balance_delta) > 0.01:
                        reconciliation_failures += 1
                    if max(0.0, -pnl) > float(summary.get("market_reserve_cap") or 0.0) + 0.01 or float(summary.get("max_worst_case_loss_seen") or 0.0) > float(summary.get("market_reserve_cap") or 0.0) + 0.01:
                        cap_violations += 1
                    compact_market = {
                        "run_index": index,
                        "seed": summary.get("seed"),
                        "mode": summary.get("mode"),
                        "option_count": summary.get("option_count"),
                        "market_id": summary.get("market_id"),
                        "market_title": summary.get("market_title"),
                        "actual_platform_pnl": pnl,
                        "actual_loss": float(market_summary.get("actual_loss") or 0.0),
                        "actual_loss_ratio": float(market_summary.get("actual_loss_ratio") or 0.0),
                        "worst_case_loss": float(market_summary.get("worst_case_loss") or 0.0),
                        "balance_delta": balance_delta,
                        "risk_rejections": int(summary.get("risk_rejections") or 0),
                        "winner_count": market_summary.get("winner_count"),
                        "loser_count": market_summary.get("loser_count"),
                        "buy_volume": market_summary.get("buy_volume"),
                        "sell_volume": market_summary.get("sell_volume"),
                        "avg_trade_cost": market_summary.get("avg_trade_cost"),
                        "max_trade_size": market_summary.get("max_trade_size"),
                        "fees_collected": market_summary.get("fees_collected"),
                        "risk_cap": market_summary.get("risk_cap"),
                        "winner_payout": market_summary.get("winner_payout"),
                        "winning_option": market_summary.get("winning_option"),
                        "reconciliation_delta": market_summary.get("reconciliation_delta"),
                    }
                    market_handle.write(json.dumps(compact_market, sort_keys=True, default=str) + "\n")
                    samples.append(compact_market)
                    if best_market is None or pnl > float(best_market.get("actual_platform_pnl") or 0.0):
                        best_market = compact_market
                    if worst_market is None or pnl < float(worst_market.get("actual_platform_pnl") or 0.0):
                        worst_market = compact_market
        finally:
            if executor_ctx is not None:
                executor_ctx.shutdown()

        def percentile(values: list[float], p: float) -> float:
            if not values:
                return 0.0
            if len(values) == 1:
                return round(values[0], 2)
            ordered = sorted(values)
            idx = int(round(p * (len(ordered) - 1)))
            idx = max(0, min(len(ordered) - 1, idx))
            return round(ordered[idx], 2)

        batch_report = {
            "runs": runs,
            "seed_start": seed_start,
            "trade_range": [trade_min, trade_max],
            "mode": args.mode,
            "mode_sequence": mode_sequence,
            "compact_output": True,
            "output_files_limit": 5,
            "stress_profile_sequence": stress_profile_sequence,
            "audit_report": str(Path(args.audit_report) if args.audit_report else output_dir / "audit_report.json"),
            "market_summaries_file": str(market_summaries_path),
            "log_files": [],
            "avg_end_reserve": DEFAULT_RESERVE,
            "actual_platform_pnl_avg": round(sum(pnls) / len(pnls), 2) if pnls else 0.0,
            "actual_platform_pnl_median": round(statistics.median(pnls), 2) if pnls else 0.0,
            "actual_platform_pnl_p5": percentile(pnls, 0.05),
            "actual_platform_pnl_p95": percentile(pnls, 0.95),
            "actual_platform_pnl_min": min(pnls) if pnls else 0.0,
            "actual_platform_pnl_max": max(pnls) if pnls else 0.0,
            "balance_delta_zero": sum(1 for d in balance_deltas if abs(d) <= 0.01),
            "balance_delta_nonzero": sum(1 for d in balance_deltas if abs(d) > 0.01),
            "balance_delta_min": min(balance_deltas) if balance_deltas else 0.0,
            "balance_delta_max": max(balance_deltas) if balance_deltas else 0.0,
            "risk_rejections": risk_rejections_total,
            "reconciliation_failures": reconciliation_failures,
            "cap_violations": cap_violations,
            "market_summaries_sample": samples[:50],
            "best_market": best_market,
            "worst_market": worst_market,
            "audit_rows": len(samples),
        }
        extremes_path = output_dir / "extremes.json"
        extremes_path.parent.mkdir(parents=True, exist_ok=True)
        with (Path(args.audit_report) if args.audit_report else output_dir / "audit_report.json").open("w", encoding="utf-8") as handle:
            json.dump(batch_report, handle, indent=2, sort_keys=True, default=str)
            handle.write("\n")
        with extremes_path.open("w", encoding="utf-8") as handle:
            json.dump({"best_market": best_market, "worst_market": worst_market, "sample": samples[:50]}, handle, indent=2, sort_keys=True, default=str)
            handle.write("\n")
        print(json.dumps(batch_report, indent=2, default=str))
        print(f"Audit report written to {Path(args.audit_report) if args.audit_report else output_dir / 'audit_report.json'}")
        print(f"Market summaries written to {market_summaries_path}")
        print(f"Extremes written to {extremes_path}")
        return 0

    if args.parallel and runs > 1:
        with ProcessPoolExecutor(max_workers=min(runs, os.cpu_count() or 1), mp_context=mp.get_context("spawn")) as executor:
            ordered_results = list(executor.map(execute_simulation_job, jobs))
    else:
        ordered_results = [execute_simulation_job(job) for job in jobs]

    if compact_mode:
        pnls: list[float] = []
        balance_deltas: list[float] = []
        market_summaries: list[dict[str, Any]] = []
        best_market: dict[str, Any] | None = None
        worst_market: dict[str, Any] | None = None
        risk_rejections_total = 0
        reconciliation_failures = 0
        cap_violations = 0
        for index, result in enumerate(ordered_results, start=1):
            summary, _trade_rows, _resolution_rows, market_summary, run_trades, run_mode, run_option_count = result
            pnl = float(summary.get("actual_platform_pnl") or 0.0)
            balance_delta = float(summary.get("balance_delta") or 0.0)
            pnls.append(pnl)
            balance_deltas.append(balance_delta)
            risk_rejections_total += int(summary.get("risk_rejections") or 0)
            if abs(balance_delta) > 0.01:
                reconciliation_failures += 1
            if max(0.0, -pnl) > float(summary.get("market_reserve_cap") or 0.0) + 0.01 or float(summary.get("max_worst_case_loss_seen") or 0.0) > float(summary.get("market_reserve_cap") or 0.0) + 0.01:
                cap_violations += 1
            compact_market = {
                "run_index": index,
                "seed": summary.get("seed"),
                "mode": summary.get("mode"),
                "option_count": summary.get("option_count"),
                "market_id": summary.get("market_id"),
                "market_title": summary.get("market_title"),
                "actual_platform_pnl": pnl,
                "balance_delta": balance_delta,
                "risk_rejections": int(summary.get("risk_rejections") or 0),
                "winner_count": market_summary.get("winner_count"),
                "loser_count": market_summary.get("loser_count"),
                "buy_volume": market_summary.get("buy_volume"),
                "sell_volume": market_summary.get("sell_volume"),
                "avg_trade_cost": market_summary.get("avg_trade_cost"),
                "max_trade_size": market_summary.get("max_trade_size"),
                "fees_collected": market_summary.get("fees_collected"),
                "worst_case_loss": market_summary.get("worst_case_loss"),
                "risk_cap": market_summary.get("risk_cap"),
                "winner_payout": market_summary.get("winner_payout"),
                "winning_option": market_summary.get("winning_option"),
                "reconciliation_delta": market_summary.get("reconciliation_delta"),
            }
            market_summaries.append(compact_market)
            if best_market is None or pnl > float(best_market.get("actual_platform_pnl") or 0.0):
                best_market = compact_market
            if worst_market is None or pnl < float(worst_market.get("actual_platform_pnl") or 0.0):
                worst_market = compact_market

        def percentile(values: list[float], p: float) -> float:
            if not values:
                return 0.0
            if len(values) == 1:
                return round(values[0], 2)
            ordered = sorted(values)
            idx = int(round(p * (len(ordered) - 1)))
            idx = max(0, min(len(ordered) - 1, idx))
            return round(ordered[idx], 2)

        batch_report = {
            "runs": runs,
            "seed_start": seed_start,
            "trade_range": [trade_min, trade_max],
            "mode": args.mode,
            "mode_sequence": mode_sequence,
            "compact_output": True,
            "output_files_limit": 5,
            "stress_profile_sequence": stress_profile_sequence,
            "audit_report": str(Path(args.audit_report) if args.audit_report else output_dir / "audit_report.json"),
            "log_files": [],
            "avg_end_reserve": DEFAULT_RESERVE,
            "actual_platform_pnl_avg": round(sum(pnls) / len(pnls), 2) if pnls else 0.0,
            "actual_platform_pnl_median": round(statistics.median(pnls), 2) if pnls else 0.0,
            "actual_platform_pnl_p5": percentile(pnls, 0.05),
            "actual_platform_pnl_p95": percentile(pnls, 0.95),
            "actual_platform_pnl_min": min(pnls) if pnls else 0.0,
            "actual_platform_pnl_max": max(pnls) if pnls else 0.0,
            "balance_delta_zero": sum(1 for d in balance_deltas if abs(d) <= 0.01),
            "balance_delta_nonzero": sum(1 for d in balance_deltas if abs(d) > 0.01),
            "balance_delta_min": min(balance_deltas) if balance_deltas else 0.0,
            "balance_delta_max": max(balance_deltas) if balance_deltas else 0.0,
            "risk_rejections": risk_rejections_total,
            "reconciliation_failures": reconciliation_failures,
            "cap_violations": cap_violations,
            "market_summaries_sample": market_summaries[:50],
            "best_market": best_market,
            "worst_market": worst_market,
            "audit_rows": len(market_summaries),
        }
        extremes_path = output_dir / "extremes.json"
        extremes_path.parent.mkdir(parents=True, exist_ok=True)
        with (Path(args.audit_report) if args.audit_report else output_dir / "audit_report.json").open("w", encoding="utf-8") as handle:
            json.dump(batch_report, handle, indent=2, sort_keys=True, default=str)
            handle.write("\n")
        with extremes_path.open("w", encoding="utf-8") as handle:
            json.dump({"best_market": best_market, "worst_market": worst_market, "sample": market_summaries[:50]}, handle, indent=2, sort_keys=True, default=str)
            handle.write("\n")
        print(json.dumps(batch_report, indent=2, default=str))
        print(f"Audit report written to {Path(args.audit_report) if args.audit_report else output_dir / 'audit_report.json'}")
        print(f"Extremes written to {extremes_path}")
        return 0

    summaries: list[dict[str, Any]] = []
    all_audit_rows: list[dict[str, Any]] = []
    for index, result in enumerate(ordered_results, start=1):
        summary, trade_rows, resolution_rows, market_summary, run_trades, run_mode, run_option_count = result
        summaries.append(summary)
        all_audit_rows.append({"row_type": "summary", **summary})
        all_audit_rows.append({"row_type": "market_summary", **market_summary})
        for row in trade_rows:
            row["run_index"] = index
            row["trades_planned"] = run_trades
            row["mode"] = run_mode
            row["option_count"] = run_option_count
            row["row_type"] = "trade"
            all_audit_rows.append(row)
        for row in resolution_rows:
            row["run_index"] = index
            row["trades_planned"] = run_trades
            row["mode"] = run_mode
            row["option_count"] = run_option_count
            row["row_type"] = "resolution"
            all_audit_rows.append(row)

    csv_path = Path(args.csv) if args.csv else None
    merged_jsonl_path = Path(args.merged_jsonl) if args.merged_jsonl else output_dir / "merged.jsonl"
    fieldnames = [
        "row_type",
        "run_index",
        "seed",
        "mode",
        "option_count",
        "market_id",
        "market_title",
        "users",
        "trades_planned",
        "successful_trades",
        "attempts",
        "rejected_trades",
        "start_reserve",
        "start_fee_balance",
        "start_total_balance",
        "end_reserve",
        "end_fee_balance",
        "end_total_balance",
        "fee_balance",
        "trades",
        "winner_count",
        "loser_count",
        "buy_volume",
        "sell_volume",
        "avg_trade_cost",
        "max_trade_size",
        "fees_collected",
        "cash_collected",
        "worst_case_loss",
        "risk_cap",
        "winner_payout",
        "actual_platform_loss",
        "reconciliation_delta",
        "winning_option",
        "buy_cash_in",
        "sell_cash_out",
        "sell_fees",
        "resolution_fees",
        "winner_payouts",
        "expected_end_total",
        "balance_delta",
        "platform_pnl_if_resolved_now_min",
        "platform_pnl_if_resolved_now_max",
        "platform_pnl_if_resolved_now_avg",
        "max_risk_pressure_seen",
        "max_worst_case_loss_seen",
        "market_reserve_cap",
        "spread_rate",
        "run_mode",
        "trade_index",
        "attempt_index",
        "elapsed_ms",
        "user_id",
        "user_name",
        "action",
        "status",
        "option_id",
        "option_label",
        "quantity",
        "ask_price",
        "bid_price",
        "executed_price",
        "gross_amount",
        "fee_rate",
        "fee",
        "fee_amount",
        "net_amount",
        "trade_cost",
        "cash_before",
        "cash_after",
        "wallet_before",
        "wallet_after",
        "wallet_delta",
        "reserve_before",
        "reserve_after",
        "cash_collected_after",
        "risk_pressure_after",
        "worst_case_loss_before",
        "worst_case_loss_after",
        "liquidity_b",
        "liability_after",
        "request_quantity",
        "request_t",
        "error",
        "invariant",
        "winning_option_id",
        "winning_option_label",
        "shares",
        "resolve_fee_rate",
        "gross_resolve_price",
        "resolve_price",
        "payout",
        "gross_payout",
        "resolution_fee_amount",
        "pnl",
        "outcome",
        "actual_platform_pnl",
        "resolution_fee_total",
        "payout_total",
    ]
    if csv_path is not None:
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in all_audit_rows:
                writer.writerow({field: row.get(field) for field in fieldnames})

    merged_report = None

    pnls = [float(s.get("actual_platform_pnl") or 0.0) for s in summaries]
    balance_deltas = [float(s.get("balance_delta") or 0.0) for s in summaries]
    risk_rejections_total = sum(int(s.get("risk_rejections") or 0) for s in summaries)
    reconciliation_failures = sum(1 for delta in balance_deltas if abs(delta) > 0.01)
    cap_violations = sum(
        1
        for s in summaries
        if max(0.0, -float(s.get("actual_platform_pnl") or 0.0)) > float(s.get("market_reserve_cap") or 0.0) + 0.01
        or float(s.get("max_worst_case_loss_seen") or 0.0) > float(s.get("market_reserve_cap") or 0.0) + 0.01
    )

    def percentile(values: list[float], p: float) -> float:
        if not values:
            return 0.0
        if len(values) == 1:
            return round(values[0], 2)
        ordered = sorted(values)
        idx = int(round(p * (len(ordered) - 1)))
        idx = max(0, min(len(ordered) - 1, idx))
        return round(ordered[idx], 2)

    batch_report = {
        "runs": runs,
        "seed_start": seed_start,
        "trade_range": [trade_min, trade_max],
        "mode": args.mode,
            "mode_sequence": mode_sequence,
            "stress_profile_sequence": stress_profile_sequence,
            "csv": str(csv_path) if csv_path is not None else None,
        "audit_report": str(Path(args.audit_report) if args.audit_report else output_dir / "audit_report.json"),
        "log_files": [summary.get("log_file") for summary in summaries],
        "avg_end_reserve": round(sum(float(s["end_reserve"]) for s in summaries) / len(summaries), 2) if summaries else 0.0,
        "actual_platform_pnl_avg": round(sum(pnls) / len(pnls), 2) if pnls else 0.0,
        "actual_platform_pnl_median": round(statistics.median(pnls), 2) if pnls else 0.0,
        "actual_platform_pnl_p5": percentile(pnls, 0.05),
        "actual_platform_pnl_p95": percentile(pnls, 0.95),
        "actual_platform_pnl_min": min(pnls) if pnls else 0.0,
        "actual_platform_pnl_max": max(pnls) if pnls else 0.0,
        "balance_delta_zero": sum(1 for d in balance_deltas if abs(d) <= 0.01),
        "balance_delta_nonzero": sum(1 for d in balance_deltas if abs(d) > 0.01),
        "balance_delta_min": min(balance_deltas) if balance_deltas else 0.0,
        "balance_delta_max": max(balance_deltas) if balance_deltas else 0.0,
        "risk_rejections": risk_rejections_total,
        "reconciliation_failures": reconciliation_failures,
        "cap_violations": cap_violations,
        "audit_rows": len(all_audit_rows),
    }
    merged_report = {"type": "batch_report", **batch_report}
    if merged_jsonl_path is not None:
        merged_jsonl_path.parent.mkdir(parents=True, exist_ok=True)
        with merged_jsonl_path.open("w", encoding="utf-8") as handle:
            for row in all_audit_rows:
                handle.write(json.dumps(row, sort_keys=True, default=str) + "\n")
            handle.write(json.dumps(merged_report, sort_keys=True, default=str) + "\n")
    audit_report_path = Path(args.audit_report) if args.audit_report else output_dir / "audit_report.json"
    audit_report_path.parent.mkdir(parents=True, exist_ok=True)
    with audit_report_path.open("w", encoding="utf-8") as handle:
        json.dump(batch_report, handle, indent=2, sort_keys=True, default=str)
        handle.write("\n")
    print(json.dumps(batch_report, indent=2, default=str))
    print(f"Audit report written to {audit_report_path}")
    if merged_jsonl_path is not None:
        print(f"Merged JSONL written to {merged_jsonl_path}")
    if csv_path is not None:
        print(f"Audit CSV written to {csv_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
