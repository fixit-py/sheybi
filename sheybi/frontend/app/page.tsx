"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";

import MarketFeed from "@/components/MarketFeed";

export default function Home() {
  const { isLoaded, isSignedIn } = useAuth();

  if (isLoaded && isSignedIn) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <MarketFeed />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8 sm:px-6">
      <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-3xl border border-zinc-200 bg-white/90 p-8 text-center shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
            Sheybi
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Sign in or create an account
          </h1>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Access the app with one button. Clerk will handle login or signup.
          </p>
        </div>
        <Link
          href="/sign-in"
          className="inline-flex w-full items-center justify-center rounded-full bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Continue
        </Link>
      </div>
    </main>
  );
}
