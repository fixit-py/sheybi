"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import {
  HomeIcon,
  TrendingUpIcon,
  WalletIcon,
  CircleDollarSignIcon,
  Settings2Icon,
  CircleHelpIcon,
  BadgeCheckIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

type WalletResponse = {
  wallet_balance?: number;
  currency?: string;
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

const items = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/user/portfolio", label: "Portfolio", icon: TrendingUpIcon },
  { href: "/user/history", label: "History", icon: CircleHelpIcon },
  { href: "/user/wallet", label: "Wallet", icon: WalletIcon },
  { href: "/user/deposit", label: "Deposit", icon: CircleDollarSignIcon },
  { href: "/user/verification", label: "Verify", icon: BadgeCheckIcon },
  { href: "/user/settings", label: "Settings", icon: Settings2Icon },
] as const;

export default function MobileNav() {
  const pathname = usePathname();
  const { getToken } = useAuth();
  const { user, isLoaded } = useUser();
  const [wallet, setWallet] = useState<WalletResponse | null>(null);

  useEffect(() => {
    if (!isLoaded || !user) return;
    let active = true;
    const load = async () => {
      try {
        const token = await getToken();
        const res = await fetch("/api/flask/me", {
          cache: "no-store",
          headers: { Authorization: token ? `Bearer ${token}` : "" },
        });
        const json = (await readJson(res)) as WalletResponse;
        if (!active || !res.ok) return;
        setWallet(json);
      } catch {
        if (active) setWallet(null);
      }
    };
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [getToken, isLoaded, user]);

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200 bg-white/95 px-4 py-2 backdrop-blur md:hidden dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="mx-auto flex max-w-lg flex-col gap-2">
        <div className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {user?.username ? `@${user.username}` : user?.fullName || "User"}
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">Wallet</div>
          </div>
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {money(Number(wallet?.wallet_balance ?? 0), wallet?.currency || "NGN")}
          </div>
        </div>
        <div className="grid grid-cols-6 gap-1">
          {items.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                }`}
              >
                <item.icon className="size-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
