"use client";

import { useAuth } from "@clerk/nextjs";

export default function TestButton() {
  const { getToken } = useAuth();

  const test = async () => {
    const token = await getToken();

    const res = await fetch("/api/flask/markets", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    console.log(await res.json());
  };

  return (
    <button
      type="button"
      onClick={test}
      className="flex h-12 w-full items-center justify-center rounded-full border border-solid border-black/[.08] px-5 text-base font-medium transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a] md:w-[158px]"
    >
      Test Flask Auth
    </button>
  );
}
