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
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  terms_accepted?: boolean | null;
};

function hasProfileFields(value: Profile | { error?: string }): value is Profile {
  return typeof value === "object" && value !== null && ("display_name" in value || "handle" in value);
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts.shift() ?? "";
  const last = parts.pop() ?? "";
  const middle = parts.join(" ");
  return { first, middle, last };
}

export default function OnboardingPage() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [handle, setHandle] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
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
          cache: "no-store",
          headers: { Authorization: token ? `Bearer ${token}` : "" },
        });
        const json = (await readJson(res)) as Profile | { error?: string };
        if (!res.ok) return;
        const existingFirstName = hasProfileFields(json) ? json.first_name?.trim() ?? "" : "";
        const existingMiddleName = hasProfileFields(json) ? json.middle_name?.trim() ?? "" : "";
        const existingLastName = hasProfileFields(json) ? json.last_name?.trim() ?? "" : "";
        const existingHandle = hasProfileFields(json) ? json.handle?.trim() ?? "" : "";
        const existingPhoneNumber = hasProfileFields(json) ? json.phone_number?.trim() ?? "" : "";
        const existingTermsAccepted = hasProfileFields(json) ? !!json.terms_accepted : false;
        const existingReady = Boolean(existingFirstName && existingLastName && existingHandle && existingPhoneNumber);
        if (existingReady && existingTermsAccepted) {
          router.replace("/user");
          return;
        }
        if (cancelled) return;
        const clerkName = splitName(user?.fullName || "");
        const fallback = splitName(user?.fullName || "");
        setFirstName(existingFirstName || user?.firstName || clerkName.first || fallback.first);
        setMiddleName(existingMiddleName || fallback.middle);
        setLastName(existingLastName || user?.lastName || clerkName.last || fallback.last);
        setHandle(existingHandle);
        setPhoneNumber(existingPhoneNumber || user?.phoneNumbers?.[0]?.phoneNumber || "");
        setTermsAccepted(existingTermsAccepted);
      } catch {
        if (cancelled) return;
        const clerkName = splitName(user?.fullName || "");
        setFirstName(user?.firstName || clerkName.first);
        setMiddleName(clerkName.middle);
        setLastName(user?.lastName || clerkName.last);
        setPhoneNumber(user?.phoneNumbers?.[0]?.phoneNumber || "");
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, router, user?.fullName, user?.firstName, user?.lastName, user?.phoneNumbers]);

  const save = async () => {
    const nextFirstName = firstName.trim();
    const nextMiddleName = middleName.trim();
    const nextLastName = lastName.trim();
    const nextHandle = handle.trim().replace(/^@+/, "");
    const nextPhoneNumber = phoneNumber.trim();

    if (!nextFirstName || !nextLastName || !nextHandle || !nextPhoneNumber) {
      setError("First name, last name, phone number, and user tag are required.");
      return;
    }
    if (!termsAccepted) {
      setError("Accept the Terms first.");
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
          display_name: [nextFirstName, nextMiddleName, nextLastName].filter(Boolean).join(" "),
          handle: nextHandle,
          email: user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || "",
          first_name: nextFirstName,
          middle_name: nextMiddleName || null,
          last_name: nextLastName,
          phone_number: nextPhoneNumber,
          terms_accepted: true,
        }),
      });
      const json = await readJson(res);
      if (!res.ok) {
        throw new Error((json as { error?: string })?.error || `HTTP ${res.status}`);
      }
      try {
        window.sessionStorage.setItem("sheybi_onboarding_completed_at", String(Date.now()));
      } catch {
        // ignore storage failures
      }
      try {
        window.sessionStorage.setItem("sheybi_terms_accepted_at", String(Date.now()));
      } catch {
        // ignore storage failures
      }
      router.replace("/user");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const email = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || "";

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
            Clerk handles your login and email. We collect your first name,
            middle name, last name, phone number, and user tag inside Sheybi.
            Before you can finalize the account, you must accept the Terms of
            Service and later finish verification from the Verification tab.
          </p>
        </div>

        <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          <div className="font-semibold text-zinc-900 dark:text-zinc-50">Legal</div>
          <p className="mt-2 leading-6">
            The Terms of Service explain how trading works, how fees are charged,
            and the account rules.
          </p>
          <a
            href="/terms"
            className="mt-3 inline-flex rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            Read Terms of Service
          </a>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300 sm:col-span-2">
            Email
            <input
              value={email}
              disabled
              className="h-11 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-500 outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
            />
          </label>

          <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            First name
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
              placeholder="e.g. Asta"
              autoComplete="given-name"
            />
          </label>

          <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Middle name
            <input
              value={middleName}
              onChange={(e) => setMiddleName(e.target.value)}
              className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
              placeholder="e.g. Adebayo"
              autoComplete="additional-name"
            />
          </label>

          <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Last name
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
              placeholder="e.g. Okoro"
              autoComplete="family-name"
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

          <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            Phone number
            <input
              inputMode="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
              placeholder="e.g. 08012345678"
              autoComplete="tel"
            />
          </label>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-start gap-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 size-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950 dark:border-zinc-700 dark:text-zinc-100"
            />
              <span>I agree to the Terms of Service, fees, trading rules, and risk disclosures.</span>
            </label>
          <button
            type="button"
            onClick={save}
            disabled={busy || !termsAccepted}
            className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Continue
          </button>
        </div>
      </section>
    </main>
  );
}
