"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

type WalletResponse = {
  user_id: string;
  wallet_balance: number;
  currency: string;
  display_name?: string | null;
  handle?: string | null;
};

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: "invalid_json", raw: text };
  }
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: currency || "NGN",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export default function WalletPanel() {
  const { getToken } = useAuth();
  const [data, setData] = useState<WalletResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/flask/me", {
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
        },
      });
      const json = (await readJson(res)) as WalletResponse;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [getToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Wallet
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Dummy balance in NGN
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

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-zinc-50 p-5 dark:bg-zinc-900">
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            Available balance
          </div>
          <div className="mt-2 text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
            {money(data?.wallet_balance ?? 0, data?.currency ?? "NGN")}
          </div>
        </div>
        <div className="rounded-2xl bg-zinc-50 p-5 dark:bg-zinc-900">
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            Account
          </div>
          <div className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {data?.display_name || data?.handle || data?.user_id || "—"}
          </div>
          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Currency: {data?.currency || "NGN"}
          </div>
        </div>
      </div>
    </section>
  );
}
