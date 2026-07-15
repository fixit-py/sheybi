"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function Item({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
      }`}
    >
      {label}
    </Link>
  );
}

export default function UserSettingsBar() {
  return (
    <nav className="hidden flex-wrap items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-black md:flex">
      <Item href="/user" label="Home" />
      <Item href="/user/portfolio" label="Portfolio" />
      <Item href="/user/history" label="History" />
      <Item href="/user/wallet" label="Wallet" />
      <Item href="/user/deposit" label="Deposit" />
      <Item href="/terms" label="Terms" />
      <Item href="/user/verification" label="Verification" />
      <Item href="/user/settings" label="Settings" />
    </nav>
  );
}
