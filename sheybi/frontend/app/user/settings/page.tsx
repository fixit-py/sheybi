import ProfileEditor from "@/components/ProfileEditor";

export default function SettingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
        Settings
      </h1>
      <ProfileEditor />
      <section className="rounded-3xl border border-zinc-200 bg-white p-5 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-black dark:text-zinc-300 sm:p-6">
        This page is for your in-app profile only. Update your name and user
        tag here when needed. Verification status has its own tab.
      </section>
    </main>
  );
}
