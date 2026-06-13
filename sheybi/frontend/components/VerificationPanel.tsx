"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  BadgeCheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  UploadCloudIcon,
} from "lucide-react";

type VerificationStatus = "unsubmitted" | "pending_review" | "approved" | "rejected";
type DocType = "nin_slip" | "voters_card" | "passport" | "no_id";
type AgeProofType = "work_id" | "student_card" | "university_id" | "birth_certificate";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

type VerificationResponse = {
  user_id: string;
  display_name?: string | null;
  handle?: string | null;
  verified?: boolean;
  verification_status?: VerificationStatus | null;
  verification_ready?: boolean | null;
  id_document_type?: DocType | null;
  age_proof_type?: AgeProofType | null;
  document_url?: string | null;
  age_proof_url?: string | null;
  selfie_url?: string | null;
  verification_notes?: string | null;
  verification_submitted_at?: number | string | null;
  verification_reviewed_at?: number | string | null;
};

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

function docLabel(type: DocType) {
  switch (type) {
    case "nin_slip":
      return "NIN slip";
    case "voters_card":
      return "Voter's card";
    case "passport":
      return "Passport";
    case "no_id":
      return "No ID";
  }
}

function ageProofLabel(type: AgeProofType) {
  switch (type) {
    case "work_id":
      return "Work ID";
    case "student_card":
      return "Student card";
    case "university_id":
      return "University ID";
    case "birth_certificate":
      return "Birth certificate";
  }
}

function statusLabel(status: VerificationStatus | null | undefined) {
  switch (status) {
    case "approved":
      return "Approved";
    case "pending_review":
      return "Pending review";
    case "rejected":
      return "Rejected";
    default:
      return "Unsubmitted";
  }
}

export default function VerificationPanel() {
  const { getToken } = useAuth();
  const [data, setData] = useState<VerificationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docType, setDocType] = useState<DocType>("nin_slip");
  const [ageProofType, setAgeProofType] = useState<AgeProofType>("birth_certificate");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [ageProofFile, setAgeProofFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [selfiePreviewUrl, setSelfiePreviewUrl] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/flask/me/verification", {
        headers: { Authorization: token ? `Bearer ${token}` : "" },
      });
      const json = (await readJson(res)) as VerificationResponse;
      if (!res.ok) throw new Error((json as { error?: string })?.error || `HTTP ${res.status}`);
      setData(json);
      setDocType(json.id_document_type ?? "nin_slip");
      setAgeProofType(json.age_proof_type ?? "birth_certificate");
      setStep(json.verification_status === "approved" ? 3 : json.verification_status === "pending_review" ? 2 : 0);
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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
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
  }, [stopCamera]);

  const status = data?.verification_status ?? "unsubmitted";
  const approved = status === "approved" || !!data?.verified;
  const needsAgeProof = docType === "no_id";
  const steps = useMemo(
    () => [
      { title: needsAgeProof ? "Age proof" : "Document", done: needsAgeProof ? !!ageProofFile || !!data?.age_proof_url : !!documentFile || !!data?.document_url },
      { title: "Photo", done: !!selfieFile || !!data?.selfie_url },
      { title: "Review", done: approved || status === "pending_review" },
      { title: "Approved", done: approved },
    ],
    [approved, ageProofFile, data?.age_proof_url, data?.document_url, data?.selfie_url, documentFile, needsAgeProof, selfieFile, status],
  );

  const canSubmit = !!selfieFile && (needsAgeProof ? !!ageProofFile : !!documentFile);

  const validateUpload = useCallback(
    (file: File | null, kind: "document" | "age proof") => {
      if (!file) return null;
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`${kind} must be 5MB or smaller.`);
        return null;
      }
      return file;
    },
    [],
  );

  const save = async () => {
    if (!canSubmit) {
      setError("Capture the selfie and upload the required document first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const form = new FormData();
      form.set("document_type", docType);
      form.set("selfie_image", selfieFile as File);
      if (needsAgeProof) {
        form.set("age_proof_type", ageProofType);
        form.set("age_proof_image", ageProofFile as File);
      } else {
        form.set("document_image", documentFile as File);
      }
      const res = await fetch("/api/flask/me/verification", {
        method: "POST",
        headers: { Authorization: token ? `Bearer ${token}` : "" },
        body: form,
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error((json as { error?: string })?.error || `HTTP ${res.status}`);
      setData(json as VerificationResponse);
      setStep(2);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-black sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Verification</div>
          <div className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            Submit one document, a live selfie, and we will review it manually before withdrawals are enabled.
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

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        {steps.map((item, index) => (
          <div
            key={item.title}
            className={`rounded-2xl border px-3 py-3 text-xs font-semibold uppercase tracking-[0.18em] ${
              item.done
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200"
                : step === index
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                  : "border-zinc-200 bg-white text-zinc-500 dark:border-zinc-800 dark:bg-black dark:text-zinc-400"
            }`}
          >
            {item.title}
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="rounded-2xl bg-zinc-50 p-5 dark:bg-zinc-900">
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Status</div>
            <div className="mt-3 flex items-center gap-3">
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
              <div>
                <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{statusLabel(status)}</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {approved
                    ? "Your verification is approved. Withdrawals are enabled."
                    : status === "pending_review"
                      ? "Your documents are waiting for admin review."
                      : "Upload your document and live selfie to submit for review."}
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                Manual review
              </span>
              <span className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                Name: {data?.display_name || data?.handle || "—"}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-black">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              <UploadCloudIcon className="size-4" />
              Upload documents
            </div>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                ID type
                <select
                  value={docType}
                  onChange={(e) => {
                    const next = e.target.value as DocType;
                    setDocType(next);
                    setDocumentFile(null);
                    setAgeProofFile(null);
                  }}
                  className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                >
                  <option value="nin_slip">NIN slip</option>
                  <option value="voters_card">Voter&apos;s card</option>
                  <option value="passport">Passport</option>
                  <option value="no_id">No ID</option>
                </select>
              </label>

              {needsAgeProof ? (
                <label className="grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  Age proof type
                  <select
                    value={ageProofType}
                    onChange={(e) => setAgeProofType(e.target.value as AgeProofType)}
                    className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
                  >
                    <option value="work_id">Work ID</option>
                    <option value="student_card">Student card</option>
                    <option value="university_id">University ID</option>
                    <option value="birth_certificate">Birth certificate</option>
                  </select>
                </label>
              ) : null}

              <label className="grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                {needsAgeProof ? `Upload ${ageProofLabel(ageProofType)}` : `Picture of ${docLabel(docType)}`}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    const nextFile = validateUpload(file, needsAgeProof ? "age proof" : "document");
                    if (nextFile) {
                      setError(null);
                    }
                    if (needsAgeProof) setAgeProofFile(nextFile);
                    else setDocumentFile(nextFile);
                  }}
                  className="block w-full rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-3 py-3 text-sm text-zinc-700 file:mr-4 file:rounded-full file:border-0 file:bg-zinc-950 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:file:bg-zinc-100 dark:file:text-zinc-950"
                />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {needsAgeProof
                    ? ageProofFile
                      ? ageProofFile.name
                      : "Capture a clear photo of the proof."
                  : documentFile
                    ? documentFile.name
                    : "Capture a clear photo of the document."}
                </span>
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">Max 5MB.</span>
              </label>

              <label className="grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                Live selfie
                <div className="overflow-hidden rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
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
                      <img src={selfiePreviewUrl} alt="Captured selfie" className="absolute inset-0 h-full w-full object-cover" />
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
                        onClick={() => {
                          setSelfieFile(null);
                          void startCamera();
                        }}
                        className="text-xs font-semibold text-zinc-900 underline decoration-zinc-300 underline-offset-4 dark:text-zinc-100"
                      >
                        Retake
                      </button>
                    ) : null}
                  </div>
                </div>
              </label>
              <canvas ref={canvasRef} className="hidden" />
              {cameraError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
                  {cameraError}
                </div>
              ) : null}

              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs leading-5 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                Withdrawals are blocked until an admin approves this submission.
                The account name on withdrawal must match at least two parts of
                your profile name.
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={save}
              disabled={busy || !canSubmit}
              className="inline-flex items-center gap-2 rounded-full bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Submit for review
            </button>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {approved ? "Approved" : "Pending admin approval"}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl bg-zinc-50 p-5 dark:bg-zinc-900">
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              Submitted
            </div>
            <div className="mt-3 space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
              <div className="flex items-center justify-between gap-3">
                <span>Document</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {data?.id_document_type ? docLabel(data.id_document_type) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Age proof</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {data?.age_proof_type ? ageProofLabel(data.age_proof_type) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Submitted</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {formatIso(data?.verification_submitted_at)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Reviewed</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {formatIso(data?.verification_reviewed_at)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Document file</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {data?.document_url ? "Available" : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Age proof file</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {data?.age_proof_url ? "Available" : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Selfie file</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {data?.selfie_url ? "Available" : "—"}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-black">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Review notes
            </div>
            <div className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              {data?.verification_notes || "No notes yet."}
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              <ChevronLeftIcon className="size-4" />
              Manual review required before withdrawals
              <ChevronRightIcon className="size-4" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
