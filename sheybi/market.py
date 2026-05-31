from __future__ import annotations

import math

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import DefaultDict
from collections import defaultdict


class Side(str, Enum):
    YES = "YES"
    NO = "NO"


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


@dataclass
class TraderProfile:
    # Forecast quality metrics
    accuracy: float = 0.5
    calibration: float = 0.5
    consistency: float = 0.5

    # Financial metrics
    invested: float = 0.0
    returned: float = 0.0
    profit_ratio: float = 0.0

    # Trade history
    trades: int = 0
    correct: int = 0
    incorrect: int = 0

    # Final trust score
    reputation: float = 1.0


@dataclass
class Trade:
    user: str
    side: Side
    amount: float
    timestamp: datetime

    reputation: float
    confidence: float

    weight: float


@dataclass
class Market:
    start: datetime
    close: datetime

    # Platform fees
    base_fee: float = 0.02
    late_fee_cap: float = 0.15
    whale_fee_cap: float = 0.20

    # Time decay coefficient
    decay_lambda: float = 0.01

    # Anti-herding coefficient
    herding_strength: float = 0.5

    # State
    escrow: float = 0.0
    revenue: float = 0.0

    traders: DefaultDict[str, TraderProfile] = field(
        default_factory=lambda: defaultdict(TraderProfile)
    )

    trades: list[Trade] = field(default_factory=list)

    # Shares (for buy/sell + resolution payouts). These are separate from the
    # trade "weight" used for signal extraction / probability estimation.
    yes_shares: DefaultDict[str, float] = field(default_factory=lambda: defaultdict(float))
    no_shares: DefaultDict[str, float] = field(default_factory=lambda: defaultdict(float))
    total_yes_shares: float = 0.0
    total_no_shares: float = 0.0

    resolved: bool = False
    outcome: Side | None = None

    # -------------------------
    # Time Progress
    # -------------------------

    def u(self, now: datetime) -> float:
        total = (self.close - self.start).total_seconds()

        if total <= 0:
            return 1.0

        elapsed = (now - self.start).total_seconds()

        return clamp(elapsed / total, 0.0, 1.0)

    # -------------------------
    # Reputation Engine
    # -------------------------

    def compute_reputation(self, profile: TraderProfile) -> float:

        trade_factor = min(profile.trades / 100.0, 1.0)

        rep = (
            0.35 * profile.accuracy +
            0.25 * profile.consistency +
            0.20 * profile.calibration +
            0.10 * clamp(profile.profit_ratio, 0.0, 1.0) +
            0.10 * trade_factor
        )

        return clamp(rep, 0.1, 2.0)

    def reputation(self, user: str) -> float:
        profile = self.traders[user]
        profile.reputation = self.compute_reputation(profile)
        return profile.reputation

    # -------------------------
    # Probability Engine
    # -------------------------

    def probability_yes(self, now: datetime) -> float:

        yes_weight = 0.0
        no_weight = 0.0

        for trade in self.trades:

            age_hours = max(
                (now - trade.timestamp).total_seconds() / 3600.0,
                0.0
            )

            # Recent trades matter more
            time_decay = math.exp(
                -self.decay_lambda * age_hours
            )

            effective_weight = trade.weight * time_decay

            if trade.side == Side.YES:
                yes_weight += effective_weight
            else:
                no_weight += effective_weight

        total = yes_weight + no_weight

        if total <= 0:
            return 0.5

        return yes_weight / total

    def probability_no(self, now: datetime) -> float:
        return 1.0 - self.probability_yes(now)

    # -------------------------
    # Entropy / Confidence
    # -------------------------

    def entropy(self, now: datetime) -> float:

        p = self.probability_yes(now)

        p = clamp(p, 1e-9, 1 - 1e-9)

        return -(
            p * math.log(p) +
            (1 - p) * math.log(1 - p)
        )

    def confidence(self, now: datetime) -> float:

        if not self.traders:
            return 0.0

        avg_rep = (
            sum(
                self.compute_reputation(p)
                for p in self.traders.values()
            ) / len(self.traders)
        )

        avg_rep = clamp(avg_rep / 2.0, 0.0, 1.0)

        maturity = self.u(now)

        volume_factor = clamp(
            math.log1p(self.escrow) / 12.0,
            0.0,
            1.0
        )

        entropy = self.entropy(now)

        entropy_factor = 1.0 - clamp(
            entropy / math.log(2),
            0.0,
            1.0
        )

        confidence = (
            0.35 * avg_rep +
            0.25 * maturity +
            0.25 * volume_factor +
            0.15 * entropy_factor
        )

        return clamp(confidence, 0.0, 1.0)

    # -------------------------
    # Anti-Herding
    # -------------------------

    def herding_penalty(
        self,
        side: Side,
        now: datetime
    ) -> float:

        p_yes = self.probability_yes(now)

        crowd_alignment = (
            p_yes if side == Side.YES
            else (1.0 - p_yes)
        )

        penalty = 1.0 - (
            self.herding_strength *
            crowd_alignment
        )

        return clamp(penalty, 0.2, 1.0)

    # -------------------------
    # Dynamic Fee System
    # -------------------------

    def fee_rate(
        self,
        now: datetime,
        amount: float
    ) -> float:
        # Platform takes ONLY the base fee. All other dynamic fees are disabled.
        return clamp(self.base_fee, 0.0, 0.90)

    # -------------------------
    # Buy Signal
    # -------------------------

    def buy(
        self,
        user: str,
        side: Side,
        now: datetime,
        amount: float
    ) -> Trade:

        if self.resolved:
            raise ValueError("market resolved")

        if amount <= 0:
            raise ValueError("amount must be positive")

        profile = self.traders[user]

        profile.trades += 1

        fee_rate = self.fee_rate(now, amount)

        fee = amount * fee_rate

        eligible = amount - fee

        self.revenue += fee
        self.escrow += eligible

        rep = self.reputation(user)

        # Log scaling prevents whales
        # Use the pre-fee amount for signal strength / probability so platform
        # fees don't distort the displayed chance.
        normalized_stake = math.log1p(amount)

        # Confidence based on conviction
        market_p = self.probability_yes(now)

        if side == Side.YES:
            conviction = abs(1.0 - market_p)
        else:
            conviction = abs(market_p)

        confidence = clamp(
            conviction * 2.0,
            0.1,
            1.0
        )

        herd_penalty = self.herding_penalty(
            side,
            now
        )

        entropy_penalty = clamp(
            self.entropy(now) / math.log(2),
            0.2,
            1.0
        )

        weight = (
            rep *
            confidence *
            normalized_stake *
            herd_penalty *
            entropy_penalty
        )

        trade = Trade(
            user=user,
            side=side,
            amount=amount,
            timestamp=now,
            reputation=rep,
            confidence=confidence,
            weight=weight
        )

        self.trades.append(trade)

        profile.invested += amount

        # Mint shares at the current displayed probability (entry "price").
        p_yes = self.displayed_probability(now)
        price = p_yes if side == Side.YES else (1.0 - p_yes)
        price = clamp(price, 1e-6, 1.0 - 1e-6)
        shares = eligible / price
        if side == Side.YES:
            self.yes_shares[user] += shares
            self.total_yes_shares += shares
        else:
            self.no_shares[user] += shares
            self.total_no_shares += shares

        return trade

    def sell(
        self,
        user: str,
        side: Side,
        now: datetime,
        shares: float,
    ) -> float:
        """
        Sell shares back for cash at the *current* displayed probability.
        This is not meant to be an on-chain AMM; it's a platform-side exit rule
        for users, priced dynamically by the market signal engine.

        Returns the payout (cash) after fees, bounded by escrow solvency.
        """
        if self.resolved:
            raise ValueError("market resolved")
        if shares <= 0:
            raise ValueError("shares must be positive")

        owned = self.yes_shares[user] if side == Side.YES else self.no_shares[user]
        shares_to_sell = min(shares, owned)
        if shares_to_sell <= 0:
            return 0.0

        p_yes = self.displayed_probability(now)
        price = p_yes if side == Side.YES else (1.0 - p_yes)
        price = clamp(price, 1e-6, 1.0 - 1e-6)
        gross = shares_to_sell * price

        fee_rate = self.fee_rate(now, gross)
        fee = gross * fee_rate
        payout = gross - fee

        payout = min(payout, self.escrow)
        self.escrow -= payout
        self.revenue += fee

        if side == Side.YES:
            self.yes_shares[user] -= shares_to_sell
            self.total_yes_shares -= shares_to_sell
        else:
            self.no_shares[user] -= shares_to_sell
            self.total_no_shares -= shares_to_sell

        self.traders[user].returned += payout
        self.traders[user].trades += 1
        self.traders[user].reputation = self.compute_reputation(self.traders[user])

        return payout

    # -------------------------
    # Resolution
    # -------------------------

    def resolve(
        self,
        outcome: Side
    ) -> dict[str, float]:

        if self.resolved:
            raise ValueError("already resolved")

        self.resolved = True
        self.outcome = outcome

        payouts: dict[str, float] = {}

        # Pay out by shares (not weights) so buy/sell is coherent.
        if outcome == Side.YES:
            total = self.total_yes_shares
            if total <= 0:
                return {}
            pps = self.escrow / total
            for user, s in self.yes_shares.items():
                if s <= 0:
                    continue
                payout = s * pps
                payouts[user] = payout
                self.traders[user].returned += payout
                self.traders[user].correct += 1
        else:
            total = self.total_no_shares
            if total <= 0:
                return {}
            pps = self.escrow / total
            for user, s in self.no_shares.items():
                if s <= 0:
                    continue
                payout = s * pps
                payouts[user] = payout
                self.traders[user].returned += payout
                self.traders[user].correct += 1

        # Mark incorrect for anyone who has net shares on the losing side.
        for user in self.traders.keys():
            if outcome == Side.YES:
                if self.no_shares[user] > 0:
                    self.traders[user].incorrect += 1
            else:
                if self.yes_shares[user] > 0:
                    self.traders[user].incorrect += 1

        # Update reputation metrics
        for user, profile in self.traders.items():

            total_preds = (
                profile.correct +
                profile.incorrect
            )

            if total_preds > 0:
                profile.accuracy = (
                    profile.correct /
                    total_preds
                )

            if profile.invested > 0:

                roi = (
                    profile.returned /
                    profile.invested
                ) - 1.0

                profile.profit_ratio = clamp(
                    max(roi, 0.0),
                    0.0,
                    1.0
                )

            # Consistency metric
            user_trades = [
                t for t in self.trades
                if t.user == user
            ]

            if user_trades:

                yes_count = sum(
                    1 for t in user_trades
                    if t.side == Side.YES
                )

                no_count = len(user_trades) - yes_count

                bias = abs(
                    yes_count - no_count
                ) / len(user_trades)

                profile.consistency = (
                    0.9 * profile.consistency +
                    0.1 * bias
                )

            # Calibration metric
            calibration_score = []

            for t in user_trades:

                predicted_prob = t.confidence

                actual = (
                    1.0
                    if t.side == outcome
                    else 0.0
                )

                error = (
                    predicted_prob - actual
                ) ** 2

                calibration_score.append(error)

            if calibration_score:

                brier = sum(
                    calibration_score
                ) / len(calibration_score)

                profile.calibration = clamp(
                    1.0 - brier,
                    0.0,
                    1.0
                )

            profile.reputation = (
                self.compute_reputation(profile)
            )

        return payouts

    # -------------------------
    # Display Metrics
    # -------------------------

    def displayed_probability(
        self,
        now: datetime
    ) -> float:

        raw_probability = self.probability_yes(now)

        confidence = self.confidence(now)

        # Pull weak markets toward uncertainty
        calibrated = (
            confidence * raw_probability
        ) + (
            (1.0 - confidence) * 0.5
        )

        return clamp(calibrated, 0.0, 1.0)

    def market_state(
        self,
        now: datetime
    ) -> dict:

        chance_yes = self.probability_yes(now)
        chance_yes = clamp(chance_yes, 0.0, 1.0)

        display_yes = self.displayed_probability(now)
        display_yes = clamp(display_yes, 0.0, 1.0)
        if len(self.trades) <= 0:
            # Before the first trade, show clean 50/50-style prices (no fee baked in).
            yes_price_gross = display_yes
            no_price_gross = 1.0 - display_yes
        else:
            fee_rate = self.fee_rate(now, 1.0)
            denom = max(1.0 - fee_rate, 1e-9)

            # "Price" including fees: gross cost per $1 of net exposure.
            yes_price_gross = clamp(display_yes / denom, 0.0, 1.0)
            no_price_gross = clamp((1.0 - display_yes) / denom, 0.0, 1.0)

        return {
            # Raw, pre-calibration chance (not adjusted by confidence).
            "chance_yes": round(chance_yes, 4),
            "chance_no": round(1.0 - chance_yes, 4),

            # Calibrated probability used for UI display/mint pricing.
            "probability_yes": round(display_yes, 4),
            "probability_no": round(1.0 - display_yes, 4),

            # Fee-baked "prices" (what users effectively pay after fees).
            "price_yes": round(yes_price_gross, 4),
            "price_no": round(no_price_gross, 4),

            "confidence": round(
                self.confidence(now),
                4
            ),

            "resolved": self.resolved,
            "outcome": self.outcome.value if self.outcome else None,

            "entropy": round(
                self.entropy(now),
                4
            ),

            "traders": len(self.traders),

            "trades": len(self.trades),
        }
