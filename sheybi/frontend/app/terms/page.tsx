"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: "invalid_json", raw: text };
  }
}

type TermsProfile = {
  display_name?: string | null;
  handle?: string | null;
  terms_accepted?: boolean | null;
  terms_version?: string | null;
};

export default function TermsPage() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<TermsProfile | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setLoading(false);
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const token = await getToken();
        const res = await fetch("/api/flask/me", {
          cache: "no-store",
          headers: { Authorization: token ? `Bearer ${token}` : "" },
        });
        const json = (await readJson(res)) as TermsProfile;
        if (!active || !res.ok) return;
        setProfile(json);
        setAccepted(!!json.terms_accepted);
      } catch {
        if (!active) return;
        setProfile(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [getToken, isLoaded, isSignedIn]);

  const acceptTerms = async () => {
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
        body: JSON.stringify({ terms_accepted: true }),
      });
      const json = (await readJson(res)) as TermsProfile;
      if (!res.ok) throw new Error((json as { error?: string })?.error || `HTTP ${res.status}`);
      setAccepted(true);
      try {
        window.sessionStorage.setItem("sheybi_terms_accepted_at", String(Date.now()));
      } catch {
        // ignore storage failures
      }
      const freshRes = await fetch("/api/flask/me", {
        cache: "no-store",
        headers: { Authorization: token ? `Bearer ${token}` : "" },
      });
      const freshJson = (await readJson(freshRes)) as TermsProfile;
      const nextProfile = freshRes.ok ? freshJson : json;
      setProfile(nextProfile);
      if (nextProfile.display_name && nextProfile.handle) {
        router.replace("/user");
      } else {
        router.replace("/onboarding");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const continueNext = () => {
    if (profile?.display_name && profile?.handle) {
      router.replace("/user");
      return;
    }
    router.replace("/onboarding");
  };

  if (!isLoaded || loading) {
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-4xl flex-1 items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-black dark:text-zinc-400">
          Loading terms...
        </div>
      </main>
    );
  }

  if (!isSignedIn) {
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-4xl flex-1 items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="w-full max-w-2xl rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
          <div className="space-y-2">
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
              Terms of Service
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Read the legal terms first
            </h1>
            <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Sign in to accept the terms and finalize your account.
            </p>
          </div>
          <div className="mt-6">
            <Link
              href="/sign-in"
              className="inline-flex items-center justify-center rounded-full bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
      <section className="rounded-3xl border border-zinc-200 bg-white px-5 py-6 shadow-sm dark:border-zinc-800 dark:bg-black sm:px-8 sm:py-8">
        <div className="space-y-3 border-b border-zinc-200 pb-6 dark:border-zinc-800">
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
            Terms of Service
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Sheybi account terms
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            These terms explain how trading, fees, verification, and withdrawals
            work. You must accept them before finalizing your account.
          </p>
        </div>

        <div className="mt-6 grid gap-5 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          <Section title="1. The service">
            Sheybi is a prediction market platform where users can buy and sell positions on market outcomes while a
            market is open. Prices may change as users trade, as market conditions change, and as available liquidity
            changes over time.
          </Section>
          <Section title="2. Eligibility">
            You must be at least 18 years old to use Sheybi. You agree that the details you provide are accurate,
            current, and belong to you. You may not use automated means, bots, or scripts to access the service. You
            are responsible for keeping your account information current, including your name, phone number, email,
            and withdrawal details.
          </Section>
          <Section title="3. Trading risk">
            Trading on Sheybi involves financial risk. You may lose some or all of the amount you use to trade. Market
            prices can move quickly, closed markets stop trading, and outcomes are final once a market is resolved.
          </Section>
          <Section title="4. Fees and pricing">
            We charge a 0.5% buy fee. Sell fees and resolution fees are dynamic and may change based on market
            conditions. Spreads are embedded in quoted prices. You are responsible for reviewing the displayed amount
            before you confirm a trade or withdrawal. Fee schedules, pricing logic, and risk controls may change from
            time to time without prior notice where needed to protect the platform or comply with law.
          </Section>
          <Section title="5. Wallet and withdrawals">
            Wallet balances are denominated in NGN. Deposits are processed through our payment provider, and
            withdrawals are processed through our payout provider or a manual review queue where necessary. A
            withdrawal request deducts the requested amount immediately, but only the portion of your balance that is
            older than the cooling-off period is withdrawable. If a withdrawal is rejected, the deducted amount is
            returned to your wallet.
          </Section>
          <Section title="6. Verification">
            Verification is required before withdrawals can be processed. Depending on your account and the available
            verification paths, you may be asked to provide a live selfie, a BVN, bank account details, a
            government-issued ID, or proof of age. We may refuse, delay, or reverse withdrawals if verification is
            incomplete, inconsistent, or fails review.
          </Section>
          <Section title="7. Account use">
            You are responsible for keeping your account secure and for all activity that occurs under your account.
            We may suspend, restrict, or close accounts where we believe there is misuse, fraud, abuse, chargeback
            risk, or a violation of these terms.
          </Section>
          <Section title="8. Deposits and withdrawal controls">
            Newly deposited funds may be subject to a cooling-off period before they become withdrawable. Older funds
            remain withdrawable as they age out of the cooling period. We may also apply velocity checks, risk review,
            withdrawal limits, and manual review for unusual activity or high-value requests.
          </Section>
          <Section title="9. Third-party services">
            We use third-party providers for authentication, payment processing, bank list retrieval, identity checks,
            and payout processing. Those providers may have their own terms, limitations, and processing delays. We are
            not responsible for downtime or actions taken by those providers outside our control.
          </Section>
          <Section title="10. Records and compliance">
            We may keep records of deposits, withdrawals, verification results, device information, IP addresses, and
            risk signals for compliance, fraud prevention, dispute handling, and support. By using the service, you
            consent to those records being collected and retained as needed for those purposes.
          </Section>
          <Section title="11. No guarantees">
            We do not guarantee profits, uninterrupted access, or any particular market outcome. The service is
            provided on an as-is basis, subject to availability and applicable laws.
          </Section>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6 border-t border-zinc-200 pt-5 dark:border-zinc-800">
          <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            By accepting, you confirm that you understand the trading rules, fee structure, deposit cooling-off rules,
            verification requirements, and withdrawal controls.
          </p>
          <button
            type="button"
            onClick={accepted ? continueNext : acceptTerms}
            disabled={busy}
            className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {accepted ? "Continue" : "Accept terms"}
          </button>
        </div>
      </section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      <p className="leading-6 text-zinc-700 dark:text-zinc-300">{children}</p>
    </section>
  );
}
