import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";

import MarketDemo from "@/components/MarketDemo";
import UserSettingsBar from "@/components/UserSettingsBar";

export default async function UserPage() {
  const { userId } = await auth();
  const user = userId ? await currentUser() : null;

  return (
    <main className="flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          User
        </h1>
        <p className="max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
          {user
            ? `Signed in as ${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
            : "Sign in to use the app."}
        </p>
        <div className="text-sm">
          <Link
            href="/admin"
            className="font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-4 dark:text-zinc-50 dark:decoration-zinc-700"
          >
            Go to admin
          </Link>
        </div>
      </header>

      <UserSettingsBar className={"hidden"} />
      <MarketDemo mode="user" />
    </main>
  );
}
