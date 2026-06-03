"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

type PortfolioMarket = {
  market_id: string;
  title: string | null;
  start: string;
  close: string;
  resolved: boolean;
  outcome: "YES" | "NO" | null;
  chance_yes: number;
  confidence: number;
  positions: {
    yes_shares: number;
    no_shares: number;
  };
  mark_to_market: {
    yes_value: number;
    no_value: number;
    total_value: number;
  };
};

type PortfolioResponse = {
  user_id: string;
  as_of: string;
  markets: PortfolioMarket[];
};

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: "invalid_json", raw: text };
  }
}

function formatIso(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function PortfolioPanel() {
  const { getToken } = useAuth();
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/flask/me/portfolio", {
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
        },
      });
      const json = (await readJson(res)) as PortfolioResponse;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Open positions
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {data?.as_of ? `As of ${formatIso(data.as_of)}` : "—"}
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

      {data?.markets?.length ? (
        <ul className="mt-4 grid gap-3">
          {data.markets.map((m) => (
            <li
              key={m.market_id}
              className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="flex flex-col gap-1">
                <div className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  {m.title || m.market_id}
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {formatIso(m.start)} → {formatIso(m.close)}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    YES shares
                  </div>
                  <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    {m.positions.yes_shares}
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    NO shares
                  </div>
                  <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    {m.positions.no_shares}
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Chance YES
                  </div>
                  <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    {m.chance_yes}
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Est. value
                  </div>
                  <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    {m.mark_to_market.total_value}
                  </div>
                </div>
              </div>

              {m.resolved ? (
                <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                  Resolved: {m.outcome ?? "—"}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          {busy ? "Loading…" : "No positions yet."}
        </div>
      )}
    </section>
  );
}

