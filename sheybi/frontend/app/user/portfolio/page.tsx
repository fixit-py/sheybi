import UserSettingsBar from "@/components/UserSettingsBar";
import PortfolioPanel from "@/components/PortfolioPanel";

export default function PortfolioPage() {
  return (
    <main className="flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Portfolio
      </h1>
      <UserSettingsBar />
      <PortfolioPanel />
    </main>
  );
}

