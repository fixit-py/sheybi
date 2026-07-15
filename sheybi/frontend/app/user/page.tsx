import Link from "next/link";
import MarketFeed from "@/components/MarketFeed";
import UserGreeting from "@/components/UserGreeting";

const shortcuts = [
  { href: "/user/portfolio", label: "Portfolio" },
  { href: "/user/wallet", label: "Wallet" },
  { href: "/user/deposit", label: "Deposit" },
  { href: "/user/verification", label: "Verification" },
];

export default function UserHomePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
      <section className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black sm:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <UserGreeting />
            <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400 sm:text-base">
              Browse open markets, check your wallet, and move straight into trading.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {shortcuts.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-center text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-black sm:p-6">
        <MarketFeed />
      </section>
    </main>
  );
}
