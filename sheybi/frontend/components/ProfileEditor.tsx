"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { PencilIcon } from "lucide-react";

import { db, hasInstantConfig } from "@/lib/instant";

type Profile = {
  user_id: string;
  display_name: string | null;
  handle: string | null;
  email?: string | null;
  secondary_email?: string | null;
  phone_number: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  verified: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

type InstantProfile = {
  id: string;
  userId?: string | null;
  display_name?: string | null;
  handle?: string | null;
  email?: string | null;
  secondary_email?: string | null;
  verified?: boolean | null;
  createdAt?: number | string | null;
  updatedAt?: number | string | null;
};

type ProfileForm = {
  phone_number: string;
  secondary_email: string;
};

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: "invalid_json", raw: text };
  }
}

function InstantProfileBridge({
  userId,
  onProfile,
  onForm,
}: {
  userId: string | null | undefined;
  onProfile: Dispatch<SetStateAction<Profile | null>>;
  onForm: Dispatch<SetStateAction<ProfileForm>>;
}) {
  if (!hasInstantConfig || !db || !userId) return null;

  return (
    <InstantProfileBridgeInner
      userId={userId}
      onProfile={onProfile}
      onForm={onForm}
    />
  );
}

function InstantProfileBridgeInner({
  userId,
  onProfile,
  onForm,
}: {
  userId: string;
  onProfile: Dispatch<SetStateAction<Profile | null>>;
  onForm: Dispatch<SetStateAction<ProfileForm>>;
}) {
  const instantDb = db as NonNullable<typeof db>;

  const profileQuery = instantDb.useQuery({
    profiles: {
      $: {
        where: {
          userId,
        },
      },
    },
  });

  useEffect(() => {
    const rows = (profileQuery.data?.profiles ?? []) as InstantProfile[];
    const next = rows[0] ?? null;
    if (!next) {
      return;
    }
    const profile: Profile = {
      user_id: next.userId ?? userId,
      display_name: next.display_name ?? null,
      handle: next.handle ?? null,
      email: next.email ?? null,
      secondary_email: next.secondary_email ?? null,
      phone_number: (next as { phone_number?: string | null }).phone_number ?? null,
      first_name: (next as { first_name?: string | null }).first_name ?? null,
      middle_name: (next as { middle_name?: string | null }).middle_name ?? null,
      last_name: (next as { last_name?: string | null }).last_name ?? null,
      verified: !!next.verified,
      created_at:
        typeof next.createdAt === "number"
          ? new Date(next.createdAt).toISOString()
          : typeof next.createdAt === "string"
            ? next.createdAt
            : null,
      updated_at:
        typeof next.updatedAt === "number"
          ? new Date(next.updatedAt).toISOString()
          : typeof next.updatedAt === "string"
            ? next.updatedAt
            : null,
    };
    onProfile((prev) => {
      if (!prev) return profile;
      return {
        ...prev,
        ...Object.fromEntries(
          Object.entries(profile).filter(([, value]) => value !== null && value !== undefined),
        ),
      };
    });
    onForm((prev) => ({
      ...prev,
      ...(profile.phone_number?.trim() ? { phone_number: profile.phone_number } : {}),
      ...(profile.secondary_email?.trim() ? { secondary_email: profile.secondary_email } : {}),
    }));
  }, [onForm, onProfile, profileQuery.data, userId]);

  return null;
}

export default function ProfileEditor() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<ProfileForm>({
    phone_number: "",
    secondary_email: "",
  });
  const [editingPhone, setEditingPhone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const token = await getToken();
      const res = await fetch("/api/flask/me", {
          cache: "no-store",
        headers: { Authorization: token ? `Bearer ${token}` : "" },
      });
      const json = (await readJson(res)) as Profile;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProfile(json);
      setForm({
        phone_number: json.phone_number ?? "",
        secondary_email: json.secondary_email ?? "",
      });
      setEditingPhone(!json.phone_number);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [getToken]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const token = await getToken();
      const res = await fetch("/api/flask/me/profile", {
        method: "PUT",
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phone_number: form.phone_number,
          secondary_email: form.secondary_email,
        }),
      });
      const json = (await readJson(res)) as Profile;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProfile(json);
      setForm({
        phone_number: json.phone_number ?? "",
        secondary_email: json.secondary_email ?? "",
      });
      setEditingPhone(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Account details
          </div>
        </div>
        {hasInstantConfig && db ? null : (
          <button
            type="button"
            onClick={load}
            disabled={busy}
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            Refresh
          </button>
        )}
      </div>

      <InstantProfileBridge
        userId={user?.id}
        onProfile={setProfile}
        onForm={setForm}
      />

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          Error: {error}
        </div>
      ) : null}

      {saved ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          Saved.
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ReadOnlyField label="Legal name" value={formatLegalName(profile)} />
        <ReadOnlyField label="User tag" value={profile?.handle ? `@${profile.handle}` : "—"} />
        <ReadOnlyField label="Email" value={profile?.email ?? user?.primaryEmailAddress?.emailAddress ?? "—"} />
        <ReadOnlyField label="Profile" value={profile?.verified ? "Verified" : "Onboarding complete"} />
      </div>

      <div className="mt-4 grid gap-4">
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900/60">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                Phone number
              </div>
              <div className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {form.phone_number ? form.phone_number : "—"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEditingPhone((current) => !current)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
              aria-label={editingPhone ? "Close phone editor" : "Edit phone number"}
            >
              <PencilIcon className="h-4 w-4" />
            </button>
          </div>
          {editingPhone ? (
            <input
              inputMode="tel"
              value={form.phone_number}
              onChange={(e) =>
                setForm((s) => ({ ...s, phone_number: e.target.value }))
              }
              className="mt-3 h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600 dark:disabled:bg-zinc-900 dark:disabled:text-zinc-500"
              placeholder="e.g. 08012345678"
            />
          ) : null}
        </div>

        <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Secondary email
          <input
            inputMode="email"
            value={form.secondary_email}
            onChange={(e) =>
              setForm((s) => ({ ...s, secondary_email: e.target.value }))
            }
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600 dark:disabled:bg-zinc-900 dark:disabled:text-zinc-500"
            placeholder="e.g. name@domain.com"
          />
        </label>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          Identity fields are locked after signup. You can update phone and secondary email here.
        </div>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Save
        </button>
      </div>
    </section>
  );
}

function formatLegalName(profile: Profile | null) {
  if (!profile) return "—";
  const parts = [profile.first_name, profile.middle_name, profile.last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" ") : profile.display_name ?? "—";
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
        {value}
      </div>
    </div>
  );
}
