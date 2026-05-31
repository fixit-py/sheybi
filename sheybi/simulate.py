from __future__ import annotations

from datetime import datetime, timedelta, timezone

from market import Market, Side


def main() -> None:
    start = datetime.now(timezone.utc)
    close = start + timedelta(hours=2)
    m = Market(start=start, close=close)

    def show(label: str) -> None:
        print(
            f"{label:>10}  p_yes={m.displayed_probability(t):.4f}  conf={m.confidence(t):.3f}  escrow={m.escrow:.0f}  revenue={m.revenue:.0f}"
        )

    t = start
    show("init")

    t1 = start + timedelta(minutes=1)
    t = t1
    m.buy("alice", Side.YES, t, 5_000)
    m.buy("bob", Side.NO, t, 5_000)
    show("early")

    t2 = start + timedelta(minutes=60)
    t = t2
    m.buy("carol", Side.YES, t, 50_000)
    show("mid")

    # Alice partially exits later; she should not get the same "price" she entered at.
    t2b = start + timedelta(minutes=75)
    t = t2b
    alice_yes = m.yes_shares.get("alice", 0.0)
    payout = m.sell("alice", Side.YES, t, alice_yes * 0.50)
    print(f" alice_sell payout={payout:.0f}")
    show("alice_out")

    # Push odds to something extreme, then try a whale late on the heavy favorite
    t3 = close - timedelta(minutes=2)
    for _ in range(6):
        t = t3 - timedelta(minutes=10)
        m.buy("crowd", Side.YES, t, 30_000)
    show("prelate")

    t = t3
    m.buy("whale", Side.YES, t, 500_000)
    show("whale_in")

    payouts = m.resolve(Side.YES)
    whale_payout = payouts.get("whale", 0.0)
    print(f"\nwhale_payout={whale_payout:.0f}  whale_net={(whale_payout - 500_000):.0f}")


if __name__ == "__main__":
    main()

 curl -s -X POST http://localhost:8000/api/markets -H 'Content-Type:application/json' -d '{"start":"2026-05-28T12:00:00Z","close":"2026-05-28T14:00:00Z"}' | python3 -m json.tool