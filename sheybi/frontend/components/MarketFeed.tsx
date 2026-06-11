"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import MarketCountdown from "@/components/MarketCountdown";

type Market = {
  id: string;
  title: string | null;
  rules: string | null;
  start: string;
  close: string;
  status?: string | null;
  options?: Array<{
    id: string;
    label: string | null;
    base_price: number;
    current_price: number;
    volume: number;
  }>;
};

type MarketsResponse = {
  markets: Market[];
};

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: "invalid_json", raw: text };
  }
}

function formatIso(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function money(value: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export default function MarketFeed() {
  const { getToken } = useAuth();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string>("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "closing" | "open">("all");

  const orderedMarkets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return markets.filter((market) => {
      const status = (market.status || "open").toLowerCase();
      if (filter === "closing" && status !== "open") return false;
      if (filter === "open" && status !== "open") return false;
      if (!q) return true;
      const haystack = [
        market.title,
        market.rules,
        ...(market.options ?? []).map((option) => option.label ?? ""),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [filter, markets, query]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/flask/markets", {
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
        },
      });
      const json = (await readJson(res)) as MarketsResponse;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMarkets(json.markets ?? []);
      setAsOf(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [getToken]);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void load();
    }, 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load();
      }
    }, 5000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
    // `load` depends on `getToken`; the interval should refresh when auth changes.
  }, [load]);

  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-black">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.28em] text-zinc-500 dark:text-zinc-400">
            Active markets
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {asOf
              ? `Updated ${new Date(asOf).toLocaleTimeString()}`
              : "Live list"}
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          Refresh
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-zinc-400">⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search markets"
            className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {[
            { key: "all" as const, label: "All" },
            { key: "open" as const, label: "Open" },
            { key: "closing" as const, label: "Closing soon" },
          ].map((item) => {
            const active = filter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={`rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          Error: {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4">
        {orderedMarkets.map((market) => (
          <Link
            key={market.id}
            href={`/user/market/${market.id}`}
            className="group rounded-3xl border border-zinc-200 p-4 transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-600 dark:hover:bg-zinc-900/70"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {market.title || "Untitled market"}
                </h3>
              </div>
              <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-600 transition-colors group-hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:group-hover:bg-zinc-800">
                Open
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-zinc-500 dark:text-zinc-400">
              <div>
                <div className="uppercase tracking-[0.18em]">Start</div>
                <div className="mt-1 font-medium text-zinc-800 dark:text-zinc-200">
                  {formatIso(market.start)}
                </div>
              </div>
              <div>
                <div className="uppercase tracking-[0.18em]">Close</div>
                <div className="mt-1 font-medium text-zinc-800 dark:text-zinc-200">
                  {formatIso(market.close)}
                </div>
                <MarketCountdown
                  closeIso={market.close}
                  className="mt-1 block font-medium text-zinc-600 dark:text-zinc-400"
                />
              </div>
            </div>

            <div className="mt-4 grid gap-2">
              {(market.options ?? []).slice(0, 4).map((option) => (
                <div
                  key={option.id}
                  className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  <span className="truncate font-medium">{option.label}</span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                    {money(option.current_price)}
                  </span>
                </div>
              ))}
            </div>
          </Link>
        ))}

        {!orderedMarkets.length ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 p-5 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            No active markets available right now.
          </div>
        ) : null}
      </div>
    </section>
  );
}
