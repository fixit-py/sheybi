"use client";

import { useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: "invalid_json", raw: text };
  }
}

type Profile = {
  user_id?: string | null;
  display_name?: string | null;
  handle?: string | null;
};

function hasProfileFields(value: Profile | { error?: string }): value is Profile {
  return typeof value === "object" && value !== null && ("display_name" in value || "handle" in value);
}

export default function OnboardingPage() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace("/sign-in");
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const token = await getToken();
        const res = await fetch("/api/flask/me", {
          headers: { Authorization: token ? `Bearer ${token}` : "" },
        });
        const json = (await readJson(res)) as Profile | { error?: string };
        if (!res.ok) return;
        const existingDisplayName = hasProfileFields(json)
          ? json.display_name?.trim() ?? ""
          : "";
        const existingHandle = hasProfileFields(json)
          ? json.handle?.trim() ?? ""
          : "";
        const existingReady = Boolean(existingDisplayName && existingHandle);
        if (existingReady) {
          router.replace("/user");
          return;
        }
        if (cancelled) return;
        setDisplayName(existingDisplayName || user?.fullName || "");
        setHandle(existingHandle);
      } catch {
        if (cancelled) return;
        setDisplayName(user?.fullName || "");
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, router, user?.fullName]);

  const save = async () => {
    const nextDisplayName = displayName.trim();
    const nextHandle = handle.trim().replace(/^@+/, "");

    if (!nextDisplayName || !nextHandle) {
      setError("Name and user tag are required.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/flask/me/profile", {
        method: "PUT",
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          display_name: nextDisplayName,
          handle: nextHandle,
        }),
      });
      const json = await readJson(res);
      if (!res.ok) {
        throw new Error((json as { error?: string })?.error || `HTTP ${res.status}`);
      }
      router.replace("/user");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-50 px-4 py-6 font-sans dark:bg-black">
      <section className="w-full max-w-2xl rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-8">
        <div className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
            Finish setup
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Complete your profile
          </h1>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Clerk handles your login. We collect your name and user tag inside
            Sheybi, then you can finish verification later from the Verification
            tab.
          </p>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Full name
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
              placeholder="e.g. Folahanmi"
              autoComplete="name"
            />
          </label>

          <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            User tag
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
              placeholder="e.g. fola"
              autoComplete="username"
            />
          </label>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            You can complete verification later from the Verification tab.
          </p>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Continue
          </button>
        </div>
      </section>
    </main>
  );
}
