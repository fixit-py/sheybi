"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  BadgeCheckIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from "lucide-react";

type VerificationResponse = {
  user_id: string;
  display_name?: string | null;
  handle?: string | null;
  phone_number?: string | null;
  bvn?: string | null;
  nin?: string | null;
  passport_number?: string | null;
  verified?: boolean;
  kyc_status?: string | null;
  kyc_complete?: boolean | null;
  created_at?: string | number | null;
  updated_at?: string | number | null;
};

type DocType = "bvn" | "nin" | "passport_number";

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: "invalid_json", raw: text };
  }
}

function formatIso(value: string | number | null | undefined) {
  if (value == null) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function mask(value: string | null | undefined, visible = 4) {
  const text = value?.trim() || "";
  if (!text) return "—";
  if (text.length <= visible) return text;
  return `${"*".repeat(Math.max(0, text.length - visible))}${text.slice(-visible)}`;
}

function docLabel(type: DocType) {
  switch (type) {
    case "bvn":
      return "BVN";
    case "nin":
      return "NIN";
    case "passport_number":
      return "Passport number";
  }
}

function docValue(data: VerificationResponse | null, type: DocType) {
  switch (type) {
    case "bvn":
      return data?.bvn ?? "";
    case "nin":
      return data?.nin ?? "";
    case "passport_number":
      return data?.passport_number ?? "";
  }
}

export default function VerificationPanel() {
  const { getToken } = useAuth();
  const [data, setData] = useState<VerificationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [docType, setDocType] = useState<DocType>("bvn");
  const [documentNumber, setDocumentNumber] = useState("");
  const [step, setStep] = useState(0);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/flask/me", {
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
        },
      });
      const json = (await readJson(res)) as VerificationResponse;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(json);
      setPhoneNumber(json.phone_number?.trim() || "");
      const nextDocType: DocType =
        json.bvn?.trim()
          ? "bvn"
          : json.nin?.trim()
            ? "nin"
            : json.passport_number?.trim()
              ? "passport_number"
              : "bvn";
      setDocType(nextDocType);
      setDocumentNumber(docValue(json, nextDocType).trim());
      setStep(json.phone_number?.trim() ? (json.kyc_complete ? 3 : 1) : 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [getToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const kycComplete = !!data?.kyc_complete || Boolean(phoneNumber.trim() && documentNumber.trim());
  const isVerified = !!data?.verified;
  const status = isVerified ? "Approved" : kycComplete ? "Submitted" : "Incomplete";
  const selectedDocLabel = docLabel(docType);
  const selectedDocValue = docValue(data, docType);
  const canContinuePhone = !!phoneNumber.trim();
  const canContinueDoc = !!docType;
  const canContinueNumber = !!documentNumber.trim();

  const steps = useMemo(
    () => [
      { title: "Phone", done: canContinuePhone },
      { title: "ID type", done: canContinueDoc },
      { title: "Number", done: canContinueNumber },
      { title: "Review", done: kycComplete },
    ],
    [canContinueDoc, canContinueNumber, canContinuePhone, kycComplete],
  );

  const save = async () => {
    const nextPhone = phoneNumber.trim();
    const nextDoc = documentNumber.trim();
    if (!nextPhone || !nextDoc) {
      setError("Phone number and one document are required.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const payload: Record<string, string> = {
        phone_number: nextPhone,
        bvn: "",
        nin: "",
        passport_number: "",
      };
      payload[docType] = nextDoc;
      const res = await fetch("/api/flask/me/profile", {
        method: "PUT",
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const json = await readJson(res);
      if (!res.ok) {
        throw new Error((json as { error?: string })?.error || `HTTP ${res.status}`);
      }
      await load();
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Verification
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Choose one ID type and submit it here. Verification is reviewed
            manually.
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          <RefreshCwIcon className="size-4" />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          Error: {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-zinc-50 p-5 dark:bg-zinc-900">
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            Status
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div
              className={`flex size-12 items-center justify-center rounded-2xl ${
                isVerified
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
              }`}
            >
              {isVerified ? (
                <BadgeCheckIcon className="size-6" />
              ) : (
                <ShieldAlertIcon className="size-6" />
              )}
            </div>
            <div>
              <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                {isVerified ? "Verified" : "Not verified"}
              </div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                {isVerified
                  ? "Your account has been approved."
                  : kycComplete
                    ? "Your documents are submitted and waiting for review."
                    : "Submit one government ID to begin review."}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
              Status: {status}
            </span>
            <span className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
              Review: Manual
            </span>
          </div>
        </div>

        <div className="rounded-2xl bg-zinc-50 p-5 dark:bg-zinc-900">
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            Submitted data
          </div>
          <div className="mt-4 grid gap-3 text-sm text-zinc-600 dark:text-zinc-400">
            <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 dark:bg-black">
              <span>Phone</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                {mask(phoneNumber, 4)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 dark:bg-black">
              <span>{selectedDocLabel}</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                {mask(selectedDocValue, 3)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 dark:bg-black">
              <span>Last updated</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                {formatIso(data?.updated_at || data?.created_at)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              KYC stepper
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Complete each step in order, then review before submitting.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {steps.map((item, index) => {
              const active = index === step;
              return (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => setStep(index)}
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                    active
                      ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"
                      : item.done
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
                        : "border border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
                  }`}
                >
                  {item.done ? <CheckIcon className="size-3.5" /> : index + 1}
                  <span>{item.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 rounded-2xl bg-zinc-50 p-5 dark:bg-zinc-900">
          {step === 0 ? (
            <div className="grid gap-4">
              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Phone number
                <input
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                  placeholder="+234..."
                  autoComplete="tel"
                  inputMode="tel"
                />
              </label>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => canContinuePhone && setStep(1)}
                  disabled={!canContinuePhone}
                  className="inline-flex items-center gap-2 rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  Continue
                  <ChevronRightIcon className="size-4" />
                </button>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-4">
              <div className="grid gap-2 sm:grid-cols-3">
                {(["bvn", "nin", "passport_number"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setDocType(type);
                      setDocumentNumber(docValue(data, type));
                    }}
                    className={`rounded-2xl border px-4 py-4 text-left text-sm font-medium transition-colors ${
                      docType === type
                        ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                        : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <div className="text-[11px] uppercase tracking-[0.24em] opacity-70">
                      ID Type
                    </div>
                    <div className="mt-2 text-sm">{docLabel(type)}</div>
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  <ChevronLeftIcon className="size-4" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => canContinueDoc && setStep(2)}
                  disabled={!canContinueDoc}
                  className="inline-flex items-center gap-2 rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  Continue
                  <ChevronRightIcon className="size-4" />
                </button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-4">
              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                {selectedDocLabel}
                <input
                  value={documentNumber}
                  onChange={(e) => setDocumentNumber(e.target.value)}
                  className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                  placeholder={`Enter your ${selectedDocLabel.toLowerCase()}`}
                  autoComplete="off"
                />
              </label>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  <ChevronLeftIcon className="size-4" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => canContinueNumber && setStep(3)}
                  disabled={!canContinueNumber}
                  className="inline-flex items-center gap-2 rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  Review
                  <ChevronRightIcon className="size-4" />
                </button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-white p-4 dark:bg-black">
                  <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    Phone
                  </div>
                  <div className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {mask(phoneNumber, 4)}
                  </div>
                </div>
                <div className="rounded-2xl bg-white p-4 dark:bg-black">
                  <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                    Document
                  </div>
                  <div className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {selectedDocLabel}: {mask(documentNumber, 3)}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  <ChevronLeftIcon className="size-4" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-full bg-zinc-950 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  Save verification
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
