import UserSettingsBar from "@/components/UserSettingsBar";
import ProfileEditor from "@/components/ProfileEditor";

export default function SettingsPage() {
  return (
    <main className="flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Settings
      </h1>
      <UserSettingsBar />
      <ProfileEditor />
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-black dark:text-zinc-300">
        Identity verification is not implemented yet (KYC flow). For now, we
        only store an in-app profile separate from Clerk.
      </section>
    </main>
  );
}

