"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";

type MarketSummary = {
  id: string;
  title?: string | null;
  rules?: string | null;
  start: string;
  close: string;
};

type MarketListResponse = { markets: MarketSummary[] };

type MarketState = {
  chance_yes: number;
  chance_no: number;
  probability_yes: number;
  probability_no: number;
  price_yes: number;
  price_no: number;
  confidence: number;
  entropy: number;
  traders: number;
  trades: number;
};

type MarketDetailResponse = {
  id: string;
  title?: string | null;
  rules?: string | null;
  start: string;
  close: string;
  state: MarketState;
};

type OrderbookEvent = {
  id: number;
  type: "BUY" | "SELL" | "RESOLVE";
  side: "YES" | "NO" | null;
  amount: number | null;
  shares: number | null;
  outcome: "YES" | "NO" | null;
  t: string;
  user_id: string | null;
  display_name: string | null;
};

type OrderbookResponse = {
  market_id: string;
  unique_users: number;
  events: OrderbookEvent[];
};

function formatIso(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function toIso(value: string) {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString();
}

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: "invalid_json", raw: text };
  }
}

type Mode = "admin" | "user";

export default function MarketDemo({ mode }: { mode: Mode }) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [appDisplayName, setAppDisplayName] = useState<string>("");
  const [devUserId, setDevUserId] = useState<string>("");
  const [devUserName, setDevUserName] = useState<string>("");

  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [selectedMarketId, setSelectedMarketId] = useState<string>("");
  const [marketDetail, setMarketDetail] = useState<MarketDetailResponse | null>(
    null,
  );
  const [orderbook, setOrderbook] = useState<OrderbookResponse | null>(null);

  const [startLocal, setStartLocal] = useState<string>("");
  const [closeLocal, setCloseLocal] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [rules, setRules] = useState<string>("");

  const [buySide, setBuySide] = useState<"YES" | "NO">("YES");
  const [buyShares, setBuyShares] = useState<string>("1");
  const [sellSide, setSellSide] = useState<"YES" | "NO">("YES");
  const [sellShares, setSellShares] = useState<string>("1");
  const [outcome, setOutcome] = useState<"YES" | "NO">("YES");

  const [busy, setBusy] = useState<string | null>(null);
  const [background, setBackground] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState<unknown>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const pollingRef = useRef<number | null>(null);
  const marketsPollRef = useRef<number | null>(null);
  const inFlightRef = useRef({
    markets: false,
    detail: false,
    orderbook: false,
  });

  const getAuthHeaders = useCallback(async () => {
    const token = await getToken();
    const clerkFallback =
      user?.fullName ??
      user?.firstName ??
      user?.primaryEmailAddress?.emailAddress ??
      "";
    const displayName = appDisplayName || clerkFallback;
    const headers: Record<string, string> = {
      Authorization: token ? `Bearer ${token}` : "",
      "Content-Type": "application/json",
      "X-User-Name": displayName,
    };
    if (devUserId.trim()) {
      headers["X-Dev-User-Id"] = devUserId.trim();
      if (devUserName.trim()) headers["X-Dev-User-Name"] = devUserName.trim();
    }
    return headers;
  }, [getToken, appDisplayName, user, devUserId, devUserName]);

  const loadMe = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch("/api/flask/me", {
        headers: { Authorization: token ? `Bearer ${token}` : "" },
      });
      const json = await readJson(res);
      if (res.ok && json && typeof json === "object" && "display_name" in json) {
        const dn = (json as { display_name?: unknown }).display_name;
        setAppDisplayName(typeof dn === "string" ? dn : "");
      }
    } catch {
      // ignore
    }
  }, [getToken]);

  const refreshMarkets = useCallback(
    async ({ background }: { background: boolean }) => {
      if (inFlightRef.current.markets) return;
      inFlightRef.current.markets = true;
      if (background) setBackground("syncing markets");
      else {
        setBusy("loading markets");
        setLastError(null);
      }
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/flask/markets", { headers });
      const json = (await readJson(res)) as MarketListResponse;
      if (!res.ok) {
        throw new Error(
          typeof json === "object" && json && "error" in json
            ? String((json as { error: unknown }).error)
            : `HTTP ${res.status}`,
        );
      }
      const nextMarkets = Array.isArray(json.markets) ? json.markets : [];
      setMarkets(nextMarkets);
      if (!selectedMarketId && nextMarkets.length > 0) {
        setSelectedMarketId(nextMarkets[0].id);
      }
    } catch (e) {
      if (!background) setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlightRef.current.markets = false;
      if (background) setBackground(null);
      else setBusy(null);
    }
    },
    [getAuthHeaders, selectedMarketId],
  );

  const refreshMarketDetail = useCallback(
    async (marketId: string, opts?: { background?: boolean }) => {
    if (!marketId) return;
    if (inFlightRef.current.detail) return;
    inFlightRef.current.detail = true;
    const background = !!opts?.background;
    if (background) setBackground("syncing market");
    else {
      setBusy("loading market");
      setLastError(null);
    }
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/flask/markets/${marketId}`, { headers });
      const json = (await readJson(res)) as MarketDetailResponse;
      setLastResponse(json);
      if (!res.ok) {
        throw new Error(
          typeof json === "object" && json && "error" in json
            ? String((json as { error: unknown }).error)
            : `HTTP ${res.status}`,
        );
      }
      setMarketDetail(json);
    } catch (e) {
      if (!background) setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlightRef.current.detail = false;
      if (background) setBackground(null);
      else setBusy(null);
    }
    },
    [getAuthHeaders],
  );

  const refreshOrderbook = useCallback(
    async (marketId: string, opts?: { background?: boolean }) => {
      if (!marketId) return;
      if (inFlightRef.current.orderbook) return;
      inFlightRef.current.orderbook = true;
      const background = !!opts?.background;
      if (background) setBackground("syncing orderbook");
      else {
        setBusy("loading orderbook");
        setLastError(null);
      }
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/flask/markets/${marketId}/orderbook`, {
          headers,
        });
        const json = (await readJson(res)) as OrderbookResponse;
        setLastResponse(json);
        if (!res.ok) {
          throw new Error(
            typeof json === "object" && json && "error" in json
              ? String((json as { error: unknown }).error)
              : `HTTP ${res.status}`,
          );
        }
        setOrderbook(json);
      } catch (e) {
        if (!background) setLastError(e instanceof Error ? e.message : String(e));
      } finally {
        inFlightRef.current.orderbook = false;
        if (background) setBackground(null);
        else setBusy(null);
      }
    },
    [getAuthHeaders],
  );

  useEffect(() => {
    void loadMe();
    void refreshMarkets({ background: false });
  }, [loadMe, refreshMarkets]);

  useEffect(() => {
    if (!selectedMarketId) {
      setMarketDetail(null);
      setOrderbook(null);
      return;
    }
    void refreshMarketDetail(selectedMarketId, { background: false });
    void refreshOrderbook(selectedMarketId, { background: false });
  }, [selectedMarketId, refreshMarketDetail, refreshOrderbook]);

  // Auto-poll market state + orderbook for "high frequency" feel.
  useEffect(() => {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (!selectedMarketId) return;

    pollingRef.current = window.setInterval(() => {
      void refreshMarketDetail(selectedMarketId, { background: true });
      void refreshOrderbook(selectedMarketId, { background: true });
    }, 750);

    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [selectedMarketId, refreshMarketDetail, refreshOrderbook]);

  // Auto-refresh markets list so new markets appear without reload.
  useEffect(() => {
    if (marketsPollRef.current) {
      window.clearInterval(marketsPollRef.current);
      marketsPollRef.current = null;
    }
    marketsPollRef.current = window.setInterval(() => {
      void refreshMarkets({ background: true });
    }, 2000);
    return () => {
      if (marketsPollRef.current) window.clearInterval(marketsPollRef.current);
      marketsPollRef.current = null;
    };
  }, [refreshMarkets]);

  const createMarket = async () => {
    if (mode !== "admin") return;
    setBusy("creating market");
    setLastError(null);
    try {
      const start = toIso(startLocal);
      const close = toIso(closeLocal);
      const headers = await getAuthHeaders();
      const res = await fetch("/api/flask/markets", {
        method: "POST",
        headers,
        body: JSON.stringify({ start, close, title, rules }),
      });
      const json = await readJson(res);
      setLastResponse(json);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refreshMarkets({ background: false });
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const buy = async () => {
    if (!selectedMarketId) return;
    setBusy("buying");
    setLastError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/flask/markets/${selectedMarketId}/buy`, {
        method: "POST",
        headers,
        body: JSON.stringify({ side: buySide, shares: Number(buyShares) }),
      });
      const json = await readJson(res);
      setLastResponse(json);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refreshMarketDetail(selectedMarketId);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const sell = async () => {
    if (!selectedMarketId) return;
    setBusy("selling");
    setLastError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/flask/markets/${selectedMarketId}/sell`, {
        method: "POST",
        headers,
        body: JSON.stringify({ side: sellSide, shares: Number(sellShares) }),
      });
      const json = await readJson(res);
      setLastResponse(json);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refreshMarketDetail(selectedMarketId);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const resolve = async () => {
    if (mode !== "admin") return;
    if (!selectedMarketId) return;
    setBusy("resolving");
    setLastError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/flask/markets/${selectedMarketId}/resolve`, {
        method: "POST",
        headers,
        body: JSON.stringify({ outcome }),
      });
      const json = await readJson(res);
      setLastResponse(json);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refreshMarketDetail(selectedMarketId);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="w-full rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Market demo
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Create a market, then buy/sell and watch the state update.
          </p>
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {busy
            ? `Working: ${busy}`
            : background
              ? background
              : "Auto-updating"}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Dev user switcher (optional)
            </div>
            <div className="grid grid-cols-1 gap-3">
              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                X-Dev-User-Id
                <input
                  type="text"
                  value={devUserId}
                  onChange={(e) => setDevUserId(e.target.value)}
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                  placeholder="e.g. dev_alice"
                />
              </label>
              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                X-Dev-User-Name
                <input
                  type="text"
                  value={devUserName}
                  onChange={(e) => setDevUserName(e.target.value)}
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                  placeholder="e.g. Alice"
                />
              </label>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Requires backend `DEV_AUTH=1`. Leave blank to use Clerk auth.
              </div>
            </div>
          </div>
          {mode === "admin" ? (
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Create market
              </div>
              <div className="grid grid-cols-1 gap-3">
                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Title
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                    placeholder="Market title"
                  />
                </label>
                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Start
                  <input
                    type="datetime-local"
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                    className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                  />
                </label>
                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Close
                  <input
                    type="datetime-local"
                    value={closeLocal}
                    onChange={(e) => setCloseLocal(e.target.value)}
                    className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                  />
                </label>
                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Rules
                  <textarea
                    value={rules}
                    onChange={(e) => setRules(e.target.value)}
                    className="min-h-24 w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                    placeholder="Market rules / resolution criteria"
                  />
                </label>
                <button
                  type="button"
                  onClick={createMarket}
                  disabled={!!busy}
                  className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Create
                </button>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Times convert to UTC for the backend.
                </div>
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Markets
            </div>
            {markets.length === 0 ? (
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                No markets yet.
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {markets.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedMarketId(m.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        selectedMarketId === m.id
                          ? "border-zinc-900 bg-zinc-50 text-zinc-900 dark:border-zinc-100 dark:bg-zinc-900 dark:text-zinc-50"
                          : "border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                      }`}
                    >
                      <div className="font-medium">
                        {m.title ? m.title : m.id}
                      </div>
                      <div className="text-xs opacity-80">
                        {formatIso(m.start)} → {formatIso(m.close)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Selected market
              </div>
            </div>

            {!selectedMarketId ? (
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Pick a market from the list.
              </div>
            ) : marketDetail ? (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Chance (YES)
                  </div>
                  <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {marketDetail.state.chance_yes}
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Confidence
                  </div>
                  <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {marketDetail.state.confidence}
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    YES price (incl fee)
                  </div>
                  <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {marketDetail.state.price_yes}
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    NO price (incl fee)
                  </div>
                  <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {marketDetail.state.price_no}
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Trades
                  </div>
                  <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {marketDetail.state.trades}
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Prob (YES)
                  </div>
                  <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {marketDetail.state.probability_yes}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Loading…
              </div>
            )}
          </div>

          {selectedMarketId ? (
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Order book
                </div>
              </div>
              <div className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                {orderbook ? `${orderbook.unique_users} unique users` : "—"}
              </div>
              {orderbook?.events?.length ? (
                <ul className="max-h-64 overflow-auto rounded-lg border border-zinc-200 bg-white text-sm dark:border-zinc-800 dark:bg-black">
                  {orderbook.events.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-center justify-between gap-3 border-b border-zinc-100 px-3 py-2 last:border-b-0 dark:border-zinc-900"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                          {e.display_name || e.user_id || "system"}
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {e.type}
                          {e.side ? ` ${e.side}` : ""}
                          {e.amount != null ? ` · $${e.amount}` : ""}
                          {e.shares != null ? ` · ${e.shares} shares` : ""}
                          {e.outcome ? ` · outcome ${e.outcome}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                        {formatIso(e.t)}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  No events yet.
                </div>
              )}
            </div>
          ) : null}

          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Actions
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Side (buy)
                  <select
                    value={buySide}
                    onChange={(e) => setBuySide(e.target.value as "YES" | "NO")}
                    className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                  >
                    <option value="YES">YES</option>
                    <option value="NO">NO</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Shares (buy)
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={buyShares}
                    onChange={(e) => setBuyShares(e.target.value)}
                    className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={buy}
                disabled={!selectedMarketId || !!busy}
                className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Buy
              </button>

              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Side (sell)
                  <select
                    value={sellSide}
                    onChange={(e) => setSellSide(e.target.value as "YES" | "NO")}
                    className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                  >
                    <option value="YES">YES</option>
                    <option value="NO">NO</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Shares (sell)
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={sellShares}
                    onChange={(e) => setSellShares(e.target.value)}
                    className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={sell}
                  disabled={!selectedMarketId || !!busy}
                  className="h-10 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  Sell
                </button>
                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Outcome (resolve)
                  <select
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value as "YES" | "NO")}
                    className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                  >
                    <option value="YES">YES</option>
                    <option value="NO">NO</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={resolve}
                  disabled={mode !== "admin" || !selectedMarketId || !!busy}
                  className="h-10 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  Resolve
                </button>
              </div>
            </div>
          </div>

          {lastError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
              Error: {lastError}
            </div>
          ) : null}

          {lastResponse ? (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Last response
              </div>
              <pre className="max-h-64 overflow-auto text-xs text-zinc-800 dark:text-zinc-200">
                {JSON.stringify(lastResponse, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
