import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import ProfileEditor from "@/components/ProfileEditor";
import UserGreeting from "@/components/UserGreeting";
import UserSettingsBar from "@/components/UserSettingsBar";

export default async function UserPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-2 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-black">
        <UserGreeting />
        <p className="max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
          Manage your profile, verification, and trading views.
        </p>
      </header>

      <UserSettingsBar />
      <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-black sm:p-6">
        <ProfileEditor />
      </div>
    </main>
  );
}
