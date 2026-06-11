import WalletPanel from "@/components/WalletPanel";

export default function WalletPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
        Wallet
      </h1>
      <WalletPanel />
    </main>
  );
}
