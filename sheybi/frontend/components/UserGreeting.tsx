"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: "invalid_json", raw: text };
  }
}

type Profile = {
  handle?: string | null;
};

export default function UserGreeting() {
  const { getToken } = useAuth();
  const [handle, setHandle] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const token = await getToken();
        const res = await fetch("/api/flask/me", {
          headers: { Authorization: token ? `Bearer ${token}` : "" },
        });
        const json = (await readJson(res)) as Profile | { error?: string };
        if (!res.ok || cancelled) return;
        const nextHandle =
          typeof json === "object" && json && "handle" in json
            ? json.handle?.trim() ?? ""
            : "";
        if (!cancelled) setHandle(nextHandle);
      } catch {
        if (!cancelled) setHandle("");
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [getToken]);

  return (
    <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
      {handle ? `Hello @${handle}` : "Hello"}
    </h1>
  );
}
