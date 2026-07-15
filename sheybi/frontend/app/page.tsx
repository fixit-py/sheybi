import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-3xl overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-black">
        <div className="border-b border-zinc-200 px-6 py-8 dark:border-zinc-800 sm:px-8 sm:py-10">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-zinc-500 dark:text-zinc-400">
            Sheybi
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-5xl">
            Reserve-backed prediction markets for serious traders.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-600 dark:text-zinc-400 sm:text-base">
            Sign in to access markets, trade positions, manage verification, and withdraw funds from your wallet.
          </p>
        </div>

        <div className="grid gap-6 px-6 py-8 sm:px-8 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="space-y-4">
            <div className="rounded-3xl bg-zinc-50 p-5 dark:bg-zinc-900">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">What you can do</div>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                <li>• Trade market outcomes while markets are open</li>
                <li>• Deposit funds securely through Paystack</li>
                <li>• Complete verification and withdrawals in-app</li>
                <li>• Review your wallet, portfolio, and history</li>
              </ul>
            </div>
            <div className="rounded-3xl border border-zinc-200 px-5 py-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
              Access is account-based. Market browsing and trading require sign in.
            </div>
          </section>

          <aside className="flex flex-col justify-between gap-4 rounded-3xl bg-zinc-950 p-6 text-white dark:bg-zinc-100 dark:text-zinc-950">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.28em] text-zinc-300 dark:text-zinc-600">
                Get started
              </div>
              <p className="mt-3 text-sm leading-6 text-zinc-300 dark:text-zinc-700">
                Create an account or sign in to continue into the app.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <Link
                href="/sign-in"
                className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200 dark:bg-zinc-950 dark:text-white dark:hover:bg-zinc-800"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="inline-flex items-center justify-center rounded-full border border-zinc-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-900 dark:border-zinc-300 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                Sign up
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
