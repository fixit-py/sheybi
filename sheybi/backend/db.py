from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable

from market import Market, Side


def _parse_dt(value: str) -> datetime:
    v = value.strip()
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    dt = datetime.fromisoformat(v)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _dt_to_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def default_db_path() -> str:
    return os.getenv("SHEYBI_SQLITE_PATH", os.path.join(os.path.dirname(__file__), "app.sqlite3"))


def _connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    return conn


def init_db(path: str) -> None:
    conn = _connect(path)
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              display_name TEXT NULL,
              handle TEXT NULL,
              bio TEXT NULL,
              avatar_url TEXT NULL,
              verified INTEGER NOT NULL DEFAULT 0,
              updated_at TEXT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS markets (
              id TEXT PRIMARY KEY,
              title TEXT NULL,
              rules TEXT NULL,
              start TEXT NOT NULL,
              close TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            -- Event log: replay to reconstruct full Market state deterministically.
            CREATE TABLE IF NOT EXISTS market_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
              user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
              type TEXT NOT NULL CHECK (type IN ('BUY','SELL','RESOLVE')),
              side TEXT NULL CHECK (side IN ('YES','NO')),
              amount REAL NULL,
              shares REAL NULL,
              outcome TEXT NULL CHECK (outcome IN ('YES','NO')),
              t TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_market_events_market_id_id
              ON market_events(market_id, id);
            """
        )

        # Lightweight migrations for older DBs.
        for stmt in (
            "ALTER TABLE users ADD COLUMN display_name TEXT NULL",
            "ALTER TABLE users ADD COLUMN handle TEXT NULL",
            "ALTER TABLE users ADD COLUMN bio TEXT NULL",
            "ALTER TABLE users ADD COLUMN avatar_url TEXT NULL",
            "ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE users ADD COLUMN updated_at TEXT NULL",
            "ALTER TABLE markets ADD COLUMN title TEXT NULL",
            "ALTER TABLE markets ADD COLUMN rules TEXT NULL",
        ):
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError:
                pass
    finally:
        conn.close()


@dataclass(frozen=True)
class MarketRow:
    id: str
    title: str | None
    rules: str | None
    start: datetime
    close: datetime


def ensure_user(conn: sqlite3.Connection, user_id: str) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO users(id, created_at) VALUES (?, ?)",
        (user_id, _dt_to_iso(datetime.now(timezone.utc))),
    )


def upsert_user_display_name(conn: sqlite3.Connection, user_id: str, display_name: str | None) -> None:
    if not display_name:
        return
    ensure_user(conn, user_id)
    conn.execute(
        "UPDATE users SET display_name = ? WHERE id = ?",
        (display_name.strip()[:200], user_id),
    )


def create_market(
    conn: sqlite3.Connection,
    market_id: str,
    start: datetime,
    close: datetime,
    *,
    title: str | None = None,
    rules: str | None = None,
) -> None:
    conn.execute(
        "INSERT INTO markets(id, title, rules, start, close, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (
            market_id,
            title.strip()[:200] if title else None,
            rules.strip()[:4000] if rules else None,
            _dt_to_iso(start),
            _dt_to_iso(close),
            _dt_to_iso(datetime.now(timezone.utc)),
        ),
    )


def list_markets(conn: sqlite3.Connection) -> list[MarketRow]:
    rows = conn.execute(
        "SELECT id, title, rules, start, close FROM markets ORDER BY created_at DESC"
    ).fetchall()
    return [
        MarketRow(
            id=r["id"],
            title=r["title"],
            rules=r["rules"],
            start=_parse_dt(r["start"]),
            close=_parse_dt(r["close"]),
        )
        for r in rows
    ]


def get_market_row(conn: sqlite3.Connection, market_id: str) -> MarketRow | None:
    r = conn.execute(
        "SELECT id, title, rules, start, close FROM markets WHERE id = ?",
        (market_id,),
    ).fetchone()
    if not r:
        return None
    return MarketRow(
        id=r["id"],
        title=r["title"],
        rules=r["rules"],
        start=_parse_dt(r["start"]),
        close=_parse_dt(r["close"]),
    )


def append_buy(
    conn: sqlite3.Connection,
    *,
    market_id: str,
    user_id: str,
    side: Side,
    amount: float,
    t: datetime,
) -> None:
    ensure_user(conn, user_id)
    conn.execute(
        """
        INSERT INTO market_events(market_id, user_id, type, side, amount, shares, outcome, t)
        VALUES (?, ?, 'BUY', ?, ?, NULL, NULL, ?)
        """,
        (market_id, user_id, side.value, float(amount), _dt_to_iso(t)),
    )


def append_sell(
    conn: sqlite3.Connection,
    *,
    market_id: str,
    user_id: str,
    side: Side,
    shares: float,
    t: datetime,
) -> None:
    ensure_user(conn, user_id)
    conn.execute(
        """
        INSERT INTO market_events(market_id, user_id, type, side, amount, shares, outcome, t)
        VALUES (?, ?, 'SELL', ?, NULL, ?, NULL, ?)
        """,
        (market_id, user_id, side.value, float(shares), _dt_to_iso(t)),
    )


def append_resolve(
    conn: sqlite3.Connection,
    *,
    market_id: str,
    outcome: Side,
    t: datetime,
) -> None:
    conn.execute(
        """
        INSERT INTO market_events(market_id, user_id, type, side, amount, shares, outcome, t)
        VALUES (?, NULL, 'RESOLVE', NULL, NULL, NULL, ?, ?)
        """,
        (market_id, outcome.value, _dt_to_iso(t)),
    )


def iter_events(conn: sqlite3.Connection, market_id: str) -> Iterable[sqlite3.Row]:
    return conn.execute(
        """
        SELECT id, user_id, type, side, amount, shares, outcome, t
        FROM market_events
        WHERE market_id = ?
        ORDER BY id ASC
        """,
        (market_id,),
    )


def iter_events_after(conn: sqlite3.Connection, market_id: str, after_id: int) -> Iterable[sqlite3.Row]:
    return conn.execute(
        """
        SELECT id, user_id, type, side, amount, shares, outcome, t
        FROM market_events
        WHERE market_id = ? AND id > ?
        ORDER BY id ASC
        """,
        (market_id, after_id),
    )


def list_orderbook(conn: sqlite3.Connection, market_id: str) -> list[dict]:
    rows = conn.execute(
        """
        SELECT
          e.id,
          e.type,
          e.side,
          e.amount,
          e.shares,
          e.outcome,
          e.t,
          e.user_id,
          u.display_name
        FROM market_events e
        LEFT JOIN users u ON u.id = e.user_id
        WHERE e.market_id = ?
        ORDER BY e.id DESC
        LIMIT 200
        """,
        (market_id,),
    ).fetchall()
    out: list[dict] = []
    for r in rows:
        out.append(
            {
                "id": r["id"],
                "type": r["type"],
                "side": r["side"],
                "amount": r["amount"],
                "shares": r["shares"],
                "outcome": r["outcome"],
                "t": r["t"],
                "user_id": r["user_id"],
                "display_name": r["display_name"],
            }
        )
    return out


def list_user_market_ids(conn: sqlite3.Connection, user_id: str) -> list[str]:
    rows = conn.execute(
        """
        SELECT DISTINCT market_id
        FROM market_events
        WHERE user_id = ?
        ORDER BY market_id
        """,
        (user_id,),
    ).fetchall()
    return [r["market_id"] for r in rows]


def get_user_display_name(conn: sqlite3.Connection, user_id: str) -> str | None:
    r = conn.execute("SELECT display_name FROM users WHERE id = ?", (user_id,)).fetchone()
    if not r:
        return None
    return r["display_name"]


def get_user_profile(conn: sqlite3.Connection, user_id: str) -> dict | None:
    ensure_user(conn, user_id)
    r = conn.execute(
        """
        SELECT id, display_name, handle, bio, avatar_url, verified, created_at, updated_at
        FROM users
        WHERE id = ?
        """,
        (user_id,),
    ).fetchone()
    if not r:
        return None
    return {
        "user_id": r["id"],
        "display_name": r["display_name"],
        "handle": r["handle"],
        "bio": r["bio"],
        "avatar_url": r["avatar_url"],
        "verified": bool(r["verified"]),
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
    }


def update_user_profile(
    conn: sqlite3.Connection,
    user_id: str,
    *,
    display_name: str | None = None,
    handle: str | None = None,
    bio: str | None = None,
    avatar_url: str | None = None,
) -> dict:
    ensure_user(conn, user_id)

    def clean(value: str | None, max_len: int) -> str | None:
        if value is None:
            return None
        v = value.strip()
        if not v:
            return None
        return v[:max_len]

    display_name = clean(display_name, 200)
    handle = clean(handle, 50)
    bio = clean(bio, 2000)
    avatar_url = clean(avatar_url, 500)

    conn.execute(
        """
        UPDATE users
        SET
          display_name = COALESCE(?, display_name),
          handle = COALESCE(?, handle),
          bio = COALESCE(?, bio),
          avatar_url = COALESCE(?, avatar_url),
          updated_at = ?
        WHERE id = ?
        """,
        (
            display_name,
            handle,
            bio,
            avatar_url,
            _dt_to_iso(datetime.now(timezone.utc)),
            user_id,
        ),
    )
    profile = get_user_profile(conn, user_id)
    if not profile:
        raise RuntimeError("profile_missing")
    return profile


def build_market_from_db(conn: sqlite3.Connection, market_id: str) -> tuple[Market, datetime, dict | None]:
    row = get_market_row(conn, market_id)
    if not row:
        raise KeyError("market not found")

    m = Market(start=row.start, close=row.close)
    last_t = datetime.now(timezone.utc)
    last_result: dict | None = None

    for ev in iter_events(conn, market_id):
        last_t = _parse_dt(ev["t"])
        typ = ev["type"]
        if typ == "BUY":
            side = Side.YES if ev["side"] == "YES" else Side.NO
            trade = m.buy(ev["user_id"], side, last_t, float(ev["amount"]))
            last_result = {"type": "BUY", "trade": trade}
        elif typ == "SELL":
            side = Side.YES if ev["side"] == "YES" else Side.NO
            payout = m.sell(ev["user_id"], side, last_t, float(ev["shares"]))
            last_result = {"type": "SELL", "payout": payout}
        elif typ == "RESOLVE":
            outcome = Side.YES if ev["outcome"] == "YES" else Side.NO
            payouts = m.resolve(outcome)
            last_result = {"type": "RESOLVE", "payouts": payouts, "outcome": outcome}
        else:
            raise ValueError(f"unknown event type: {typ}")

    return m, last_t, last_result


def apply_events(m: Market, events: Iterable[sqlite3.Row]) -> tuple[int, datetime, dict | None]:
    last_id = 0
    last_t = datetime.now(timezone.utc)
    last_result: dict | None = None
    for ev in events:
        last_id = int(ev["id"])
        last_t = _parse_dt(ev["t"])
        typ = ev["type"]
        if typ == "BUY":
            side = Side.YES if ev["side"] == "YES" else Side.NO
            trade = m.buy(ev["user_id"], side, last_t, float(ev["amount"]))
            last_result = {"type": "BUY", "trade": trade}
        elif typ == "SELL":
            side = Side.YES if ev["side"] == "YES" else Side.NO
            payout = m.sell(ev["user_id"], side, last_t, float(ev["shares"]))
            last_result = {"type": "SELL", "payout": payout}
        elif typ == "RESOLVE":
            outcome = Side.YES if ev["outcome"] == "YES" else Side.NO
            payouts = m.resolve(outcome)
            last_result = {"type": "RESOLVE", "payouts": payouts, "outcome": outcome}
        else:
            raise ValueError(f"unknown event type: {typ}")
    return last_id, last_t, last_result


@dataclass
class Db:
    path: str

    def __post_init__(self) -> None:
        init_db(self.path)

    def conn(self) -> sqlite3.Connection:
        return _connect(self.path)
