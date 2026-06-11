"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(num) ? num : 0);
}

function percent(value: number) {
  return `${Math.round(Math.max(0, value) * 100)}%`;
}

function utilizationClass(value: number) {
  if (value >= 0.8) {
    return "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200";
  }
  if (value >= 0.5) {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200";
}

type MarketOptionSummary = {
  id: string;
  label: string | null;
  current_price: number;
  base_price: number;
};

type DashboardMarket = {
  id: string;
  title: string | null;
  status: string | null;
  start: string | null;
  close: string | null;
  risk_cap: number;
  current_exposure: number;
  total_exposure: number;
  utilization: number;
  lmsr_b: number;
  spread: number;
  risk_pressure: number;
  worst_case_loss: number;
  fees_collected: number;
  buy_volume: number;
  sell_volume: number;
  options: MarketOptionSummary[];
};

type AdminTransaction = {
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

type AdminUser = {
  user_id: string;
  display_name: string | null;
  handle: string | null;
  verified: boolean;
  wallet_balance: number;
  currency: string;
  created_at: number | string | null;
  updated_at: number | string | null;
  transactions: AdminTransaction[];
};

type AdminAuditResponse = {
  users: AdminUser[];
  total_users: number;
  total_transactions: number;
};

type DashboardResponse = {
  summary: {
    reserve_balance: number;
    fee_balance: number;
    fees_collected: number;
    open_markets: number;
    resolved_markets: number;
    total_volume_24h: number;
    active_users_today: number;
  };
  risk: {
    current_reserve: number;
    reserve_change_24h: number;
    largest_market_exposure: number;
    total_exposure: number;
    risk_rejections_today: number;
  };
  markets: DashboardMarket[];
  open_markets: DashboardMarket[];
  resolved_markets: DashboardMarket[];
  trade_audit: Array<{
    timestamp: string | number | null;
    user: string | null;
    market: string | null;
    type: string | null;
    option: string | null;
    shares: number | string | null;
    cost: number | string | null;
    fee: number | string | null;
  }>;
  risk_events: Array<{
    timestamp: string | number | null;
    user: string | null;
    market: string | null;
    type: string | null;
    option: string | null;
    shares: number | string | null;
    cost: number | string | null;
    fee: number | string | null;
    worst_case_loss: number | string | null;
    risk_cap: number | string | null;
    risk_pressure: number | string | null;
  }>;
  resolution_log: Array<{
    market: string | null;
    market_id: string | null;
    winner: string | null;
    winner_payout: number | string | null;
    fees_collected: number | string | null;
    platform_pnl: number | string | null;
    actual_loss: number | string | null;
    worst_case_loss: number | string | null;
  }>;
  user_risk: {
    top_winners: Array<{
      user_id: string;
      display_name: string | null;
      handle: string | null;
      wallet_balance: number;
      net_pnl: number;
      volume: number;
      trade_count: number;
      verified: boolean;
    }>;
    top_losers: Array<{
      user_id: string;
      display_name: string | null;
      handle: string | null;
      wallet_balance: number;
      net_pnl: number;
      volume: number;
      trade_count: number;
      verified: boolean;
    }>;
    largest_traders: Array<{
      user_id: string;
      display_name: string | null;
      handle: string | null;
      wallet_balance: number;
      net_pnl: number;
      volume: number;
      trade_count: number;
      verified: boolean;
    }>;
    most_profitable: Array<{
      user_id: string;
      display_name: string | null;
      handle: string | null;
      wallet_balance: number;
      net_pnl: number;
      volume: number;
      trade_count: number;
      verified: boolean;
    }>;
    most_active: Array<{
      user_id: string;
      display_name: string | null;
      handle: string | null;
      wallet_balance: number;
      net_pnl: number;
      volume: number;
      trade_count: number;
      verified: boolean;
    }>;
  };
  engine_health: {
    reconciliation_failures: number;
    balance_delta_errors: number;
    cap_violations: number;
    failed_resolutions: number;
    failed_trades: number;
  };
};

type MarketOptionForm = {
  label: string;
  price: string;
};

type MarketForm = {
  title: string;
  rules: string;
  start: string;
  close: string;
  options: MarketOptionForm[];
};

type AuditTab = "trades" | "risk" | "resolutions";
type AdminSection = "overview" | "markets" | "audit" | "users";

function defaultOptions(count: number) {
  const price = (100 / count).toFixed(2);
  return Array.from({ length: count }, (_, index) => ({
    label: `Option ${index + 1}`,
    price,
  }));
}

function panelClass(active: boolean) {
  return active
    ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
    : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:text-zinc-50 dark:hover:bg-zinc-900";
}

function smallCardClass(flag: boolean) {
  return flag
    ? "text-red-600 dark:text-red-300"
    : "text-zinc-900 dark:text-zinc-50";
}

export default function AdminConsole() {
  const { getToken } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [audit, setAudit] = useState<AdminAuditResponse | null>(null);
  const [adminSection, setAdminSection] = useState<AdminSection>("overview");
  const [selectedMarketId, setSelectedMarketId] = useState<string>("");
  const [selectedResolvedMarketId, setSelectedResolvedMarketId] = useState<string>("");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [resolutionByMarket, setResolutionByMarket] = useState<Record<string, string>>({});
  const [tradeUserFilter, setTradeUserFilter] = useState("");
  const [tradeMarketFilter, setTradeMarketFilter] = useState("");
  const [tradeTypeFilter, setTradeTypeFilter] = useState("ALL");
  const [tradeDateFilter, setTradeDateFilter] = useState("");
  const [auditTab, setAuditTab] = useState<AuditTab>("trades");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [form, setForm] = useState<MarketForm>({
    title: "",
    rules: "",
    start: "",
    close: "",
    options: defaultOptions(2),
  });

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const headers = { Authorization: token ? `Bearer ${token}` : "" };
      const [dashboardRes, auditRes] = await Promise.all([
        fetch("/api/flask/admin/dashboard", { headers }),
        fetch("/api/flask/admin/users", { headers }),
      ]);
      const [dashboardJson, auditJson] = await Promise.all([
        readJson(dashboardRes),
        readJson(auditRes),
      ]);
      if (!dashboardRes.ok) throw new Error(`dashboard HTTP ${dashboardRes.status}`);
      if (!auditRes.ok) throw new Error(`audit HTTP ${auditRes.status}`);
      const nextDashboard = dashboardJson as DashboardResponse;
      const nextAudit = auditJson as AdminAuditResponse;
      setDashboard(nextDashboard);
      setAudit(nextAudit);
      setResolutionByMarket((current) => {
        const next = { ...current };
        for (const market of nextDashboard.markets ?? []) {
          if (!next[market.id] && market.options?.[0]?.id) {
            next[market.id] = market.options[0].id;
          }
        }
        return next;
      });
      setSelectedMarketId((current) => {
        const openMarkets = nextDashboard.open_markets ?? [];
        if (current && openMarkets.some((market) => market.id === current)) return current;
        return openMarkets[0]?.id ?? "";
      });
      setSelectedResolvedMarketId((current) => {
        const resolvedMarkets = nextDashboard.resolved_markets ?? [];
        if (current && resolvedMarkets.some((market) => market.id === current)) return current;
        return "";
      });
      setSelectedUserId((current) => {
        if (current && nextAudit.users.some((user) => user.user_id === current)) return current;
        return nextAudit.users[0]?.user_id ?? "";
      });
      setLastLoadedAt(Date.now());
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

  const summary = dashboard?.summary;
  const risk = dashboard?.risk;
  const users = useMemo(() => audit?.users ?? [], [audit?.users]);
  const openMarkets = useMemo(() => dashboard?.open_markets ?? [], [dashboard?.open_markets]);
  const resolvedMarkets = useMemo(() => dashboard?.resolved_markets ?? [], [dashboard?.resolved_markets]);
  const selectedUser = useMemo(
    () => users.find((user) => user.user_id === selectedUserId) ?? users[0] ?? null,
    [selectedUserId, users],
  );
  const selectedMarket = useMemo(
    () => openMarkets.find((market) => market.id === selectedMarketId) ?? openMarkets[0] ?? null,
    [openMarkets, selectedMarketId],
  );
  const selectedResolvedMarket = useMemo(
    () => resolvedMarkets.find((market) => market.id === selectedResolvedMarketId) ?? null,
    [resolvedMarkets, selectedResolvedMarketId],
  );

  const filteredTrades = useMemo(() => {
    const rows = dashboard?.trade_audit ?? [];
    return rows.filter((row) => {
      if (tradeTypeFilter !== "ALL" && row.type !== tradeTypeFilter) return false;
      if (tradeUserFilter && !String(row.user ?? "").toLowerCase().includes(tradeUserFilter.toLowerCase())) return false;
      if (tradeMarketFilter && !String(row.market ?? "").toLowerCase().includes(tradeMarketFilter.toLowerCase())) return false;
      if (tradeDateFilter) {
        const stamp = row.timestamp ? new Date(row.timestamp) : null;
        if (!stamp || Number.isNaN(stamp.getTime())) return false;
        if (stamp.toISOString().slice(0, 10) !== tradeDateFilter) return false;
      }
      return true;
    });
  }, [dashboard?.trade_audit, tradeDateFilter, tradeMarketFilter, tradeTypeFilter, tradeUserFilter]);

  const createMarket = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/flask/markets", {
        method: "POST",
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: form.title,
          rules: form.rules,
          start: form.start,
          close: form.close,
          options: form.options.map((option) => ({
            label: option.label,
            price: option.price,
          })),
        }),
      });
      const json = await readJson(res);
      if (!res.ok) {
        throw new Error(
          typeof json === "object" && json && "error" in json
            ? String((json as { error: unknown }).error)
            : `HTTP ${res.status}`,
        );
      }
      setSuccess("Market created.");
      setForm({
        title: "",
        rules: "",
        start: "",
        close: "",
        options: defaultOptions(2),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const resolveMarket = async (marketId: string) => {
    const winningOptionId = resolutionByMarket[marketId];
    if (!winningOptionId) {
      setError("Select a winning option first.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/flask/admin/markets/${marketId}/resolve`, {
        method: "POST",
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ winning_option_id: winningOptionId }),
      });
      const json = await readJson(res);
      if (!res.ok) {
        throw new Error(
          typeof json === "object" && json && "error" in json
            ? String((json as { error: unknown }).error)
            : `HTTP ${res.status}`,
        );
      }
      setSuccess("Market resolved and payouts applied.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const purgeOpenMarkets = async () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Delete every market and all of their market history? This clears the feeds for both users and admin.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/flask/admin/markets/purge-all", {
        method: "POST",
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
        },
      });
      const json = await readJson(res);
      if (!res.ok) {
        throw new Error(
          typeof json === "object" && json && "error" in json
            ? String((json as { error: unknown }).error)
            : `HTTP ${res.status}`,
        );
      }
      const deletedMarkets = Number((json as { deleted_markets?: number })?.deleted_markets ?? 0);
      const deletedEvents = Number((json as { deleted_events?: number })?.deleted_events ?? 0);
      setSuccess(`Purged ${deletedMarkets} markets and ${deletedEvents} market events.`);
      setSelectedMarketId("");
      setResolutionByMarket({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const selectedMarketWinnerId = selectedMarket ? resolutionByMarket[selectedMarket.id] ?? selectedMarket.options?.[0]?.id ?? "" : "";
  const selectedMarketStatus = selectedMarket?.status || "open";

  return (
    <section className="grid gap-6">
      <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-[0.28em] text-zinc-500 dark:text-zinc-400">
              Admin risk console
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Platform health, risk management, auditability.
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Admin is exempt from the standard verification gate. This screen is the control room for reserve,
              exposure, resolution, and audit trails.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-start gap-2 text-xs lg:justify-end">
            <button
              type="button"
              onClick={purgeOpenMarkets}
              disabled={busy}
              className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-950/50"
            >
              Purge all markets
            </button>
            <button
              type="button"
              onClick={load}
              disabled={busy}
              className="rounded-full bg-zinc-950 px-4 py-1.5 font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Refresh
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <span>Last refresh: {formatIso(lastLoadedAt)}</span>
          <span>•</span>
          <span>Market close is the only admin action that stays intentionally manual.</span>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 border-t border-zinc-200 pt-5 dark:border-zinc-800">
          {[
            ["overview", "Overview"],
            ["markets", "Markets"],
            ["audit", "Audit"],
            ["users", "Users"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setAdminSection(key as AdminSection)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                adminSection === key
                  ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {adminSection === "overview" ? (
        <>
          <div className="grid gap-4 xl:grid-cols-6">
            <SummaryCard label="Platform Reserve" value={money(summary?.reserve_balance ?? 0)} />
            <SummaryCard label="Total Fees Collected" value={money(summary?.fees_collected ?? 0)} />
            <SummaryCard label="Open Markets" value={String(summary?.open_markets ?? 0)} />
            <SummaryCard label="Resolved Markets" value={String(summary?.resolved_markets ?? 0)} />
            <SummaryCard label="24h Volume" value={money(summary?.total_volume_24h ?? 0)} />
            <SummaryCard label="Active Users Today" value={String(summary?.active_users_today ?? 0)} />
          </div>

          <div id="health" className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
            <div id="risk" className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                    Reserve & Risk
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    Current reserve, exposure, and market utilization.
                  </p>
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Reserve change 24h: {money(risk?.reserve_change_24h ?? 0)}
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <RiskTile label="Current Reserve" value={money(risk?.current_reserve ?? 0)} />
                <RiskTile label="Reserve Change 24h" value={money(risk?.reserve_change_24h ?? 0)} accent />
                <RiskTile label="Largest Exposure" value={money(risk?.largest_market_exposure ?? 0)} />
                <RiskTile label="Total Exposure" value={money(risk?.total_exposure ?? 0)} />
                <RiskTile label="Risk Rejections Today" value={String(risk?.risk_rejections_today ?? 0)} />
              </div>

              <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
                <div className="grid grid-cols-[minmax(0,1.35fr)_110px_120px_100px] gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  <span>Market</span>
                  <span className="text-right">Risk Cap</span>
                  <span className="text-right">Exposure</span>
                  <span className="text-right">Util.</span>
                </div>
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {(openMarkets ?? []).map((market) => (
                    <button
                      key={market.id}
                      type="button"
                      onClick={() => {
                        setAdminSection("markets");
                        setSelectedMarketId(market.id);
                      }}
                      className={`grid w-full grid-cols-[minmax(0,1.35fr)_110px_120px_100px] gap-3 px-4 py-4 text-left transition-colors ${
                        selectedMarketId === market.id
                          ? "bg-zinc-50 dark:bg-zinc-900/70"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                          {market.title || "Untitled market"}
                        </span>
                        <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                          {market.status || "open"} · {formatIso(market.close)}
                        </span>
                      </span>
                      <span className="text-right text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {money(market.risk_cap)}
                      </span>
                      <span className="text-right text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {money(market.current_exposure)}
                      </span>
                      <span className="text-right text-sm font-semibold">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 ${utilizationClass(market.utilization)}`}>
                          {percent(market.utilization)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
              <div className="flex items-end justify-between">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                    Engine Health
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    These counters should stay at zero.
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                {[
                  ["Reconciliation Failures", dashboard?.engine_health.reconciliation_failures ?? 0],
                  ["Balance Delta Errors", dashboard?.engine_health.balance_delta_errors ?? 0],
                  ["Cap Violations", dashboard?.engine_health.cap_violations ?? 0],
                  ["Failed Resolutions", dashboard?.engine_health.failed_resolutions ?? 0],
                  ["Failed Trades", dashboard?.engine_health.failed_trades ?? 0],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
                    <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                      {label as string}
                    </div>
                    <div className={`mt-2 text-2xl font-semibold ${smallCardClass(Number(value) > 0)}`}>
                      {Number(value)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {adminSection === "markets" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
          <div className="grid gap-4">
            <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                    Open Markets
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    All live markets are listed here, one per row.
                  </p>
                </div>
                <div className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  {openMarkets.length} open
                </div>
              </div>

              <div className="mt-5 grid gap-3">
                {openMarkets.length ? (
                  openMarkets.map((market) => {
                    const active = selectedMarketId === market.id;
                    return (
                      <button
                        key={market.id}
                        type="button"
                        onClick={() => setSelectedMarketId(market.id)}
                        className={`rounded-2xl border p-4 text-left transition-colors ${
                          active
                            ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                            : "border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">
                              {market.title || "Untitled market"}
                            </div>
                            <div className={`mt-1 text-xs ${active ? "text-zinc-200 dark:text-zinc-700" : "text-zinc-500 dark:text-zinc-400"}`}>
                              {formatIso(market.start)} → {formatIso(market.close)}
                            </div>
                          </div>
                          <div className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            active
                              ? "bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100"
                              : "bg-white/80 text-zinc-700 dark:bg-black dark:text-zinc-300"
                          }`}>
                            {percent(market.utilization)}
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                          <InfoLine label="Risk Cap" value={money(market.risk_cap)} />
                          <InfoLine label="Exposure" value={money(market.current_exposure)} />
                          <InfoLine label="Close" value={formatIso(market.close)} />
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                    No open markets right now.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                    Selected Market Detail
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    Current prices, LMSR, spread, and settlement controls.
                  </p>
                </div>
                <div className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  {selectedMarketStatus}
                </div>
              </div>

              {selectedMarket ? (
                <div className="mt-5 grid gap-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <MetricCard label="LMSR b" value={selectedMarket.lmsr_b.toFixed(2)} />
                    <MetricCard label="Spread" value={`${(selectedMarket.spread * 100).toFixed(2)}%`} />
                    <MetricCard label="Risk Pressure" value={selectedMarket.risk_pressure.toFixed(2)} />
                    <MetricCard label="Worst Case Loss" value={money(selectedMarket.worst_case_loss)} />
                    <MetricCard label="Risk Cap" value={money(selectedMarket.risk_cap)} />
                    <MetricCard label="Fees Collected" value={money(selectedMarket.fees_collected)} />
                    <MetricCard label="Buy Volume" value={money(selectedMarket.buy_volume)} />
                    <MetricCard label="Sell Volume" value={money(selectedMarket.sell_volume)} />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {selectedMarket.options.map((option) => {
                      const chosen = option.id === selectedMarketWinnerId;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() =>
                            setResolutionByMarket((current) => ({
                              ...current,
                              [selectedMarket.id]: option.id,
                            }))
                          }
                          className={`rounded-2xl border p-4 text-left transition-colors ${
                            chosen
                              ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                              : "border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                          }`}
                        >
                          <div className="text-sm font-semibold">
                            {option.label || "Option"}
                          </div>
                          <div className={`mt-2 text-xs ${chosen ? "text-zinc-200 dark:text-zinc-700" : "text-zinc-500 dark:text-zinc-400"}`}>
                            Current {money(option.current_price)}
                          </div>
                          <div className={`mt-1 text-xs ${chosen ? "text-zinc-200 dark:text-zinc-700" : "text-zinc-500 dark:text-zinc-400"}`}>
                            Base {money(option.base_price)}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={selectedMarketWinnerId}
                      onChange={(e) =>
                        setResolutionByMarket((current) => ({
                          ...current,
                          [selectedMarket.id]: e.target.value,
                        }))
                      }
                      className="h-10 min-w-48 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                    >
                      {selectedMarket.options.map((option) => (
                        <option key={option.id} value={option.id}>
                          Winner: {option.label || option.id}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => resolveMarket(selectedMarket.id)}
                      disabled={busy || selectedMarketStatus === "resolved"}
                      className="rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                    >
                      Apply winner
                    </button>
                  </div>

                  <div className="grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <InfoLine label="Start" value={formatIso(selectedMarket.start)} />
                      <InfoLine label="Close" value={formatIso(selectedMarket.close)} />
                      <InfoLine label="Open options" value={String(selectedMarket.options.length)} />
                      <InfoLine label="Current exposure" value={money(selectedMarket.current_exposure)} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  Select an open market above to inspect prices and settle it.
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                    Resolved Archive
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    Read-only market history. Resolved markets do not stay in the live inspector.
                  </p>
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {resolvedMarkets.length} resolved
                </div>
              </div>

              <div className="mt-5 grid gap-3">
                {resolvedMarkets.length ? (
                  resolvedMarkets.map((market) => {
                    const active = selectedResolvedMarketId === market.id;
                    return (
                      <button
                        key={market.id}
                        type="button"
                        onClick={() => {
                          setSelectedResolvedMarketId(market.id);
                        }}
                        className={`rounded-2xl border p-4 text-left transition-colors ${
                          active
                            ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                            : "border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">
                              {market.title || "Untitled market"}
                            </div>
                            <div className={`mt-1 text-xs ${active ? "text-zinc-200 dark:text-zinc-700" : "text-zinc-500 dark:text-zinc-400"}`}>
                              {market.status || "resolved"} · {formatIso(market.close)}
                            </div>
                          </div>
                          <div className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100" : "bg-white/80 text-zinc-700 dark:bg-black dark:text-zinc-300"}`}>
                            {money(market.worst_case_loss)}
                          </div>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                    No resolved markets yet.
                  </div>
                )}
              </div>

              {selectedResolvedMarket ? (
                <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        {selectedResolvedMarket.title || "Resolved market"}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {formatIso(selectedResolvedMarket.start)} → {formatIso(selectedResolvedMarket.close)}
                      </div>
                    </div>
                    <div className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-black dark:text-zinc-300">
                      {selectedResolvedMarket.status || "resolved"}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <InfoLine label="Worst Case" value={money(selectedResolvedMarket.worst_case_loss)} />
                    <InfoLine label="Risk Cap" value={money(selectedResolvedMarket.risk_cap)} />
                    <InfoLine label="Fees" value={money(selectedResolvedMarket.fees_collected)} />
                    <InfoLine label="Exposure" value={money(selectedResolvedMarket.current_exposure)} />
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                    Create Market
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    2 to 4 options. If no price is set, the default is 100 divided by option count.
                  </p>
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

              <div className="mt-5 grid gap-4">
                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Title
                  <input
                    value={form.title}
                    onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
                    className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                    placeholder="Market title"
                  />
                </label>
                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Rules
                  <textarea
                    value={form.rules}
                    onChange={(e) => setForm((s) => ({ ...s, rules: e.target.value }))}
                    className="min-h-28 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                    placeholder="Rules and market description"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                    Start
                    <input
                      type="datetime-local"
                      value={form.start}
                      onChange={(e) => setForm((s) => ({ ...s, start: e.target.value }))}
                      className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                    />
                  </label>
                  <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                    Close
                    <input
                      type="datetime-local"
                      value={form.close}
                      onChange={(e) => setForm((s) => ({ ...s, close: e.target.value }))}
                      className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                    />
                  </label>
                </div>

                <div className="grid gap-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Options</div>
                    <button
                      type="button"
                      onClick={() =>
                        setForm((state) => {
                          if (state.options.length >= 4) return state;
                          const nextCount = state.options.length + 1;
                          return {
                            ...state,
                            options: [
                              ...state.options,
                              { label: `Option ${nextCount}`, price: (100 / nextCount).toFixed(2) },
                            ],
                          };
                        })
                      }
                      disabled={form.options.length >= 4}
                      className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      Add option
                    </button>
                  </div>
                  <div className="grid gap-3">
                    {form.options.map((option, index) => (
                      <div key={index} className="rounded-2xl bg-zinc-50 p-3 dark:bg-zinc-900">
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
                          <input
                            value={option.label}
                            onChange={(e) =>
                              setForm((state) => {
                                const next = [...state.options];
                                next[index] = { ...next[index], label: e.target.value };
                                return { ...state, options: next };
                              })
                            }
                            className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                            placeholder="Option label"
                          />
                          <input
                            value={option.price}
                            onChange={(e) =>
                              setForm((state) => {
                                const next = [...state.options];
                                next[index] = { ...next[index], price: e.target.value };
                                return { ...state, options: next };
                              })
                            }
                            className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                            placeholder="Price"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setForm((state) => {
                                if (state.options.length <= 2) return state;
                                return { ...state, options: state.options.filter((_, i) => i !== index) };
                              })
                            }
                            disabled={form.options.length <= 2}
                            className="h-10 rounded-full border border-zinc-200 px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={createMarket}
                  disabled={busy}
                  className="mt-1 inline-flex h-11 w-full items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  Create market
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
              <div className="flex items-end justify-between">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                    Engine Health
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    These counters should stay at zero.
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                {[
                  ["Reconciliation Failures", dashboard?.engine_health.reconciliation_failures ?? 0],
                  ["Balance Delta Errors", dashboard?.engine_health.balance_delta_errors ?? 0],
                  ["Cap Violations", dashboard?.engine_health.cap_violations ?? 0],
                  ["Failed Resolutions", dashboard?.engine_health.failed_resolutions ?? 0],
                  ["Failed Trades", dashboard?.engine_health.failed_trades ?? 0],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
                    <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                      {label as string}
                    </div>
                    <div className={`mt-2 text-2xl font-semibold ${smallCardClass(Number(value) > 0)}`}>
                      {Number(value)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {adminSection === "audit" ? (
        <div id="audit" className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Audit Trail
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Every trade, every risk event, every resolution. Filter and inspect the ledger.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                ["trades", "Trades"],
                ["risk", "Risk Events"],
                ["resolutions", "Resolutions"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAuditTab(key as AuditTab)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    auditTab === key
                      ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                      : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {auditTab === "trades" ? (
            <div className="mt-5 grid gap-4">
              <div className="flex flex-wrap gap-2">
                <input
                  value={tradeUserFilter}
                  onChange={(e) => setTradeUserFilter(e.target.value)}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                  placeholder="Filter user"
                />
                <input
                  value={tradeMarketFilter}
                  onChange={(e) => setTradeMarketFilter(e.target.value)}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                  placeholder="Filter market"
                />
                <input
                  type="date"
                  value={tradeDateFilter}
                  onChange={(e) => setTradeDateFilter(e.target.value)}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                />
                <select
                  value={tradeTypeFilter}
                  onChange={(e) => setTradeTypeFilter(e.target.value)}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                >
                  <option value="ALL">All</option>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </div>

              <div className="grid gap-3">
                {filteredTrades.length ? (
                  filteredTrades.slice(0, 120).map((event, index) => (
                    <button
                      key={`${event.timestamp ?? index}-${index}`}
                      type="button"
                      onClick={() => {
                        const market = [...(openMarkets ?? []), ...(resolvedMarkets ?? [])].find(
                          (row) => row.title === event.market || row.id === event.market,
                        );
                        if (market) {
                          setAdminSection("markets");
                          if (openMarkets.some((row) => row.id === market.id)) {
                            setSelectedMarketId(market.id);
                          } else {
                            setSelectedResolvedMarketId(market.id);
                          }
                        }
                      }}
                      className="grid gap-3 rounded-2xl border border-zinc-200 p-4 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/60"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                            {event.type || "TX"}
                            {event.option ? ` · ${event.option}` : ""}
                          </div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400">
                            {formatIso(event.timestamp)}
                          </div>
                        </div>
                        <div className="rounded-full bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                          {event.market || "Market"}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                        <InfoLine label="User" value={event.user || "—"} />
                        <InfoLine label="Shares" value={String(event.shares ?? "—")} />
                        <InfoLine label="Cost" value={money(event.cost)} />
                        <InfoLine label="Fee" value={money(event.fee)} />
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                    No trades match the current filters.
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {auditTab === "risk" ? (
            <div className="mt-5 grid gap-3">
              {(dashboard?.risk_events ?? []).length ? (
                dashboard!.risk_events.slice(0, 80).map((event, index) => (
                  <div key={`${event.timestamp ?? index}-${index}`} className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                          {event.type || "EVENT"}
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {formatIso(event.timestamp)}
                        </div>
                      </div>
                      <div className="text-right text-xs text-zinc-500 dark:text-zinc-400">
                        <div>{event.market || "—"}</div>
                        <div>{event.option || "—"}</div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      <InfoLine label="Worst Case" value={money(event.worst_case_loss)} />
                      <InfoLine label="Risk Cap" value={money(event.risk_cap)} />
                      <InfoLine label="Risk Pressure" value={String(event.risk_pressure ?? "—")} />
                      <InfoLine label="User" value={event.user || "—"} />
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  No risk events yet.
                </div>
              )}
            </div>
          ) : null}

          {auditTab === "resolutions" ? (
            <div className="mt-5 grid gap-3">
              {(dashboard?.resolution_log ?? []).length ? (
                dashboard!.resolution_log.slice(0, 60).map((entry, index) => (
                  <div key={`${entry.market_id ?? index}-${index}`} className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                          {entry.market || entry.market_id || "Market"}
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          Winner: {entry.winner || "—"}
                        </div>
                      </div>
                      <div className="text-right text-xs text-zinc-500 dark:text-zinc-400">
                        <div>Payout {money(entry.winner_payout)}</div>
                        <div>Fees {money(entry.fees_collected)}</div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      <InfoLine label="Platform P/L" value={money(entry.platform_pnl)} />
                      <InfoLine label="Actual Loss" value={money(entry.actual_loss)} />
                      <InfoLine label="Worst Case" value={money(entry.worst_case_loss)} />
                      <InfoLine label="Market ID" value={entry.market_id || "—"} />
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  No resolved markets yet.
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {adminSection === "users" ? (
        <div id="users" className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                User Risk
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Top winners, top losers, largest traders, and the full user transaction drilldown.
              </p>
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {audit ? `${audit.total_users} users · ${audit.total_transactions} transactions` : "—"}
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-5">
            <RiskListCard title="Top Winners" rows={dashboard?.user_risk.top_winners ?? []} onPick={setSelectedUserId} />
            <RiskListCard title="Top Losers" rows={dashboard?.user_risk.top_losers ?? []} onPick={setSelectedUserId} />
            <RiskListCard title="Largest Traders" rows={dashboard?.user_risk.largest_traders ?? []} onPick={setSelectedUserId} />
            <RiskListCard title="Most Profitable" rows={dashboard?.user_risk.most_profitable ?? []} onPick={setSelectedUserId} />
            <RiskListCard title="Most Active" rows={dashboard?.user_risk.most_active ?? []} onPick={setSelectedUserId} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">All Users</div>
              <div className="mt-3 max-h-[540px] space-y-2 overflow-y-auto pr-1">
                {audit?.users?.length ? (
                  audit.users.map((user) => {
                    const active = user.user_id === selectedUserId;
                    return (
                      <button
                        key={user.user_id}
                        type="button"
                        onClick={() => setSelectedUserId(user.user_id)}
                        className={`w-full rounded-2xl border p-3 text-left transition-colors ${panelClass(active)}`}
                      >
                        <div className="text-sm font-semibold">
                          {user.display_name || user.handle || user.user_id}
                        </div>
                        <div className={`mt-1 text-xs ${active ? "text-zinc-200 dark:text-zinc-600" : "text-zinc-500 dark:text-zinc-400"}`}>
                          {user.handle ? `@${user.handle}` : user.user_id}
                        </div>
                        <div className={`mt-2 text-xs font-medium ${active ? "text-zinc-100 dark:text-zinc-700" : "text-zinc-600 dark:text-zinc-300"}`}>
                          {money(user.wallet_balance)}
                        </div>
                        <div className={`mt-1 text-xs font-medium ${active ? "text-zinc-100 dark:text-zinc-700" : "text-zinc-600 dark:text-zinc-300"}`}>
                          {user.transactions.length} transactions
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                    No users yet.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
              {selectedUser ? (
                <>
                  <div className="flex flex-col gap-1 border-b border-zinc-200 pb-4 dark:border-zinc-800">
                    <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                      {selectedUser.display_name || selectedUser.handle || selectedUser.user_id}
                    </div>
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">
                      {selectedUser.handle ? `@${selectedUser.handle}` : selectedUser.user_id}
                    </div>
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">
                      Wallet: {money(selectedUser.wallet_balance)}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3">
                    {selectedUser.transactions.length ? (
                      selectedUser.transactions.map((tx) => (
                        <div key={tx.id} className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                                {tx.type || "TX"}
                                {tx.option_label ? ` · ${tx.option_label}` : ""}
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
                            <InfoLine label="Amount" value={money(tx.amount)} />
                            <InfoLine label="Quantity" value={String(tx.quantity ?? tx.shares ?? "—")} />
                            <InfoLine label="Price" value={money(tx.price)} />
                            <InfoLine label="Display name" value={tx.display_name || "—"} />
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                        No transactions for this user.
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  Select a user to inspect their transaction history.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          {success}
        </div>
      ) : null}
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-black">
      <div className="text-xs uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {value}
      </div>
    </div>
  );
}

function RiskTile({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
      <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className={`mt-2 text-xl font-semibold ${accent ? "text-zinc-950 dark:text-zinc-100" : "text-zinc-900 dark:text-zinc-50"}`}>
        {value}
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
      <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        {value}
      </div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-1 font-medium text-zinc-900 dark:text-zinc-50">
        {value}
      </div>
    </div>
  );
}

function RiskListCard({
  title,
  rows,
  onPick,
}: {
  title: string;
  rows: Array<{
    user_id: string;
    display_name: string | null;
    handle: string | null;
    wallet_balance: number;
    net_pnl: number;
    volume: number;
    trade_count: number;
    verified: boolean;
  }>;
  onPick: (userId: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {title}
      </div>
      <div className="mt-3 space-y-2">
        {rows.length ? (
          rows.slice(0, 5).map((row) => (
            <button
              key={row.user_id}
              type="button"
              onClick={() => onPick(row.user_id)}
              className="w-full rounded-2xl bg-zinc-50 p-3 text-left transition-colors hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {row.display_name || row.handle || row.user_id}
              </div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {row.handle ? `@${row.handle}` : row.user_id}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                <span>Wallet {money(row.wallet_balance)}</span>
                <span>P/L {money(row.net_pnl)}</span>
                <span>Volume {money(row.volume)}</span>
                <span>Trades {row.trade_count}</span>
              </div>
            </button>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-zinc-200 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            No data yet.
          </div>
        )}
      </div>
    </div>
  );
}
