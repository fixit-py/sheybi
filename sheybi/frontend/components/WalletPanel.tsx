"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";

type WalletResponse = {
  user_id: string;
  wallet_balance: number;
  withdrawable_balance?: number | null;
  cooling_deposit_balance?: number | null;
  currency: string;
  display_name?: string | null;
  handle?: string | null;
  phone_number?: string | null;
  verification_status?: string | null;
  verification_ready?: boolean | null;
  withdrawal_cooldown_until?: number | string | null;
};

type WithdrawalItem = {
  id: string;
  amount: number;
  status: string | null;
  review_level?: string | null;
  risk_score?: number | string | null;
  risk_flags?: string[] | string | null;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  verified_name?: string | null;
  verified_bank_account?: string | null;
  bank_validation_status?: string | null;
  verification_reference?: string | null;
  paystack_customer_code?: string | null;
  daily_deposit_count?: number | string | null;
  daily_deposit_volume?: number | string | null;
  daily_withdrawal_count?: number | string | null;
  daily_withdrawal_volume?: number | string | null;
  cooldown_until?: number | string | null;
  transfer_status?: string | null;
  transfer_reference?: string | null;
  recipient_code?: string | null;
  note: string | null;
  created_at: number | string | null;
  updated_at: number | string | null;
};

type BankOption = {
  name: string;
  code: string;
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
  const [withdrawals, setWithdrawals] = useState<WithdrawalItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [bankOptions, setBankOptions] = useState<BankOption[]>([]);
  const [bankSearch, setBankSearch] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const headers = {
        Authorization: token ? `Bearer ${token}` : "",
      };
      const [meRes, withdrawalsRes, banksRes] = await Promise.all([
        fetch("/api/flask/me", { headers, cache: "no-store" }),
        fetch("/api/flask/me/withdrawals", { headers, cache: "no-store" }),
        fetch("/api/flask/paystack/banks", { headers, cache: "no-store" }),
      ]);
      const meJson = (await readJson(meRes)) as WalletResponse;
      const withdrawalsJson = await readJson(withdrawalsRes);
      const banksJson = (await readJson(banksRes)) as { banks?: BankOption[] };
      if (!meRes.ok) throw new Error((meJson as { error?: string })?.error || `HTTP ${meRes.status}`);
      if (!withdrawalsRes.ok) {
        throw new Error((withdrawalsJson as { error?: string })?.error || `HTTP ${withdrawalsRes.status}`);
      }
      if (!banksRes.ok) {
        throw new Error((banksJson as { error?: string })?.error || `HTTP ${banksRes.status}`);
      }
      setData(meJson);
      setWithdrawals(((withdrawalsJson as { withdrawals?: WithdrawalItem[] })?.withdrawals ?? []) as WithdrawalItem[]);
      const nextBanks = (banksJson.banks ?? []).filter((bank) => bank?.name && bank?.code);
      setBankOptions(nextBanks);
      setPhoneNumber(meJson.phone_number ?? "");
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

  const submitWithdrawal = async () => {
    const nextAmount = Number(amount);
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      setError("Enter a withdrawal amount.");
      return;
    }
    if (!bankName) {
      setError("Pick a bank from the list.");
      return;
    }
    const nextWithdrawable = Number(data?.withdrawable_balance ?? data?.wallet_balance ?? 0);
    if (nextAmount > nextWithdrawable) {
      setError(
        `Only ${money(nextWithdrawable, data?.currency ?? "NGN")} is withdrawable right now.`,
      );
      return;
    }
    setSubmitBusy(true);
    setError(null);
    setSubmitMessage(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/flask/me/withdrawals", {
        method: "POST",
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: nextAmount,
          bank_name: bankName,
          account_name: accountName,
          account_number: accountNumber,
          phone_number: phoneNumber || data?.phone_number || "",
        }),
      });
      const json = await readJson(res);
      if (!res.ok) {
        throw new Error((json as { error?: string })?.error || `HTTP ${res.status}`);
      }
      setSubmitMessage("Withdrawal request submitted.");
      setAmount("");
      setBankName("");
      setAccountName("");
      setAccountNumber("");
      setPhoneNumber("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitBusy(false);
    }
  };

  const status = data?.verification_status || "unsubmitted";
  const canWithdraw = data?.verification_ready || status === "approved";
  const withdrawableBalance = Number(data?.withdrawable_balance ?? data?.wallet_balance ?? 0);
  const coolingBalance = Number(data?.cooling_deposit_balance ?? 0);
  const coolingActive = coolingBalance > 0.01 && withdrawableBalance < Number(data?.wallet_balance ?? 0);
  const selectedBank = useMemo(
    () => bankOptions.find((bank) => bank.name === bankName) ?? null,
    [bankName, bankOptions],
  );
  const filteredBanks = useMemo(() => {
    const term = bankSearch.trim().toLowerCase();
    if (!term) return bankOptions;
    return bankOptions.filter((bank) => bank.name.toLowerCase().includes(term) || bank.code.toLowerCase().includes(term));
  }, [bankOptions, bankSearch]);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Wallet
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            
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

      {submitMessage ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          {submitMessage}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4">
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
              Withdrawal gate
            </div>
            <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
              {canWithdraw
                ? coolingActive
                  ? `₦${coolingBalance.toLocaleString()} is still cooling off. You can withdraw ₦${withdrawableBalance.toLocaleString()} right now.`
                  : "Withdrawal requests will be queued for review."
                : "Complete verification in the Verification tab before requesting a withdrawal."}
            </div>
            <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              Status: {status}
              {" "}
              {canWithdraw ? `· Withdrawable ${money(withdrawableBalance, data?.currency ?? "NGN")}` : ""}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-black">
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Request withdrawal
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Name on the bank account must match at least two parts of your profile name.
          </div>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              Amount
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                placeholder="e.g. 5000"
              />
            </label>
            <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              Select bank
              <input
                value={bankSearch}
                onChange={(e) => setBankSearch(e.target.value)}
                className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                placeholder="Search your bank"
              />
            </label>
            <div className="max-h-48 overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
              {filteredBanks.length ? (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {filteredBanks.map((bank) => {
                    const active = bank.name === bankName;
                    return (
                      <button
                        type="button"
                        key={`${bank.code}-${bank.name}`}
                        onClick={() => {
                          setBankName(bank.name);
                          setBankSearch(bank.name);
                        }}
                        className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors ${
                          active
                            ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"
                            : "bg-white text-zinc-800 hover:bg-zinc-50 dark:bg-black dark:text-zinc-200 dark:hover:bg-zinc-900"
                        }`}
                      >
                        <span className="min-w-0 truncate">{bank.name}</span>
                      </button>
                    );
                  })}
                </div>
            ) : (
                <div className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">
                  No banks matched your search.
                </div>
              )}
            </div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              Selected: {selectedBank ? selectedBank.name : "—"}
            </div>
            <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              Account name
              <input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                placeholder="e.g. Folahanmi Adeyemi"
              />
            </label>
            <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              Account number
              <input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                placeholder="e.g. 0123456789"
              />
            </label>
            <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              Phone number
              <input
                inputMode="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                placeholder="e.g. 08012345678"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={submitWithdrawal}
            disabled={submitBusy || !canWithdraw}
            className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {canWithdraw ? "Request withdrawal" : "Verification required"}
          </button>
        </div>
      </div>

      <div className="mt-6">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Withdrawal history
        </div>
        <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
          {withdrawals.length ? (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {withdrawals.map((item) => (
                <div key={item.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {money(item.amount, data?.currency ?? "NGN")} · {item.bank_name || "Bank"}
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      {item.account_name || "—"} · {item.account_number || "—"}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                      <span className="rounded-full border border-zinc-200 px-2 py-1 dark:border-zinc-800">
                        {item.review_level || "manual"}
                      </span>
                      {item.risk_score != null ? (
                        <span className="rounded-full border border-zinc-200 px-2 py-1 dark:border-zinc-800">
                          Risk {Number(item.risk_score)}
                        </span>
                      ) : null}
                      {item.cooldown_until ? (
                        <span className="rounded-full border border-zinc-200 px-2 py-1 dark:border-zinc-800">
                          Cooling off
                        </span>
                      ) : null}
                      {item.transfer_status ? (
                        <span className="rounded-full border border-zinc-200 px-2 py-1 dark:border-zinc-800">
                          Transfer {item.transfer_status}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                      {item.status || "pending"}
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      {item.note || "—"}
                    </div>
                    {item.transfer_reference ? (
                      <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                        Ref {item.transfer_reference}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
              No withdrawals yet.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
