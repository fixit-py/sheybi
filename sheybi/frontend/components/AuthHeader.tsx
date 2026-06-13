"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  SignedIn,
  SignedOut,
  SignOutButton,
} from "@clerk/nextjs";
import Link from "next/link";

type WalletResponse = {
  wallet_balance?: number;
  currency?: string;
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

export function AuthHeader() {
  const { getToken, isSignedIn } = useAuth();
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [currency, setCurrency] = useState("NGN");
  const displayBalance = isSignedIn && walletBalance !== null ? money(walletBalance, currency) : "Wallet";

  useEffect(() => {
    if (!isSignedIn) return;

    let active = true;

    const loadWallet = async () => {
      try {
        const token = await getToken();
        const res = await fetch("/api/flask/me", {
          cache: "no-store",
          headers: {
            Authorization: token ? `Bearer ${token}` : "",
          },
        });
        const json = (await readJson(res)) as WalletResponse;
        if (!res.ok) return;
        if (!active) return;
        setWalletBalance(Number.isFinite(json.wallet_balance as number) ? Number(json.wallet_balance) : null);
        setCurrency(json.currency || "NGN");
      } catch {
        if (!active) return;
        setWalletBalance(null);
      }
    };

    void loadWallet();
    const timer = window.setInterval(() => {
      void loadWallet();
    }, 30000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [getToken, isSignedIn]);

  return (
    <header className=" flex w-full items-center justify-between gap-4 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
      <Link
        href="/"
        className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
      >
        Sheybi
      </Link>
      <div className="flex items-center gap-3">
        <SignedIn>
          <Link
        href="/user/wallet"
            className="rounded-lg bg-slate-50 px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-50 dark:hover:bg-slate-700"
          >
            {displayBalance}
          </Link>
        </SignedIn>
        <SignedOut>
          <Link
            href="/sign-in"
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Sign in or sign up
          </Link>
        </SignedOut>
        <SignedIn>
          <SignOutButton>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Sign out
            </button>
          </SignOutButton>
        </SignedIn>
      </div>
    </header>
  );
}
