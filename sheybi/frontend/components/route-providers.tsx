"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/AppShell";
import { InstantProvider } from "@/components/instant-provider";

const clerkRoutes = ["/sign-in", "/sign-up"];
const protectedRoutes = ["/terms", "/onboarding", "/user", "/su-admin"];

function matchesRoute(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function shouldUseClerk(pathname: string) {
  return clerkRoutes.some((route) => matchesRoute(pathname, route)) ||
    protectedRoutes.some((route) => matchesRoute(pathname, route));
}

export function RouteProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (pathname === "/") {
    return <ClerkProvider publishableKey={publishableKey ?? undefined}>{children}</ClerkProvider>;
  }

  if (!shouldUseClerk(pathname)) {
    return <>{children}</>;
  }

  if (clerkRoutes.some((route) => matchesRoute(pathname, route))) {
    return <ClerkProvider publishableKey={publishableKey ?? undefined}>{children}</ClerkProvider>;
  }

  return (
    <ClerkProvider publishableKey={publishableKey ?? undefined}>
      <InstantProvider>
        <AppShell>{children}</AppShell>
      </InstantProvider>
    </ClerkProvider>
  );
}
