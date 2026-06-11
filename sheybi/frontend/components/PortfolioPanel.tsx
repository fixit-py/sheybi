"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Area,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  YAxis,
  XAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

type PortfolioOption = {
  option_id: string;
  label: string | null;
  shares: number;
  current_price: number;
  base_price: number;
  market_value: number;
};

type PortfolioMarket = {
  market_id: string;
  title: string | null;
  rules: string | null;
  start: string;
  close: string;
  status: string | null;
  closed_at: string | null;
  options: PortfolioOption[];
  invested: number;
  returned: number;
  current_value: number;
  net_pnl: number;
  trades: number;
};

type PortfolioResponse = {
  user_id: string;
  as_of: string;
  wallet_balance: number;
  currency: string;
  markets: PortfolioMarket[];
};

type MarketOrderbookEvent = {
  id: string;
  market_id: string | null;
  user_id: string | null;
  option_id: string | null;
  type: string | null;
  amount: number | string | null;
  shares: number | string | null;
  quantity: number | string | null;
  price: number | string | null;
  t: string | null;
  created_at: number | string | null;
};

type MarketOrderbookResponse = {
  market_id: string;
  unique_users: number;
  events: MarketOrderbookEvent[];
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

function formatChartTime(timestamp: number, rangeLabel: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  if (rangeLabel === "1m" || rangeLabel === "5m" || rangeLabel === "15m") {
    return date.toLocaleTimeString([], { minute: "2-digit", second: "2-digit" });
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: currency || "NGN",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  const toneClasses =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "negative"
        ? "text-rose-700 dark:text-rose-300"
        : "text-zinc-900 dark:text-zinc-50";
  return (
    <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900">
      <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold ${toneClasses}`}>{value}</div>
    </div>
  );
}

const chartConfig = {
  invested: {
    label: "Invested",
    color: "var(--chart-3)",
  },
  current: {
    label: "Current value",
    color: "var(--chart-4)",
  },
  shares: {
    label: "Shares",
    color: "var(--chart-5)",
  },
} satisfies ChartConfig;

const chartRanges = [
  { label: "1m", minutes: 1 },
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "5h", minutes: 300 },
  { label: "All", minutes: null as number | null },
] as const;

export default function PortfolioPanel({
  initialMarketId = "",
}: {
  initialMarketId?: string;
}) {
  const { getToken } = useAuth();
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [orderbook, setOrderbook] = useState<MarketOrderbookResponse | null>(null);
  const [selectedMarketId, setSelectedMarketId] =
    useState<string>(initialMarketId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartRange, setChartRange] = useState<(typeof chartRanges)[number]["label"]>("1m");

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const portfolioRes = await fetch("/api/flask/me/portfolio", {
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
        },
      });
      const portfolioJson = await readJson(portfolioRes);
      if (!portfolioRes.ok) throw new Error(`HTTP ${portfolioRes.status}`);
      setData(portfolioJson as PortfolioResponse);
      setSelectedMarketId((current) => {
        const nextMarkets = (portfolioJson as PortfolioResponse).markets;
        if (current && nextMarkets.some((m) => m.market_id === current)) {
          return current;
        }
        if (initialMarketId && nextMarkets.some((m) => m.market_id === initialMarketId)) {
          return initialMarketId;
        }
        return nextMarkets[0]?.market_id ?? "";
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [getToken, initialMarketId]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void load();
    }, 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load();
      }
    }, 10000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [load]);

  const loadMarketOrderbook = useCallback(
    async (marketId: string) => {
      if (!marketId) {
        setOrderbook(null);
        return;
      }
      try {
        const token = await getToken();
        const res = await fetch(`/api/flask/markets/${marketId}/orderbook`, {
          headers: {
            Authorization: token ? `Bearer ${token}` : "",
          },
        });
        const json = (await readJson(res)) as MarketOrderbookResponse;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setOrderbook(json);
      } catch {
        setOrderbook(null);
      }
    },
    [getToken],
  );

  useEffect(() => {
    if (!selectedMarketId) {
      return;
    }
    const initialTimer = window.setTimeout(() => {
      void loadMarketOrderbook(selectedMarketId);
    }, 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadMarketOrderbook(selectedMarketId);
      }
    }, 10000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [loadMarketOrderbook, selectedMarketId]);

  const selectedMarket =
    data?.markets.find((market) => market.market_id === selectedMarketId) ??
    data?.markets[0] ??
    null;

  const netPnl = selectedMarket?.net_pnl ?? 0;
  const pnlTone = netPnl > 0 ? "positive" : netPnl < 0 ? "negative" : "neutral";

  const currentValue = useMemo(
    () => data?.markets.reduce((sum, market) => sum + market.current_value, 0) ?? 0,
    [data?.markets],
  );
  const invested = useMemo(
    () => data?.markets.reduce((sum, market) => sum + market.invested, 0) ?? 0,
    [data?.markets],
  );
  const totalNetPnl = useMemo(
    () => data?.markets.reduce((sum, market) => sum + market.net_pnl, 0) ?? 0,
    [data?.markets],
  );
  const userId = data?.user_id ?? "";

  const selectedTimeline = useMemo(() => {
    if (!selectedMarket || !orderbook || !userId) return [];

    const ownedOptionIds = new Set(selectedMarket.options.map((option) => option.option_id));
    const currentPrices = new Map<string, number>(
      selectedMarket.options.map((option) => [
        option.option_id,
        option.base_price || option.current_price || 0,
      ]),
    );
    const userShares = new Map<string, number>(
      selectedMarket.options.map((option) => [option.option_id, 0]),
    );

    const combined = orderbook.events
      .filter((event) => event.market_id === selectedMarket.market_id)
      .map((event) => ({
        userId: event.user_id ? String(event.user_id) : "",
        rawType: (event.type || "").toUpperCase(),
        optionId: event.option_id ? String(event.option_id) : "",
        amount: Number(event.amount ?? 0),
        shares: Number(event.shares ?? event.quantity ?? 0),
        price: Number(event.price ?? 0),
        timestamp: Number(
          Date.parse(String(event.t || event.created_at || "")) || 0,
        ),
      }))
      .filter((event) => Number.isFinite(event.timestamp) && event.timestamp > 0)
      .sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        if (a.userId !== b.userId) return a.userId === userId ? -1 : 1;
        return 0;
      });

    const points: Array<{
      timestamp: number;
      time: string;
      invested: number;
      current: number;
      shares: number;
      event: string;
    }> = [];
    let investedRunning = 0;

    for (const item of combined) {
      if (item.optionId && item.price > 0 && ownedOptionIds.has(item.optionId)) {
        currentPrices.set(item.optionId, item.price);
      }

      if (item.userId === userId) {
        if (item.rawType === "BUY" && item.optionId && item.shares > 0) {
          investedRunning += item.amount;
          userShares.set(item.optionId, (userShares.get(item.optionId) ?? 0) + item.shares);
        } else if (item.rawType === "SELL" && item.optionId && item.shares > 0) {
          userShares.set(item.optionId, Math.max(0, (userShares.get(item.optionId) ?? 0) - item.shares));
        } else if ((item.rawType === "PAYOUT" || item.rawType === "REFUND") && item.amount >= 0) {
          for (const optionId of ownedOptionIds) {
            userShares.set(optionId, 0);
          }
        }
      }

      const openValue = Array.from(userShares.entries()).reduce((sum, [optionId, shares]) => {
        return sum + shares * (currentPrices.get(optionId) ?? 0);
      }, 0);
      const heldShares = Array.from(userShares.values()).reduce((sum, shares) => sum + shares, 0);
      points.push({
        timestamp: item.timestamp,
        time: new Date(item.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        invested: investedRunning,
        current: openValue,
        shares: heldShares,
        event: item.rawType,
      });
    }

    return points;
  }, [orderbook, selectedMarket, userId]);

  const chartTimeline = useMemo(() => {
    if (!selectedTimeline.length) {
      return [];
    }

    const selectedRange = chartRanges.find((range) => range.label === chartRange) ?? chartRanges[0];
    const latestTs = selectedTimeline[selectedTimeline.length - 1].timestamp;
    const windowStart = selectedRange.minutes
      ? latestTs - selectedRange.minutes * 60 * 1000
      : Number.NEGATIVE_INFINITY;

    const visible = selectedTimeline.filter((point) => {
      return Number.isFinite(point.timestamp) && point.timestamp >= windowStart;
    });

    if (!visible.length) {
      return selectedTimeline.slice(-1);
    }

    const sampleIntervalMs =
      selectedRange.label === "1m"
        ? 5000
        : selectedRange.label === "5m"
          ? 15000
          : selectedRange.label === "15m"
            ? 30000
            : selectedRange.label === "1h"
              ? 60000
              : selectedRange.label === "5h"
                ? 120000
                : 300000;

    const sampleStart = selectedRange.minutes ? windowStart : visible[0].timestamp;
      const basePoint = [...selectedTimeline]
      .reverse()
      .find((point) => point.timestamp < sampleStart) ?? {
      timestamp: sampleStart,
      time: new Date(sampleStart).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      invested: 0,
      current: 0,
      shares: 0,
      event: "START",
    };
    const samples: typeof visible = [];
    let sourceIndex = 0;
    let lastPoint = basePoint;
    for (let sampleTs = sampleStart; sampleTs <= latestTs; sampleTs += sampleIntervalMs) {
      while (sourceIndex < visible.length && visible[sourceIndex].timestamp <= sampleTs) {
        lastPoint = visible[sourceIndex];
        sourceIndex += 1;
      }
      samples.push({
        ...lastPoint,
        timestamp: sampleTs,
        time: new Date(sampleTs).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
    }

    const finalPoint = visible[visible.length - 1];
    if (samples[samples.length - 1]?.timestamp !== finalPoint.timestamp) {
      samples.push(finalPoint);
    }

    return samples;
  }, [chartRange, selectedTimeline]);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-black">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Current trades
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {data?.as_of ? `Updated ${formatIso(data.as_of)}` : "—"}
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

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <Metric label="Invested" value={money(invested, data?.currency ?? "NGN")} />
        <Metric label="Current value" value={money(currentValue, data?.currency ?? "NGN")} />
        <Metric
          label="Unrealized P/L"
          value={money(totalNetPnl, data?.currency ?? "NGN")}
          tone={totalNetPnl > 0 ? "positive" : totalNetPnl < 0 ? "negative" : "neutral"}
        />
      </div>

      {data?.markets?.length ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1">
            {data.markets.map((market) => {
              const active = market.market_id === selectedMarketId;
              return (
                <button
                  key={market.market_id}
                  type="button"
                  onClick={() => setSelectedMarketId(market.market_id)}
                  className={`rounded-2xl border p-3 text-left transition-colors ${
                    active
                      ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                      : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {market.title || market.market_id}
                      </div>
                      <div
                        className={`mt-1 text-xs ${
                          active
                            ? "text-zinc-200 dark:text-zinc-600"
                            : "text-zinc-500 dark:text-zinc-400"
                        }`}
                      >
                        {formatIso(market.start)} → {formatIso(market.close)}
                      </div>
                    </div>
                    <div
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        market.net_pnl > 0
                          ? active
                            ? "bg-emerald-500/20 text-emerald-100 dark:bg-emerald-200 dark:text-emerald-900"
                            : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : market.net_pnl < 0
                            ? active
                              ? "bg-rose-500/20 text-rose-100 dark:bg-rose-200 dark:text-rose-900"
                              : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                            : active
                              ? "bg-white/15 text-zinc-100 dark:bg-zinc-900 dark:text-zinc-300"
                              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
                      }`}
                    >
                      {money(market.net_pnl, data.currency)}
                    </div>
                  </div>

                  <div
                    className={`mt-3 grid grid-cols-2 gap-2 text-[11px] ${
                      active
                        ? "text-zinc-200 dark:text-zinc-600"
                        : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    <div>
                      <div className="uppercase tracking-[0.18em]">Trades</div>
                      <div className="mt-1 font-semibold">{market.trades}</div>
                    </div>
                    <div>
                      <div className="uppercase tracking-[0.18em]">Value</div>
                      <div className="mt-1 font-semibold">
                        {money(market.current_value, data.currency)}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedMarket ? (
            <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex flex-col gap-1 border-b border-zinc-200 pb-3 dark:border-zinc-800 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                    {selectedMarket.title || selectedMarket.market_id}
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Current positions plus resolved markets you have traded.
                  </p>
                </div>
                <div className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {selectedMarket.status === "closed" ? "Closed" : "Open"}
                </div>
              </div>

              <div className="mt-4 rounded-3xl border border-zinc-200 bg-[#070b14] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] dark:border-zinc-800">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
                  <div>
                    <div className="text-xs font-semibold text-white">
                      Market chart
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      Stock-style view of this market and your position
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-semibold text-white">
                      {money(selectedMarket.current_value, data?.currency ?? "NGN")}
                    </div>
                    <div
                      className={`text-[11px] font-medium ${
                        selectedMarket.net_pnl > 0
                          ? "text-emerald-400"
                          : selectedMarket.net_pnl < 0
                            ? "text-rose-400"
                            : "text-zinc-400"
                      }`}
                    >
                      {(selectedMarket.net_pnl ?? 0) >= 0 ? "+" : ""}
                      {money(selectedMarket.net_pnl ?? 0, data?.currency ?? "NGN")} (
                      {selectedMarket.invested !== 0
                        ? ((selectedMarket.net_pnl / Math.abs(selectedMarket.invested)) * 100).toFixed(2)
                        : "0.00"}
                      %)
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {chartRanges.map((range) => {
                    const active = chartRange === range.label;
                    return (
                      <button
                        key={range.label}
                        type="button"
                        onClick={() => setChartRange(range.label)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                          active
                            ? "bg-white text-[#070b14]"
                            : "bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        {range.label}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-2xl bg-white/5 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                      Invested
                    </div>
                    <div className="mt-1 text-xs font-semibold text-white">
                      {money(selectedMarket.invested, data?.currency ?? "NGN")}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/5 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                      Current value
                    </div>
                    <div className="mt-1 text-xs font-semibold text-white">
                      {money(selectedMarket.current_value, data?.currency ?? "NGN")}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/5 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                      Delta
                    </div>
                    <div
                      className={`mt-1 text-xs font-semibold ${
                        (selectedMarket.net_pnl ?? 0) > 0
                          ? "text-emerald-400"
                          : (selectedMarket.net_pnl ?? 0) < 0
                            ? "text-rose-400"
                            : "text-white"
                      }`}
                    >
                      {(selectedMarket.net_pnl ?? 0) >= 0 ? "+" : ""}
                      {money(selectedMarket.net_pnl ?? 0, data?.currency ?? "NGN")}
                    </div>
                  </div>
                </div>

                <div className="mt-3">
                  {chartTimeline.length ? (
                    <ChartContainer config={chartConfig} className="h-[180px] w-full">
                      <LineChart data={chartTimeline}>
                        <defs>
                          <linearGradient id="portfolioStroke" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-value)" stopOpacity={0.95} />
                            <stop offset="100%" stopColor="var(--color-value)" stopOpacity={0.15} />
                          </linearGradient>
                          <linearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-value)" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="var(--color-value)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                        <XAxis
                          dataKey="timestamp"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          minTickGap={24}
                          stroke="rgba(255,255,255,0.35)"
                          tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }}
                          tickFormatter={(value) => formatChartTime(Number(value), chartRange)}
                        />
                        <YAxis
                          yAxisId="money"
                          orientation="left"
                          tickLine={false}
                          axisLine={false}
                          stroke="rgba(255,255,255,0.35)"
                          tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }}
                          tickFormatter={(value) => money(Number(value), data?.currency ?? "NGN")}
                        />
                        <YAxis
                          yAxisId="shares"
                          orientation="right"
                          tickLine={false}
                          axisLine={false}
                          stroke="rgba(255,255,255,0.35)"
                          tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }}
                          allowDecimals={false}
                          tickFormatter={(value) => `${Number(value).toFixed(0)} sh`}
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              className="border-0 bg-[#0d1320] text-white shadow-2xl ring-1 ring-white/10"
                              labelKey="timestamp"
                              labelFormatter={(value) => formatChartTime(Number(value), chartRange)}
                              formatter={(value, _name, item) => {
                                const payload = item.payload as {
                                  invested?: number;
                                  current?: number;
                                  shares?: number;
                                  event?: string;
                                } | undefined;
                                const isShares = item.dataKey === "shares";
                                return (
                                  <div className="grid gap-1.5">
                                    <div className="font-medium text-white">
                                      {isShares
                                        ? `${Number(value ?? 0).toFixed(0)} shares`
                                        : money(Number(value ?? 0), data?.currency ?? "NGN")}
                                    </div>
                                    <div className="text-xs text-zinc-400">
                                      Invested: {money(payload?.invested ?? 0, data?.currency ?? "NGN")}
                                    </div>
                                    <div className="text-xs text-zinc-400">
                                      Current: {money(payload?.current ?? 0, data?.currency ?? "NGN")}
                                    </div>
                                    <div className="text-xs text-zinc-400">
                                      Shares: {Number(payload?.shares ?? 0).toFixed(0)}
                                    </div>
                                    <div className="text-xs text-zinc-400">
                                      Event: {payload?.event || "—"}
                                    </div>
                                  </div>
                                );
                              }}
                            />
                          }
                        />
                        <ReferenceLine
                          yAxisId="money"
                          y={selectedMarket.current_value}
                          stroke="rgba(255,255,255,0.25)"
                          strokeDasharray="4 4"
                        />
                        <Area
                          type="monotone"
                          dataKey="current"
                          yAxisId="money"
                          stroke="var(--color-current)"
                          fill="url(#portfolioFill)"
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 0 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="current"
                          yAxisId="money"
                          stroke="var(--color-current)"
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 0 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="invested"
                          yAxisId="money"
                          stroke="var(--color-invested)"
                          strokeDasharray="6 4"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 0 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="shares"
                          yAxisId="shares"
                          stroke="var(--color-shares)"
                          strokeDasharray="2 4"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 0 }}
                        />
                      </LineChart>
                    </ChartContainer>
                  ) : (
                    <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-zinc-300">
                      No market timeline available yet.
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric
                  label="Current value"
                  value={money(selectedMarket.current_value, data?.currency ?? "NGN")}
                />
                <Metric
                  label="Invested"
                  value={money(selectedMarket.invested, data?.currency ?? "NGN")}
                />
                <Metric
                  label="Returned"
                  value={money(selectedMarket.returned, data?.currency ?? "NGN")}
                />
                <Metric
                  label="Net P/L"
                  value={money(selectedMarket.net_pnl, data?.currency ?? "NGN")}
                  tone={pnlTone}
                />
                <Metric
                  label="Shares held"
                  value={selectedMarket.options
                    .reduce((sum, option) => sum + option.shares, 0)
                    .toFixed(0)}
                />
              </div>

              <div className="mt-5 grid gap-3">
                {selectedMarket.options.map((option) => (
                  <div
                    key={option.option_id}
                    className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                          {option.label || option.option_id}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          Current price {money(option.current_price, data?.currency ?? "NGN")}
                          {" · "}
                          Base {money(option.base_price, data?.currency ?? "NGN")}
                        </div>
                      </div>
                      <div className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                        {option.shares} shares
                      </div>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 text-sm text-zinc-600 dark:text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        Market value {money(option.market_value, data?.currency ?? "NGN")}
                      </div>
                      {selectedMarket.status === "open" && option.shares > 0 ? (
                        <Link
                          href={`/user/market/${selectedMarket.market_id}/order/${option.option_id}?action=sell`}
                          className="inline-flex items-center justify-center rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-white dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-950"
                        >
                          Sell
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-200 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
              You do not have current open positions yet.
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-zinc-200 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          You do not have current open positions yet.
        </div>
      )}
    </section>
  );
}
