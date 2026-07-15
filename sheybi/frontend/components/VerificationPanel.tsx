"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useAuth } from "@clerk/nextjs";
import { BadgeCheckIcon, RefreshCwIcon, ShieldAlertIcon, UploadCloudIcon, XIcon } from "lucide-react";

type VerificationStatus = "unsubmitted" | "submitted" | "pending_review" | "approved" | "rejected";
type DocType = "nin_slip" | "passport" | "voters_card";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

type VerificationResponse = {
  user_id: string;
  display_name?: string | null;
  handle?: string | null;
  verified?: boolean;
  verification_status?: VerificationStatus | null;
  verification_ready?: boolean | null;
  verification_tier1_complete?: boolean | null;
  verification_tier2_complete?: boolean | null;
  verification_tier2_documents?: Array<{ document_type?: string | null }> | null;
  id_document_type?: DocType | null;
  age_proof_type?: DocType | null;
  document_url?: string | null;
  age_proof_url?: string | null;
  selfie_url?: string | null;
  verification_submitted_at?: number | string | null;
};

type DocOption = {
  value: DocType;
  label: string;
  hint: string;
};

const DOC_OPTIONS: DocOption[] = [
  { value: "nin_slip", label: "National ID", hint: "NIN slip or national ID card" },
  { value: "passport", label: "Passport", hint: "Passport bio page" },
  { value: "voters_card", label: "Voter's card", hint: "Election card / voter ID" },
];

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: "invalid_json", raw: text };
  }
}

function docLabel(type: DocType) {
  return DOC_OPTIONS.find((option) => option.value === type)?.label ?? "Document";
}

function statusLabel(status: VerificationStatus | null | undefined) {
  switch (status) {
    case "approved":
      return "Approved";
    case "submitted":
    case "pending_review":
      return "Submitted";
    case "rejected":
      return "Rejected";
    default:
      return "Unsubmitted";
  }
}

function normalizeDocType(value: string | null | undefined): DocType {
  if (value === "nin_slip" || value === "passport" || value === "voters_card") {
    return value;
  }
  return "nin_slip";
}

function DocPicker({
  value,
  selected,
  disabled,
  onSelect,
}: {
  value: DocType;
  selected: boolean;
  disabled?: boolean;
  onSelect: (value: DocType) => void;
}) {
  const option = DOC_OPTIONS.find((item) => item.value === value);
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      disabled={disabled}
      className={`group rounded-2xl border p-4 text-left transition-all ${
        selected
          ? "border-zinc-950 bg-zinc-950 text-white shadow-sm dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
          : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:text-zinc-50 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{option?.label ?? "Document"}</div>
          <div className={`mt-1 text-xs ${selected ? "text-white/70 dark:text-zinc-700" : "text-zinc-500 dark:text-zinc-400"}`}>
            {option?.hint ?? "Select this document"}
          </div>
        </div>
        <div className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
          selected
            ? "border-white/30 bg-white/15 text-white dark:border-zinc-300 dark:bg-zinc-200 dark:text-zinc-950"
            : "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
        }`}>
          {value === "nin_slip" ? "National" : value === "passport" ? "Passport" : "Card"}
        </div>
      </div>
    </button>
  );
}

function SelfieModal({
  open,
  onClose,
  videoRef,
  canvasRef,
  cameraOn,
  cameraBusy,
  cameraError,
  selfiePreviewUrl,
  selfieFile,
  startCamera,
  stopCamera,
  captureSelfie,
  onRetake,
}: {
  open: boolean;
  onClose: () => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  cameraOn: boolean;
  cameraBusy: boolean;
  cameraError: string | null;
  selfiePreviewUrl: string | null;
  selfieFile: File | null;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  captureSelfie: () => Promise<void>;
  onRetake: () => void;
}) {
  useEffect(() => {
    if (!open) stopCamera();
  }, [open, stopCamera]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-black">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Live selfie</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">Capture a clear face photo in the pop-up.</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-zinc-200 p-2 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <div className="p-4">
          <div className="overflow-hidden rounded-3xl border border-dashed border-zinc-300 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                Camera
              </span>
              <div className="flex gap-2">
                {!cameraOn ? (
                  <button
                    type="button"
                    onClick={() => void startCamera()}
                    disabled={cameraBusy}
                    className="rounded-full bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950"
                  >
                    {cameraBusy ? "Starting..." : "Start camera"}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void captureSelfie()}
                      className="rounded-full bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-950"
                    >
                      Capture
                    </button>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"
                    >
                      Stop
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="relative aspect-[4/3] bg-zinc-950">
              {selfiePreviewUrl ? (
                <Image
                  src={selfiePreviewUrl}
                  alt="Captured selfie"
                  fill
                  unoptimized
                  className="object-cover"
                />
              ) : (
                <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted />
              )}
              {!selfieFile ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 py-2 text-xs text-white">
                  {cameraOn ? "Look into the camera and tap Capture." : "Use the camera to take a live selfie."}
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {selfieFile ? selfieFile.name : "No selfie captured yet."}
              </span>
              {selfieFile ? (
                <button
                  type="button"
                  onClick={onRetake}
                  className="text-xs font-semibold text-zinc-900 underline decoration-zinc-300 underline-offset-4 dark:text-zinc-100"
                >
                  Retake
                </button>
              ) : null}
            </div>
          </div>
          <canvas ref={canvasRef} className="hidden" />
          {cameraError ? (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
              {cameraError}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function VerificationPanel() {
  const { getToken } = useAuth();
  const [data, setData] = useState<VerificationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tier1DocType, setTier1DocType] = useState<DocType>("nin_slip");
  const [tier1DocumentFile, setTier1DocumentFile] = useState<File | null>(null);
  const [tier2DocType, setTier2DocType] = useState<DocType>("passport");
  const [tier2DocumentFile, setTier2DocumentFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [showSelfieModal, setShowSelfieModal] = useState(false);
  const [selfiePreviewUrl, setSelfiePreviewUrl] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const verificationRes = await fetch("/api/flask/me/verification", {
        headers: { Authorization: token ? `Bearer ${token}` : "" },
      });
      const json = (await readJson(verificationRes)) as VerificationResponse;
      if (!verificationRes.ok) throw new Error((json as { error?: string })?.error || `HTTP ${verificationRes.status}`);
      setData(json);
      setTier1DocType(normalizeDocType(json.id_document_type));
      if (json.verification_tier2_documents?.length) {
        setTier2DocType(normalizeDocType(json.verification_tier2_documents[0]?.document_type));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (tier2DocType === tier1DocType) {
      setTier2DocType(tier1DocType === "nin_slip" ? "passport" : "nin_slip");
    }
  }, [tier1DocType, tier2DocType]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!selfieFile) {
      setSelfiePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selfieFile);
    setSelfiePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selfieFile]);

  useEffect(() => {
    return () => {
      const stream = streamRef.current;
      if (stream) stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const stopCamera = useCallback(() => {
    const stream = streamRef.current;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setCameraBusy(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setCameraBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera not supported on this browser.");
      }
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch (e) {
      setCameraError(e instanceof Error ? e.message : String(e));
      stopCamera();
    } finally {
      setCameraBusy(false);
    }
  }, [stopCamera]);

  const captureSelfie = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setCameraError("Camera is not ready yet.");
      return;
    }
    setCameraError(null);
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("Could not access the camera canvas.");
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((next) => resolve(next), "image/jpeg", 0.9);
    });
    if (!blob) {
      setCameraError("Could not capture the selfie.");
      return;
    }
    setSelfieFile(new File([blob], `selfie-${Date.now()}.jpg`, { type: "image/jpeg" }));
    stopCamera();
    setShowSelfieModal(false);
  }, [stopCamera]);

  const submitTier1 = useCallback(async () => {
    if (!tier1DocumentFile || !selfieFile) {
      setError("Pick a document and capture a live selfie first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const form = new FormData();
      form.set("verification_tier", "tier1");
      form.set("document_type", tier1DocType);
      form.set("document_image", tier1DocumentFile);
      form.set("selfie_image", selfieFile);
      const res = await fetch("/api/flask/me/verification", {
        method: "POST",
        headers: { Authorization: token ? `Bearer ${token}` : "" },
        body: form,
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error((json as { error?: string })?.error || `HTTP ${res.status}`);
      setData(json as VerificationResponse);
      setTier1DocumentFile(null);
      setSelfieFile(null);
      setShowSelfieModal(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [getToken, load, selfieFile, tier1DocType, tier1DocumentFile]);

  const submitTier2 = useCallback(async () => {
    if (!tier2DocumentFile) {
      setError("Pick one additional document for tier 2.");
      return;
    }
    if (tier2DocType === tier1DocType) {
      setError("Tier 2 must use a different document than tier 1.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const form = new FormData();
      form.set("verification_tier", "tier2");
      form.set("document_type", tier2DocType);
      form.set("document_image", tier2DocumentFile);
      const res = await fetch("/api/flask/me/verification", {
        method: "POST",
        headers: { Authorization: token ? `Bearer ${token}` : "" },
        body: form,
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error((json as { error?: string })?.error || `HTTP ${res.status}`);
      setData(json as VerificationResponse);
      setTier2DocumentFile(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [getToken, load, tier1DocType, tier2DocType, tier2DocumentFile]);

  const status = data?.verification_status ?? "unsubmitted";
  const approved = status === "approved" || !!data?.verified;
  const tier1Complete = !!data?.verification_tier1_complete;
  const tier2Complete = !!data?.verification_tier2_complete;
  const locked = approved || tier2Complete;
  const showTier1 = (!approved && (!tier1Complete || status === "rejected") && !tier2Complete);
  const showTier2 = approved && tier1Complete && !tier2Complete;

  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-black sm:p-6">
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-5 dark:border-zinc-800 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            Verification
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Identity check
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Complete tier 1 to unlock tier 2. After tier 2, the form locks and only your status remains.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 self-start">
          <div
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              approved
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                : status === "rejected"
                  ? "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
            }`}
          >
            {statusLabel(status)}
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
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4">
        <div className="rounded-2xl bg-zinc-50 p-5 dark:bg-zinc-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                Verification status
              </div>
              <div className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {locked
                  ? "Verification is locked."
                  : status === "rejected"
                    ? "Verification was rejected. Tier 1 is open again so you can resubmit."
                  : approved && tier1Complete
                    ? "Tier 1 approved. Tier 2 is unlocked."
                    : tier1Complete
                      ? "Tier 1 submitted. Waiting for approval to unlock tier 2."
                      : "Choose an ID, capture a selfie, and submit tier 1."}
              </div>
            </div>
            <div
              className={`flex size-12 items-center justify-center rounded-2xl ${
                approved
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                  : status === "rejected"
                    ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
              }`}
            >
              {approved ? <BadgeCheckIcon className="size-6" /> : <ShieldAlertIcon className="size-6" />}
            </div>
          </div>
        </div>

        {showTier1 ? (
          <div className="grid gap-4 rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-black">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              <UploadCloudIcon className="size-4" />
              Tier 1
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {DOC_OPTIONS.map((option) => (
                <DocPicker
                  key={option.value}
                  value={option.value}
                  selected={tier1DocType === option.value}
                  onSelect={(value) => setTier1DocType(value)}
                />
              ))}
            </div>
            <label className="grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              Upload {docLabel(tier1DocType)}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  if (file && file.size > MAX_UPLOAD_BYTES) {
                    setError("Document must be 5MB or smaller.");
                    return;
                  }
                  setError(null);
                  setTier1DocumentFile(file);
                }}
                className="block w-full rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-3 py-3 text-sm text-zinc-700 file:mr-4 file:rounded-full file:border-0 file:bg-zinc-950 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:file:bg-zinc-100 dark:file:text-zinc-950"
              />
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {tier1DocumentFile ? tier1DocumentFile.name : "Upload a clear photo of the selected document."}
              </span>
            </label>
            <button
              type="button"
              onClick={() => setShowSelfieModal(true)}
              disabled={!tier1DocumentFile}
              className="inline-flex w-fit items-center gap-2 rounded-full bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Open live selfie
            </button>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {selfieFile ? "Selfie captured." : "Selfie capture opens in a pop-up."}
              </div>
              <button
                type="button"
                onClick={() => void submitTier1()}
                disabled={busy || !tier1DocumentFile || !selfieFile}
                className="inline-flex items-center gap-2 rounded-full bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                Submit tier 1
              </button>
            </div>
          </div>
        ) : null}

        {showTier2 ? (
          <div className="grid gap-4 rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-black">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              <UploadCloudIcon className="size-4" />
              Tier 2
            </div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              Upload one different document to complete tier 2.
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {DOC_OPTIONS.map((option) => (
                <DocPicker
                  key={option.value}
                  value={option.value}
                  selected={tier2DocType === option.value}
                  disabled={option.value === tier1DocType}
                  onSelect={(value) => {
                    if (value === tier1DocType) {
                      setError("Tier 2 must use a different document than tier 1.");
                      return;
                    }
                    setError(null);
                    setTier2DocType(value);
                  }}
                />
              ))}
            </div>
            <label className="grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              Upload {docLabel(tier2DocType)}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  if (file && file.size > MAX_UPLOAD_BYTES) {
                    setError("Document must be 5MB or smaller.");
                    return;
                  }
                  setError(null);
                  setTier2DocumentFile(file);
                }}
                className="block w-full rounded-xl border border-dashed border-zinc-300 bg-white px-3 py-3 text-sm text-zinc-700 file:mr-4 file:rounded-full file:border-0 file:bg-zinc-950 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:file:bg-zinc-100 dark:file:text-zinc-950"
              />
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {tier2DocumentFile ? tier2DocumentFile.name : "Upload one additional document."}
              </span>
            </label>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                One additional document completes tier 2.
              </div>
              <button
                type="button"
                onClick={() => void submitTier2()}
                disabled={busy || !tier2DocumentFile || tier2DocType === tier1DocType}
                className="inline-flex items-center gap-2 rounded-full bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                Submit tier 2
              </button>
            </div>
          </div>
        ) : null}

        {locked ? (
          <div className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-black">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              <BadgeCheckIcon className="size-4" />
              Verification status
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Tier 1</div>
                <div className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {tier1Complete ? "Approved" : "Pending review"}
                </div>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Tier 2</div>
                <div className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {tier2Complete ? "Approved" : "Pending review"}
                </div>
              </div>
            </div>
            <div className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
              {approved
                ? "Identity verified."
                : status === "rejected"
                  ? "Verification was rejected. Resubmit tier 1 to try again."
                  : "Your verification is locked while review is in progress."}
            </div>
          </div>
        ) : null}
      </div>

      <SelfieModal
        open={showSelfieModal}
        onClose={() => {
          setShowSelfieModal(false);
          stopCamera();
        }}
        videoRef={videoRef}
        canvasRef={canvasRef}
        cameraOn={cameraOn}
        cameraBusy={cameraBusy}
        cameraError={cameraError}
        selfiePreviewUrl={selfiePreviewUrl}
        selfieFile={selfieFile}
        startCamera={startCamera}
        stopCamera={stopCamera}
        captureSelfie={captureSelfie}
        onRetake={() => {
          setSelfieFile(null);
          void startCamera();
        }}
      />
    </section>
  );
}
