"use client";

import { useAuth } from "@clerk/nextjs";

export default function TestButton() {
  const { getToken } = useAuth();

  const test = async () => {
    const token = await getToken();

    const res = await fetch("http://localhost:5000/api/markets", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    console.log(await res.json());
  };

  return <button onClick={test}>Test Flask Auth</button>;
}
