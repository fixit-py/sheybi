"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function Item({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={`rounded-xl px-3 py-2 text-sm  font-bold transition-colors ${active
        ? "bg-primary text-white dark:bg-zinc-100 dark:text-zinc-900"
        : "text-black hover:text-white hover:bg-primary-hover dark:text-zinc-300 dark:hover:bg-zinc-900"
        }`}
    >
      {label}
    </Link>
  );
}

export default function MarketTabs() {
  return (
    <nav className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-primary-300 p-1 shadow-sm dark:border-zinc-800 dark:bg-black">
      <Item href="#" label="Trending" />
      <Item href="#" label="Weekly" />
      <Item href="#" label="Strikes" />
      <Item href="#" label="Relationships" />
      <Item href="#" label="Tasks" />
      <Item href="#" label="Events" />
    </nav>
  );
}

