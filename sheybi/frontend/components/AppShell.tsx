"use client";

import { useAuth } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { AuthHeader } from "@/components/AuthHeader";
import MobileNav from "@/components/MobileNav";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [profileChecked, setProfileChecked] = useState(false);
  const [profileComplete, setProfileComplete] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    if (
      pathname.startsWith("/admin") ||
      pathname.startsWith("/onboarding") ||
      pathname.startsWith("/sign-in") ||
      pathname.startsWith("/sign-up")
    ) {
      return;
    }

    let active = true;

    const loadProfile = async () => {
      try {
        const token = await getToken();
        const res = await fetch("/api/flask/me", {
          headers: {
            Authorization: token ? `Bearer ${token}` : "",
          },
        });
        const json = (await res.json().catch(() => null)) as
          | {
              display_name?: string | null;
              handle?: string | null;
            }
          | null;
        if (!active || !res.ok || !json) return;
        const hasName = !!json.display_name?.trim();
        const hasHandle = !!json.handle?.trim();
        const complete = hasName && hasHandle;
        setProfileComplete(complete);
        setProfileChecked(true);
        if (!complete) {
          router.replace("/onboarding");
        }
      } catch {
        if (!active) return;
        setProfileComplete(false);
        setProfileChecked(true);
        router.replace("/onboarding");
      }
    };

    void loadProfile();

    return () => {
      active = false;
    };
  }, [getToken, isLoaded, isSignedIn, pathname, router]);

  if (pathname.startsWith("/admin")) {
    return children;
  }

  if (pathname.startsWith("/onboarding")) {
    return children;
  }

  if (!isLoaded || !isSignedIn) {
    return children;
  }

  if (!profileChecked || !profileComplete) {
    return children;
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <div className="pb-28 md:pb-0">
          <AuthHeader />
          {children}
        </div>
      </SidebarInset>
      <MobileNav />
    </SidebarProvider>
  );
}
