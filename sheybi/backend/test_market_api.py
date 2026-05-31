import unittest
from datetime import datetime, timedelta, timezone

from backend.app import create_app


class TestMarketAPI(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = self.app.test_client()

    def test_create_buy_sell_resolve(self):
        start = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
        close = start + timedelta(hours=2)

        r = self.client.post(
            "/api/markets",
            json={"start": start.isoformat().replace("+00:00", "Z"), "close": close.isoformat().replace("+00:00", "Z")},
        )
        self.assertEqual(r.status_code, 201)
        market_id = r.get_json()["id"]

        r = self.client.post(
            f"/api/markets/{market_id}/buy",
            json={"user": "alice", "side": "YES", "amount": 5000, "t": (start + timedelta(minutes=1)).isoformat()},
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("state", r.get_json())

        r = self.client.post(
            f"/api/markets/{market_id}/buy",
            json={"user": "bob", "side": "NO", "amount": 5000, "t": (start + timedelta(minutes=2)).isoformat()},
        )
        self.assertEqual(r.status_code, 200)

        # Sell some shares (we don't know exact share balance, but large sells should be rejected).
        r = self.client.post(
            f"/api/markets/{market_id}/sell",
            json={"user": "alice", "side": "YES", "shares": 1.0, "t": (start + timedelta(minutes=10)).isoformat()},
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("payout", r.get_json())

        r = self.client.post(f"/api/markets/{market_id}/resolve", json={"outcome": "YES"})
        self.assertEqual(r.status_code, 200)
        payouts = r.get_json()["payouts"]
        self.assertIsInstance(payouts, dict)


if __name__ == "__main__":
    unittest.main()

