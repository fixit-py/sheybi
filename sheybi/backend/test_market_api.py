from __future__ import annotations

import os
import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any

import backend.app as app_module
from backend.app import create_app


class FakeInstantStore:
    def __init__(self) -> None:
        self.collections: dict[str, dict[str, dict[str, Any]]] = {
            "markets": {},
            "market_events": {},
            "profiles": {},
            "platform_state": {},
            "platform_ledger": {},
        }

    def _rows(self, collection: str) -> list[dict[str, Any]]:
        return [deepcopy(row) for row in self.collections.get(collection, {}).values()]

    def _match_where(self, row: dict[str, Any], where: dict[str, Any]) -> bool:
        for key, expected in where.items():
            if str(row.get(key)) != str(expected):
                return False
        return True

    def query(self, query: dict[str, Any]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for collection, clause in query.items():
            rows = self._rows(collection)
            if isinstance(clause, dict):
                where = clause.get("$", {}).get("where") if isinstance(clause.get("$"), dict) else None
                if isinstance(where, dict):
                    rows = [row for row in rows if self._match_where(row, where)]
            result[collection] = rows
        return result

    def transact(self, steps: list[list[Any]]) -> dict[str, Any]:
        writes: list[dict[str, Any]] = []
        deletes: list[dict[str, Any]] = []
        for step in steps:
            if len(step) < 4:
                continue
            op, collection, row_id, payload = step
            collection = str(collection)
            row_id = str(row_id)
            if collection not in self.collections:
                self.collections[collection] = {}
            if str(op).lower() == "delete":
                self.collections[collection].pop(row_id, None)
                deletes.append({"collection": collection, "id": row_id})
                continue
            if str(op).lower() != "update":
                continue
            current = deepcopy(self.collections[collection].get(row_id, {}))
            current.update(deepcopy(payload or {}))
            current.setdefault("id", row_id)
            self.collections[collection][row_id] = current
            writes.append({"collection": collection, "id": row_id})
        return {"writes": writes, "deletes": deletes}


class TestMarketAPI(unittest.TestCase):
    def setUp(self):
        os.environ["DEV_AUTH"] = "1"
        os.environ["ADMIN_USER_IDS"] = os.getenv("ADMIN_USER_IDS", "dev_admin") or "dev_admin"
        self.store = FakeInstantStore()
        self._orig_admin_query = app_module.admin_query
        self._orig_admin_transact = app_module.admin_transact
        app_module.admin_query = self.store.query
        app_module.admin_transact = self.store.transact
        self.app = create_app()
        self.client = self.app.test_client()

    def tearDown(self):
        app_module.admin_query = self._orig_admin_query
        app_module.admin_transact = self._orig_admin_transact

    def admin_headers(self) -> dict[str, str]:
        return {
            "X-Dev-User-Id": os.getenv("ADMIN_USER_IDS", "dev_admin").split(",")[0].strip() or "dev_admin",
            "X-Dev-User-Name": "Admin",
        }

    def user_headers(self, user_id: str, name: str) -> dict[str, str]:
        return {
            "X-Dev-User-Id": user_id,
            "X-Dev-User-Name": name,
        }

    def test_create_buy_sell_resolve(self):
        start = datetime.now(timezone.utc) - timedelta(minutes=5)
        close = start + timedelta(hours=2)

        r = self.client.post(
            "/api/markets",
            json={
                "title": "Test Market",
                "rules": "Unit test market",
                "start": start.isoformat().replace("+00:00", "Z"),
                "close": close.isoformat().replace("+00:00", "Z"),
                "options": [{"label": "YES"}, {"label": "NO"}],
            },
            headers=self.admin_headers(),
        )
        self.assertEqual(r.status_code, 201, r.get_data(as_text=True))
        market_payload = r.get_json()
        market_id = market_payload["id"]
        yes_option_id = market_payload["options"][0]["id"]
        no_option_id = market_payload["options"][1]["id"]

        r = self.client.post(
            f"/api/markets/{market_id}/buy",
            json={"user": "alice", "side": "YES", "option_id": yes_option_id, "quantity": 10, "t": (start + timedelta(minutes=1)).isoformat()},
            headers=self.user_headers("alice", "Alice"),
        )
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        self.assertIn("market", r.get_json())

        r = self.client.post(
            f"/api/markets/{market_id}/buy",
            json={"user": "bob", "side": "NO", "option_id": no_option_id, "quantity": 10, "t": (start + timedelta(minutes=2)).isoformat()},
            headers=self.user_headers("bob", "Bob"),
        )
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))

        r = self.client.post(
            f"/api/markets/{market_id}/sell",
            json={"user": "alice", "side": "YES", "option_id": yes_option_id, "quantity": 1.0, "t": (start + timedelta(minutes=10)).isoformat()},
            headers=self.user_headers("alice", "Alice"),
        )
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        self.assertIn("payout", r.get_json())

        r = self.client.post(
            f"/api/admin/markets/{market_id}/resolve",
            json={"winning_option_id": yes_option_id},
            headers=self.admin_headers(),
        )
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        payload = r.get_json()
        self.assertIn("reconciliation", payload)
        self.assertEqual(payload["reconciliation"]["balance_delta"], 0.0)
        self.assertIn("payouts", payload)


if __name__ == "__main__":
    unittest.main()
