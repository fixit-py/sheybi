"use client";

import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import Link from "next/link";

export function AuthHeader() {
  return (
    <header className="flex w-full items-center justify-between gap-4 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
      <Link
        href="/"
        className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
      >
        Sheybi
      </Link>
      <div className="flex items-center gap-3">
        <Show when="signed-out">
          <SignInButton>
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Sign in
            </button>
          </SignInButton>
          <SignUpButton>
            <button
              type="button"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Sign up
            </button>
          </SignUpButton>
        </Show>
        <Show when="signed-in">
          <UserButton />
        </Show>
      </div>
    </header>
  );
}
