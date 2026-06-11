import VerificationPanel from "@/components/VerificationPanel";

export default function VerificationPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
        Verification & KYC
      </h1>
      <VerificationPanel />
    </main>
  );
}
