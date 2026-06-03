"use client";

import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignOutButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import { Button } from "./ui/button";
import Link from "next/link";

export function AuthHeader() {
  return (
    <header className=" flex w-full items-center justify-between gap-4 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
      <Link
        href="/"
        className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
      >
        Sheybi
      </Link>
      <div className="flex items-center gap-3">
        <SignedIn>
          <Link
            href="/user"
<<<<<<< HEAD
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
=======
            className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
>>>>>>> 3613ac8137b3fb5500fa2928c6336a8c6dea6e7e
          >
            User
          </Link>
          <Link
            href="/admin"
<<<<<<< HEAD
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
=======
            className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
>>>>>>> 3613ac8137b3fb5500fa2928c6336a8c6dea6e7e
          >
            Admin
          </Link>
        </SignedIn>
        <SignedOut>
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
        </SignedOut>
        <SignedIn>
          <SignOutButton>
            <button
              type="button"
<<<<<<< HEAD
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
=======
              className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
>>>>>>> 3613ac8137b3fb5500fa2928c6336a8c6dea6e7e
            >
              Sign out
            </button>
          </SignOutButton>
<<<<<<< HEAD
          <Button className="rounded-lg bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-50 dark:hover:bg-slate-700">
            $1500
          </Button>
=======
>>>>>>> 3613ac8137b3fb5500fa2928c6336a8c6dea6e7e
          <UserButton />
        </SignedIn>
      </div>
    </header>
  );
}
