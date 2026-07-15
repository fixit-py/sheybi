"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";
import MarketCountdown from "@/components/MarketCountdown";

type MarketOption = {
  id: string;
  label: string | null;
  base_price: number;
  current_price: number;
  volume: number;
};

type MarketResponse = {
  id: string;
  title: string | null;
  rules: string | null;
  start: string;
  close: string;
  status: string | null;
  options: MarketOption[];
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

export default function MarketTradePanel({ marketId }: { marketId: string }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [market, setMarket] = useState<MarketResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/flask/markets/${marketId}`, {
        cache: "no-store",
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
        },
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(`market HTTP ${res.status}`);
      setMarket(json as MarketResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [getToken, marketId]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      return;
    }
    const initialTimer = window.setTimeout(() => {
      void load();
    }, 0);
    const intervalTimer = window.setInterval(() => {
      void load();
    }, 5000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalTimer);
    };
  }, [isLoaded, isSignedIn, load]);

  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-black sm:p-6">
      <div className="flex flex-col gap-2 border-b border-zinc-200 pb-4 dark:border-zinc-800 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
            {market?.title || "Market"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Pick an option to continue to the order screen.
          </p>
        </div>
        <div className="rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-semibold text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {market?.status === "closed" ? "Closed" : "Open"}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Start</div>
          <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{formatIso(market?.start)}</div>
        </div>
        <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Close</div>
          <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{formatIso(market?.close)}</div>
        </div>
        <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Options</div>
          <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{market?.options.length ?? 0}</div>
        </div>
        <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Timer</div>
          <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            <MarketCountdown closeIso={market?.close} prefix="Closes" />
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(market?.options ?? []).map((option) => (
          <Link
            key={option.id}
            href={`/user/market/${marketId}/order/${option.id}`}
            className="rounded-3xl border border-zinc-200 p-4 transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-600 dark:hover:bg-zinc-900/70"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  {option.label || "Option"}
                </div>
                <div className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                  Price
                </div>
              </div>
              <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {money(option.current_price)}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {!busy && !error && !(market?.options ?? []).length ? (
        <div className="mt-6 rounded-2xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          No options available.
        </div>
      ) : null}
    </section>
  );
}
