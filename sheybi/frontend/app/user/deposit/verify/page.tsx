"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { CheckCircle2Icon, Loader2Icon, XCircleIcon } from "lucide-react";

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: "invalid_json", raw: text };
  }
}

type DepositResponse = {
  deposit?: {
    amount?: number;
    reference?: string | null;
    status?: string | null;
  };
};

export default function DepositVerifyPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [state, setState] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState<string>("Verifying payment...");

  useEffect(() => {
    let active = true;
    let pollTimer: number | null = null;
    let redirectTimer: number | null = null;

    const stopTimers = () => {
      if (pollTimer) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
      }
      if (redirectTimer) {
        window.clearTimeout(redirectTimer);
        redirectTimer = null;
      }
    };

    const finishSuccess = () => {
      if (!active) return;
      setState("success");
      setMessage("Payment confirmed. Your wallet has been updated.");
      redirectTimer = window.setTimeout(() => {
        router.replace("/user/wallet");
      }, 1600);
    };

    const finishError = (value: string) => {
      if (!active) return;
      setState("error");
      setMessage(value);
    };

    const pollDeposit = async (reference: string) => {
      try {
        const token = await getToken();
        const res = await fetch(`/api/flask/paystack/deposits/verify/${encodeURIComponent(reference)}`, {
          headers: { Authorization: token ? `Bearer ${token}` : "" },
          cache: "no-store",
        });
        const json = (await readJson(res)) as DepositResponse;
        if (!res.ok) {
          throw new Error((json as { error?: string; detail?: string })?.detail || (json as { error?: string })?.error || `HTTP ${res.status}`);
        }
        const status = String((json.deposit?.status || "").toLowerCase());
        if (status === "paid" || status === "completed" || status === "credited" || status === "success") {
          finishSuccess();
          return;
        }
        if (status === "failed" || status === "rejected" || status === "abandoned") {
          finishError("Deposit was not completed.");
          return;
        }
        if (!active) return;
        setState("loading");
        setMessage("Payment received. Waiting for confirmation...");
        pollTimer = window.setTimeout(() => {
          void pollDeposit(reference);
        }, 1500);
      } catch (e) {
        if (!active) return;
        setState("loading");
        setMessage(e instanceof Error ? e.message : String(e));
        pollTimer = window.setTimeout(() => {
          void pollDeposit(reference);
        }, 2500);
      }
    };

    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const reference = params.get("reference") || params.get("trxref") || params.get("txref");
      if (!reference) {
        finishError("Missing payment reference.");
        return;
      }
      setState("loading");
      setMessage("Verifying payment...");
      await pollDeposit(reference);
    };
    void run();
    return () => {
      active = false;
      stopTimers();
    };
  }, [getToken, router]);

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl flex-1 items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
      <section className="w-full rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
        <div className="flex items-center gap-3">
          {state === "loading" ? (
            <Loader2Icon className="size-5 animate-spin text-zinc-600 dark:text-zinc-300" />
          ) : state === "success" ? (
            <CheckCircle2Icon className="size-5 text-emerald-600" />
          ) : (
            <XCircleIcon className="size-5 text-red-600" />
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {state === "loading" ? "Processing deposit" : state === "success" ? "Deposit confirmed" : "Deposit failed"}
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/user/wallet"
            className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Go to wallet
          </Link>
          <Link
            href="/user/deposit"
            className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-200 px-5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            Back to deposit
          </Link>
        </div>
      </section>
    </main>
  );
}
