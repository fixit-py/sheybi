"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

type Profile = {
  user_id: string;
  display_name: string | null;
  handle: string | null;
  bio: string | null;
  avatar_url: string | null;
  verified: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: "invalid_json", raw: text };
  }
}

export default function ProfileEditor() {
  const { getToken } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({
    display_name: "",
    handle: "",
    bio: "",
    avatar_url: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const token = await getToken();
      const res = await fetch("/api/flask/me", {
        headers: { Authorization: token ? `Bearer ${token}` : "" },
      });
      const json = (await readJson(res)) as Profile;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProfile(json);
      setForm({
        display_name: json.display_name ?? "",
        handle: json.handle ?? "",
        bio: json.bio ?? "",
        avatar_url: json.avatar_url ?? "",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

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
        body: JSON.stringify(form),
      });
      const json = (await readJson(res)) as Profile;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProfile(json);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Profile
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Stored in SQLite (separate from Clerk).
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          Refresh
        </button>
      </div>

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
        <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Display name
          <input
            value={form.display_name}
            onChange={(e) =>
              setForm((s) => ({ ...s, display_name: e.target.value }))
            }
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
            placeholder="e.g. Folahanmi"
          />
        </label>

        <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Handle
          <input
            value={form.handle}
            onChange={(e) => setForm((s) => ({ ...s, handle: e.target.value }))}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
            placeholder="e.g. @fola"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-4">
        <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Bio
          <textarea
            value={form.bio}
            onChange={(e) => setForm((s) => ({ ...s, bio: e.target.value }))}
            className="min-h-24 resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
            placeholder="Short description…"
          />
        </label>

        <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Avatar URL
          <input
            value={form.avatar_url}
            onChange={(e) =>
              setForm((s) => ({ ...s, avatar_url: e.target.value }))
            }
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:focus:border-zinc-600"
            placeholder="https://…"
          />
        </label>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          Your id: {profile?.user_id ?? "—"}
          {profile?.verified ? " · Verified" : ""}
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

