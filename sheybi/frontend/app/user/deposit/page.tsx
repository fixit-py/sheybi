"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { ArrowRightIcon, BadgeCheckIcon, Clock3Icon, Loader2Icon } from "lucide-react";

type ProfileResponse = {
  wallet_balance?: number;
  currency?: string;
  display_name?: string | null;
  handle?: string | null;
};

type DepositItem = {
  id: string;
  reference: string | null;
  amount: number;
  amount_kobo: number;
  status: string | null;
  gateway_response: string | null;
  paid_at: string | number | null;
  created_at: string | number | null;
  updated_at: string | number | null;
};

type DepositInitResponse = {
  reference?: string | null;
  public_key?: string | null;
  amount_kobo?: number | null;
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

function formatTime(value: string | number | null | undefined) {
  if (value == null) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function statusClass(status: string | null | undefined) {
  const value = (status || "pending").toLowerCase();
  if (value === "paid" || value === "completed" || value === "credited" || value === "success") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200";
  }
  if (value === "failed" || value === "rejected" || value === "abandoned") {
    return "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200";
  }
  return "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200";
}

function loadPaystackScript() {
  return new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Browser not available."));
      return;
    }
    if ((window as typeof window & { PaystackPop?: unknown }).PaystackPop) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-paystack-inline="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Paystack.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.paystack.co/v1/inline.js";
    script.async = true;
    script.dataset.paystackInline = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Paystack."));
    document.head.appendChild(script);
  });
}

export default function DepositPage() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [amount, setAmount] = useState("");
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [deposits, setDeposits] = useState<DepositItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const email = useMemo(() => {
    return user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || "";
  }, [user]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const headers = { Authorization: token ? `Bearer ${token}` : "" };
      const [meRes, depositsRes] = await Promise.all([
        fetch("/api/flask/me", { headers, cache: "no-store" }),
        fetch("/api/flask/me/deposits", { headers, cache: "no-store" }),
      ]);
      const meJson = (await readJson(meRes)) as ProfileResponse;
      const depositsJson = await readJson(depositsRes);
      if (!meRes.ok) throw new Error((meJson as { error?: string })?.error || `HTTP ${meRes.status}`);
      if (!depositsRes.ok) {
        throw new Error((depositsJson as { error?: string })?.error || `HTTP ${depositsRes.status}`);
      }
      setProfile(meJson);
      setDeposits(((depositsJson as { deposits?: DepositItem[] })?.deposits ?? []) as DepositItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    const nextAmount = Number(amount);
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      setError("Enter a deposit amount.");
      return;
    }
    if (!email) {
      setError("Add an email to your Clerk account first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const token = await getToken();
      const callbackUrl = `${window.location.origin}/user/deposit/verify`;
      const res = await fetch("/api/flask/paystack/deposits/initialize", {
        method: "POST",
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: nextAmount,
          email,
          callback_url: callbackUrl,
        }),
      });
      const json = await readJson(res);
      if (!res.ok) {
        const detail = (json as { detail?: string })?.detail;
        throw new Error(
          detail
            ? `${(json as { error?: string })?.error || "deposit_initialize_failed"}: ${detail}`
            : (json as { error?: string })?.error || `HTTP ${res.status}`,
        );
      }
      const init = json as DepositInitResponse;
      const reference = init.reference;
      const publicKey = init.public_key;
      const amountKobo = Number(init.amount_kobo ?? Math.round(nextAmount * 100));
      if (!reference || !publicKey) {
        throw new Error("missing_paystack_checkout_details");
      }
      await loadPaystackScript();
      const paystack = (window as typeof window & {
        PaystackPop?: {
          setup: (options: {
            key: string;
            email: string;
            amount: number;
            ref: string;
            currency?: string;
            callback: () => void;
            onClose?: () => void;
          }) => { openIframe: () => void };
        };
      }).PaystackPop;
      if (!paystack) {
        throw new Error("paystack_unavailable");
      }
      const popup = paystack.setup({
        key: publicKey,
        email,
        amount: amountKobo,
        ref: reference,
        currency: "NGN",
        callback: () => {
          void (async () => {
            try {
              const token = await getToken();
              await fetch("/api/flask/paystack/deposits/confirm", {
                method: "POST",
                headers: {
                  Authorization: token ? `Bearer ${token}` : "",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  reference,
                  transaction_id: reference,
                  gateway_response: "browser_callback_confirmed",
                }),
              });
            } catch {
              // The verify page will keep polling the local record if this request fails.
            } finally {
              window.location.assign(`/user/deposit/verify?reference=${encodeURIComponent(reference)}`);
            }
          })();
        },
        onClose: () => {
          setMessage("Payment popup closed.");
        },
      });
      popup.openIframe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
        <div className="flex flex-col gap-2 border-b border-zinc-200 pb-5 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
            Deposit
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Add funds with Paystack
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Enter an amount and we will take you to Paystack. Once Paystack confirms the payment, your wallet is
            credited automatically.
          </p>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="rounded-2xl bg-zinc-50 p-5 dark:bg-zinc-900">
              <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                Current wallet
              </div>
              <div className="mt-2 text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
                {money(profile?.wallet_balance ?? 0, profile?.currency ?? "NGN")}
              </div>
              <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                {user?.fullName ? `Signed in as ${user.fullName}` : "Signed in"}
              </div>
            </div>

            <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              Amount in NGN
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                placeholder="e.g. 5000"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              {[5000, 10000, 25000, 50000].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAmount(String(value))}
                  className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  {money(value, "NGN")}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {submitting ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  Redirecting to Paystack
                </>
              ) : (
                <>
                  Continue to Paystack
                  <ArrowRightIcon className="size-4" />
                </>
              )}
            </button>

            {error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </div>
            ) : null}
            {message ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
                {message}
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                <BadgeCheckIcon className="size-4" />
                How it works
              </div>
              <ol className="mt-3 space-y-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                <li>1. Enter the amount you want to deposit.</li>
                <li>2. Paystack opens in a secure checkout.</li>
                <li>3. When payment succeeds, your wallet updates automatically.</li>
              </ol>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-black">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                <Clock3Icon className="size-4" />
                Recent deposits
              </div>
              <div className="mt-3 space-y-3">
                {loading ? (
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">Loading...</div>
                ) : deposits.length ? (
                  deposits.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-zinc-900 dark:text-zinc-50">
                          {money(item.amount, profile?.currency ?? "NGN")}
                        </div>
                        <div className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${statusClass(item.status)}`}>
                          {item.status || "pending"}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <span>Ref {item.reference || "—"}</span>
                        <span>•</span>
                        <span>{formatTime(item.created_at)}</span>
                      </div>
                      <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {item.gateway_response ? `Gateway: ${item.gateway_response}` : "Waiting for confirmation"}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">No deposits yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
