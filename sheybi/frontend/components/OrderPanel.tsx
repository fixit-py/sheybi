"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import MarketCountdown from "@/components/MarketCountdown";

type MarketOption = {
  id: string;
  label: string | null;
  base_price: number;
  current_price: number;
  bid_price?: number;
  ask_price?: number;
  liability?: number;
  exposure?: number;
  volume: number;
};

type MarketResponse = {
  id: string;
  title: string | null;
  rules: string | null;
  start: string;
  close: string;
  status: string | null;
  risk_pressure?: number;
  risk_cap?: number;
  liquidity_b?: number;
  options: MarketOption[];
};

type MeResponse = {
  wallet_balance?: number;
  currency?: string;
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

function formatIso(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: currency || "NGN",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

const BUY_FEE_RATE = 0.005;
const SELL_FEE_MIN = 0.05;
const SELL_FEE_MAX = 0.20;

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

function pickQuotePrice(
  option: MarketOption | null,
  action: "buy" | "sell",
) {
  if (!option) return null;
  const candidates =
    action === "buy"
      ? [option.ask_price, option.current_price, option.base_price]
      : [option.bid_price, option.current_price, option.base_price];
  for (const candidate of candidates) {
    const value = Number(candidate ?? 0);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function estimateSellFeeRate(market: MarketResponse | null, option: MarketOption | null) {
  if (!market || !option) return SELL_FEE_MIN;
  const options = market.options ?? [];
  const totalLiability = options.reduce(
    (sum, item) => sum + Number(item.liability ?? item.exposure ?? 0),
    0,
  );
  const equalShare = options.length > 0 ? 1 / options.length : 1;
  const optionShare =
    totalLiability > 0
      ? Number(option.liability ?? option.exposure ?? 0) / totalLiability
      : equalShare;
  const imbalance =
    equalShare > 0 ? clamp(Math.abs(optionShare - equalShare) / equalShare, 0, 1) : 0;
  const pressure = Math.max(Number(market.risk_pressure ?? 0), imbalance);
  return clamp(SELL_FEE_MIN + (SELL_FEE_MAX - SELL_FEE_MIN) * pressure, SELL_FEE_MIN, SELL_FEE_MAX);
}

export default function OrderPanel({
  marketId,
  optionId,
  initialAction = "buy",
}: {
  marketId: string;
  optionId: string;
  initialAction?: "buy" | "sell";
}) {
  const { getToken } = useAuth();
  const [market, setMarket] = useState<MarketResponse | null>(null);
  const [wallet, setWallet] = useState<MeResponse | null>(null);
  const [amount, setAmount] = useState("");
  const [action, setAction] = useState<"buy" | "sell">(initialAction);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingWallet, setLoadingWallet] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>("");

  const loadMarket = useCallback(async () => {
    setRefreshing(true);
    try {
      const token = await getToken();
      const headers: HeadersInit = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const marketRes = await fetch(`/api/flask/markets/${marketId}`, { headers });
      const marketJson = await readJson(marketRes);
      if (!marketRes.ok) throw new Error(`market HTTP ${marketRes.status}`);
      setMarket(marketJson as MarketResponse);
      setError(null);
      setLastUpdatedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [getToken, marketId]);

  const loadWallet = useCallback(async () => {
    setLoadingWallet(true);
    try {
      const token = await getToken();
      const headers: HeadersInit = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const meRes = await fetch("/api/flask/me", { headers });
      const meJson = await readJson(meRes);
      if (!meRes.ok) throw new Error(`wallet HTTP ${meRes.status}`);
      setWallet(meJson as MeResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingWallet(false);
    }
  }, [getToken]);

  useEffect(() => {
    const loadAll = () => {
      void loadMarket();
      void loadWallet();
    };
    const initialTimer = window.setTimeout(() => {
      loadAll();
    }, 0);
    const marketTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadMarket();
      }
    }, 2500);
    const walletTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadWallet();
      }
    }, 30000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(marketTimer);
      window.clearInterval(walletTimer);
    };
  }, [loadMarket, loadWallet]);

  const option = useMemo(
    () => market?.options.find((item) => item.id === optionId) ?? null,
    [market?.options, optionId],
  );
  const currency = wallet?.currency || "NGN";
  const orderPrice = pickQuotePrice(option, action);
  const sellFeeRate = action === "sell" ? estimateSellFeeRate(market, option) : 0;
  const numericAmount = Number(amount.trim() || 0);
  const effectiveBudget =
    action === "buy"
      ? numericAmount / (1 + BUY_FEE_RATE)
      : numericAmount;
  const estimatedShares =
    Number.isFinite(effectiveBudget) && effectiveBudget > 0 && (orderPrice ?? 0) > 0
      ? Number((effectiveBudget / (orderPrice ?? 1)).toFixed(6))
      : 0;
  const amountIsValid = Number.isFinite(numericAmount) && numericAmount > 0;
  const estimatedPayout =
    action === "sell" && amountIsValid ? numericAmount * (1 - sellFeeRate) : null;

  const submit = async () => {
    if (!option) {
      setError("Option not found.");
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return;
    }
    if (!orderPrice || estimatedShares <= 0) {
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/flask/markets/${marketId}/${action}`, {
        method: "POST",
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ option_id: option.id, quantity: estimatedShares }),
      });
      const json = await readJson(res);
      if (!res.ok) {
        const detail =
          typeof json === "object" && json && "detail" in json
            ? String((json as { detail: unknown }).detail)
            : "";
        throw new Error(
          typeof json === "object" && json && "error" in json
            ? [String((json as { error: unknown }).error), detail].filter(Boolean).join(": ")
            : `HTTP ${res.status}`,
        );
      }
      setSuccess(action === "buy" ? "Buy order executed." : "Sell order executed.");
      setAmount("0");
      await Promise.all([loadMarket(), loadWallet()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-black sm:p-6">
      <div className="flex flex-col gap-2 border-b border-zinc-200 pb-4 dark:border-zinc-800 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.28em] text-zinc-500 dark:text-zinc-400">
            Order
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
            {market?.title || "Market"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {option?.label || "Option"} · {orderPrice ? money(orderPrice, currency) : "quote unavailable"}
          </p>
        </div>
        <Link
          href={`/user/market/${marketId}`}
          className="rounded-full border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Back to market
        </Link>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Start</div>
          <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{formatIso(market?.start)}</div>
        </div>
        <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Close</div>
          <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{formatIso(market?.close)}</div>
        </div>
        <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Wallet</div>
          <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {money(Number(wallet?.wallet_balance ?? 0), currency)}
          </div>
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
      {success ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          {success}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>
          {refreshing ? "Refreshing market price..." : loadingWallet ? "Refreshing wallet..." : "Live"}
        </span>
        <span>{lastUpdatedAt ? `Updated ${new Date(lastUpdatedAt).toLocaleTimeString()}` : ""}</span>
      </div>

      <div className="mt-6 rounded-3xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {option?.label || "Option"}
            </div>
            <div className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              Order price{" "}
              {orderPrice ? money(orderPrice, currency) : "unavailable"}
            </div>
          </div>
          <div className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
            Amount in NGN
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAction("buy")}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                action === "buy"
                  ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"
                  : "border border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
            >
              Buy
            </button>
            <button
              type="button"
              onClick={() => setAction("sell")}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                action === "sell"
                  ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"
                  : "border border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
            >
              Sell
            </button>
          </div>

          <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Amount
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-12 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
              placeholder="Enter NGN amount"
              disabled={submitting || market?.status === "closed"}
            />
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Enter the cash amount in naira. We will convert it to shares automatically.
            </div>
          </label>

          <div
            className="grid gap-3 rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 sm:grid-cols-2"
            aria-live="polite"
          >
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Estimated shares</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {amountIsValid && orderPrice
                ? `${estimatedShares.toFixed(6)} shares`
                : "Type an amount"}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              {action === "sell" ? "Estimated payout" : "Quote"}
            </div>
            <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {action === "sell"
                ? estimatedPayout !== null
                  ? money(estimatedPayout, currency)
                  : "—"
                : orderPrice
                  ? money(orderPrice, currency)
                  : "—"}
            </div>
            <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              {action === "sell"
                ? `Fee included at ${(sellFeeRate * 100).toFixed(2)}%`
                : "Per-share quote"}
            </div>
          </div>
        </div>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || market?.status === "closed" || !amountIsValid || !orderPrice}
            className="inline-flex h-12 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {submitting
              ? "Submitting..."
              : action === "buy"
                ? "Place buy order"
                : "Place sell order"}
          </button>
        </div>
      </div>
    </section>
  );
}
