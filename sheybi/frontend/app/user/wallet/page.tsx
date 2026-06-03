import UserSettingsBar from "@/components/UserSettingsBar";

export default function WalletPage() {
  return (
    <main className="flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Wallet
      </h1>
      <UserSettingsBar />
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-black dark:text-zinc-300">
        Wallet is not implemented yet (no deposits/withdrawals ledger). Next step
        is to add a `wallet_ledger` table and compute balance from it.
      </section>
    </main>
  );
}

