from __future__ import annotations

import argparse
import math
import random
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from market import Market, Side


@dataclass(frozen=True)
class UserSummary:
    spent: float
    received: float

    @property
    def net(self) -> float:
        return self.received - self.spent


def clamp01(x: float) -> float:
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


def lognormal_amount(rng: random.Random, min_amount: float, sigma: float) -> float:
    return max(min_amount, min_amount * math.exp(rng.gauss(0.0, sigma)))


def sample_time(rng: random.Random, start: datetime, close: datetime) -> datetime:
    span = (close - start).total_seconds()
    return start + timedelta(seconds=rng.random() * span)


def run_one(
    rng: random.Random,
    *,
    players: int,
    duration_minutes: int,
    events_min: int,
    events_max: int,
    min_bet: float,
    true_p_yes: float,
    whale_fraction: float,
    verbose: bool,
) -> dict:
    start = datetime.now(timezone.utc)
    close = start + timedelta(minutes=duration_minutes)
    market = Market(start=start, close=close)

    user_ids = [f"p{i}" for i in range(players)]
    whales = set(rng.sample(user_ids, k=max(0, min(players, int(players * whale_fraction)))))

    spent = defaultdict(float)
    received = defaultdict(float)
    events: list[dict] = []
    first_buy_at: dict[str, datetime] = {}
    seen_buy_logged: set[str] = set()

    def log(**e) -> None:
        if verbose:
            events.append(e)

    event_count = rng.randint(events_min, events_max)

    for _ in range(event_count):
        user = rng.choice(user_ids)
        t = sample_time(rng, start, close)

        # Decide buy vs sell.
        has_yes = market.yes_shares.get(user, 0.0) > 0
        has_no = market.no_shares.get(user, 0.0) > 0
        can_sell = has_yes or has_no
        do_sell = can_sell and (user in first_buy_at) and (rng.random() < 0.30)

        if do_sell:
            # Enforce causal time: a sell can't occur before the user's first buy time.
            fb = first_buy_at[user]
            if t < fb:
                t = fb + timedelta(seconds=rng.randint(1, 60))
            if has_yes and (not has_no or rng.random() < 0.5):
                side = Side.YES
                owned = market.yes_shares[user]
            else:
                side = Side.NO
                owned = market.no_shares[user]

            shares = owned * rng.uniform(0.1, 1.0)
            owned_before = owned
            payout = market.sell(user, side, t, shares)
            owned_after = market.yes_shares[user] if side == Side.YES else market.no_shares[user]
            received[user] += payout
            log(
                t=t,
                user=user,
                action="SELL",
                side=side.value,
                amount=payout,
                shares=shares,
                owned_before=owned_before,
                owned_after=owned_after,
                first_buy=first_buy_at.get(user),
            )
            if verbose and user not in seen_buy_logged:
                # This should not happen; emit a diagnostic marker in the log.
                log(
                    t=t,
                    user=user,
                    action="ERROR_SELL_BEFORE_BUY_LOG",
                    side=side.value,
                    amount=0.0,
                    shares=0.0,
                    owned_before=owned_before,
                    owned_after=owned_after,
                    first_buy=first_buy_at.get(user),
                )
            continue

        # BUY
        belief = clamp01(true_p_yes + rng.gauss(0.0, 0.18 if user not in whales else 0.10))
        p_yes = market.displayed_probability(t)
        side = Side.YES if belief > p_yes else Side.NO

        sigma = 1.0 if user not in whales else 1.5
        amount = lognormal_amount(rng, min_bet, sigma=sigma)
        # Let whales occasionally do very large buys.
        if user in whales and rng.random() < 0.25:
            amount *= rng.uniform(10.0, 100.0)

        market.buy(user, side, t, amount)
        spent[user] += amount
        if user not in first_buy_at:
            first_buy_at[user] = t
        log(t=t, user=user, action="BUY", side=side.value, amount=amount, shares=0.0)
        if verbose:
            seen_buy_logged.add(user)

    outcome = Side.YES if rng.random() < true_p_yes else Side.NO
    payouts = market.resolve(outcome)
    for user, amt in payouts.items():
        received[user] += amt
        log(t=close, user=user, action="RESOLVE_PAYOUT", side=outcome.value, amount=amt, shares=0.0)

    summaries = {
        u: UserSummary(spent=spent[u], received=received[u])
        for u in user_ids
        if spent[u] > 0 or received[u] > 0
    }

    return {
        "start": start,
        "close": close,
        "players": players,
        "whales": len(whales),
        "events": event_count,
        "outcome": outcome.value,
        "p_yes_end": market.displayed_probability(close),
        "confidence_end": market.confidence(close),
        "escrow": market.escrow,
        "revenue": market.revenue,
        "summaries": summaries,
        "event_log": events,
    }


def print_run(run: dict) -> None:
    print(
        f"players={run['players']} whales={run['whales']} events={run['events']} "
        f"outcome={run['outcome']} p_yes_end={run['p_yes_end']:.4f} conf_end={run['confidence_end']:.3f} "
        f"escrow={run['escrow']:.0f} revenue={run['revenue']:.0f}"
    )

    if run["event_log"]:
        start = run["start"]
        print("\nEvent Log (Chronological)")
        for e in sorted(run["event_log"], key=lambda x: x["t"]):
            secs = int((e["t"] - start).total_seconds())
            mins = secs // 60
            rem = secs % 60
            if e["action"] == "SELL":
                fb = e.get("first_buy")
                fb_s = ""
                if fb is not None:
                    fb_secs = int((fb - start).total_seconds())
                    fb_s = f" first_buy=t+{fb_secs//60:>3}m{fb_secs%60:02}s"
                print(
                    f"t+{mins:>3}m{rem:02}s  {e['user']:<5}  SELL  {e['side']:<3}  payout=₦{e['amount']:.0f}"
                    f"  shares {e['owned_before']:.2f}->{e['owned_after']:.2f}{fb_s}"
                )
            elif e["action"] == "BUY":
                print(f"t+{mins:>3}m{rem:02}s  {e['user']:<5}  BUY   {e['side']:<3}  ₦{e['amount']:.0f}")
            elif e["action"] == "ERROR_SELL_BEFORE_BUY_LOG":
                print(f"t+{mins:>3}m{rem:02}s  {e['user']:<5}  !!    {e['side']:<3}  sell logged before buy logged")
            else:
                print(f"t+{mins:>3}m{rem:02}s  {e['user']:<5}  PAY   {e['side']:<3}  ₦{e['amount']:.0f}")

        print("\nEvent Log (Per User)")
        per_user: dict[str, list[dict]] = defaultdict(list)
        for e in run["event_log"]:
            per_user[e["user"]].append(e)

        for user in sorted(per_user.keys()):
            print(f"\n{user}")
            for e in sorted(per_user[user], key=lambda x: x["t"]):
                secs = int((e["t"] - start).total_seconds())
                mins = secs // 60
                rem = secs % 60
                if e["action"] == "SELL":
                    print(
                        f"  t+{mins:>3}m{rem:02}s  SELL {e['side']:<3}  payout=₦{e['amount']:.0f}"
                        f"  shares {e['owned_before']:.2f}->{e['owned_after']:.2f}"
                    )
                elif e["action"] == "BUY":
                    print(f"  t+{mins:>3}m{rem:02}s  BUY  {e['side']:<3}  ₦{e['amount']:.0f}")
                elif e["action"] == "ERROR_SELL_BEFORE_BUY_LOG":
                    print(f"  t+{mins:>3}m{rem:02}s  !!   {e['side']:<3}  sell logged before buy logged")
                else:
                    print(f"  t+{mins:>3}m{rem:02}s  PAY  {e['side']:<3}  ₦{e['amount']:.0f}")

    print("\nPer User Summary")
    rows = sorted(run["summaries"].items(), key=lambda kv: kv[1].net, reverse=True)
    for user, s in rows:
        print(f"{user:<5} spent=₦{s.spent:.0f} received=₦{s.received:.0f} net=₦{s.net:.0f}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=50)
    ap.add_argument("--seed", type=int, default=7)

    ap.add_argument("--players-min", type=int, default=5)
    ap.add_argument("--players-max", type=int, default=100)
    ap.add_argument("--duration-minutes", type=int, default=120)

    ap.add_argument("--events-min", type=int, default=50)
    ap.add_argument("--events-max", type=int, default=600)
    ap.add_argument("--min-bet", type=float, default=500.0)
    ap.add_argument("--true-p-yes", type=float, default=0.5)
    ap.add_argument("--whale-fraction", type=float, default=0.06)

    ap.add_argument("--verbose-runs", type=int, default=1)
    args = ap.parse_args()

    rng = random.Random(args.seed)

    total_players = 0
    total_events = 0
    total_revenue = 0.0
    total_escrow = 0.0

    for i in range(args.runs):
        players = rng.randint(args.players_min, args.players_max)
        run = run_one(
            rng,
            players=players,
            duration_minutes=args.duration_minutes,
            events_min=args.events_min,
            events_max=args.events_max,
            min_bet=args.min_bet,
            true_p_yes=args.true_p_yes,
            whale_fraction=args.whale_fraction,
            verbose=i < args.verbose_runs,
        )

        total_players += run["players"]
        total_events += run["events"]
        total_revenue += run["revenue"]
        total_escrow += run["escrow"]

        if i < args.verbose_runs:
            print(f"\n=== RUN {i} ===")
            print_run(run)

    print(
        f"\nsummary runs={args.runs} avg_players={total_players/args.runs:.1f} "
        f"avg_events={total_events/args.runs:.1f} avg_escrow={total_escrow/args.runs:.0f} avg_revenue={total_revenue/args.runs:.0f}"
    )


if __name__ == "__main__":
    main()
