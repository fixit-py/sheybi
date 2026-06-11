import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import AdminConsole from "@/components/AdminConsole";
import { isAdminUserId } from "@/lib/admin";

export default async function AdminPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!isAdminUserId(userId)) redirect("/user");

  return (
    <main className="flex w-full flex-1 flex-col gap-6 px-6 py-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Admin
        </h1>
        <p className="max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
          Risk console for reserve health, exposure, audit trails, and market control.
        </p>
      </div>

      <AdminConsole />
    </main>
  );
}
