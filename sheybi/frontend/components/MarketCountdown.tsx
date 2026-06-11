"use client";

import { useEffect, useMemo, useState } from "react";

function formatCountdown(ms: number) {
  if (ms <= 0) {
    return "Closed";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export default function MarketCountdown({
  closeIso,
  className = "",
  prefix = "Closes in",
}: {
  closeIso: string | null | undefined;
  className?: string;
  prefix?: string;
}) {
  const closeTime = useMemo(() => {
    if (!closeIso) return null;
    const parsed = new Date(closeIso).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }, [closeIso]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!closeTime) {
    return <span className={className}>—</span>;
  }

  const remaining = closeTime - now;
  const label = remaining <= 0 ? "Closed" : `${prefix} ${formatCountdown(remaining)}`;

  return <span className={className}>{label}</span>;
}
