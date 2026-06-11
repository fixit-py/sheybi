"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";

type Transaction = {
  id: string;
  market_id: string | null;
  market_title: string | null;
  option_id: string | null;
  option_label: string | null;
  type: string | null;
  side: string | null;
  amount: number | string | null;
  shares: number | string | null;
  quantity: number | string | null;
  price: number | string | null;
  outcome: string | null;
  t: string | null;
  created_at: number | string | null;
  display_name: string | null;
};

type HistoryResponse = {
  user_id: string;
  as_of: string;
  transactions: Transaction[];
};

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: "invalid_json", raw: text };
  }
}

function formatIso(value: string | number | null | undefined) {
  if (value == null) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(num) ? num : 0);
}

export default function HistoryPanel() {
  const { getToken } = useAuth();
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openMarketIds, setOpenMarketIds] = useState<Record<string, boolean>>(
    {},
  );

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/flask/me/history", {
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
        },
      });
      const json = (await readJson(res)) as HistoryResponse;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(json);
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
      void load();
    }, 10000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  const groupedTransactions = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        title: string;
        marketId: string | null;
        transactions: Transaction[];
      }
    >();

    for (const tx of data?.transactions ?? []) {
      const marketId = tx.market_id ?? "unknown";
      const key = marketId;
      const title = tx.market_title || tx.market_id || "Other activity";
      const existing = groups.get(key);
      if (existing) {
        existing.transactions.push(tx);
      } else {
        groups.set(key, {
          key,
          title,
          marketId: tx.market_id,
          transactions: [tx],
        });
      }
    }

    return Array.from(groups.values());
  }, [data?.transactions]);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Trade history
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {data?.as_of ? `Updated ${formatIso(data.as_of)}` : "All trades"}
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

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          Error: {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-3">
        {groupedTransactions.length ? (
          groupedTransactions.map((group) => {
            const isOpen = openMarketIds[group.key] ?? false;
            const first = group.transactions[0];
            const marketHref = group.marketId ? `/user/market/${group.marketId}` : null;
            return (
              <section
                key={group.key}
                className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenMarketIds((current) => ({
                        ...current,
                        [group.key]: !isOpen,
                      }))
                    }
                    className="flex flex-1 flex-col gap-2 text-left"
                  >
                    <div>
                      <div className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                        {group.title}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {group.marketId || "Other activity"} ·{" "}
                        {group.transactions.length} trades
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Latest: {formatIso(first?.t || first?.created_at)}
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    {marketHref ? (
                      <Link
                        href={marketHref}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                      >
                        Open in new tab
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        setOpenMarketIds((current) => ({
                          ...current,
                          [group.key]: !isOpen,
                        }))
                      }
                      className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    >
                      {isOpen ? "Collapse" : "Expand"}
                    </button>
                  </div>
                </div>

                {isOpen ? (
                  <div className="mt-4 grid gap-3">
                    {group.transactions.map((tx) => {
                      const marketHref = tx.market_id
                        ? `/user/market/${tx.market_id}${tx.option_id ? `#option-${tx.option_id}` : ""}`
                        : null;
                      const card = (
                        <div className="rounded-2xl bg-zinc-50 p-4 transition-colors hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                                {tx.type || "TX"}
                                {tx.option_label ? ` · ${tx.option_label}` : ""}
                                {tx.side ? ` · ${tx.side}` : ""}
                              </div>
                              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                {formatIso(tx.t || tx.created_at)}
                              </div>
                            </div>
                            <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                              {tx.market_title || tx.market_id || "Market"}
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                            <div>
                              <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                                Amount
                              </div>
                              <div className="mt-1 font-medium text-zinc-900 dark:text-zinc-50">
                                {money(tx.amount)}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                                Shares
                              </div>
                              <div className="mt-1 font-medium text-zinc-900 dark:text-zinc-50">
                                {typeof tx.quantity === "number"
                                  ? tx.quantity.toFixed(6)
                                  : tx.quantity ?? tx.shares ?? "—"}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                                Price
                              </div>
                              <div className="mt-1 font-medium text-zinc-900 dark:text-zinc-50">
                                {money(tx.price)}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                                Display name
                              </div>
                              <div className="mt-1 font-medium text-zinc-900 dark:text-zinc-50">
                                {tx.display_name || "—"}
                              </div>
                            </div>
                          </div>
                        </div>
                      );

                      if (!marketHref) {
                        return <div key={tx.id}>{card}</div>;
                      }

                      return (
                        <Link
                          key={tx.id}
                          href={marketHref}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {card}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })
        ) : (
          <div className="rounded-2xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            No trade history yet.
          </div>
        )}
      </div>
    </section>
  );
}
