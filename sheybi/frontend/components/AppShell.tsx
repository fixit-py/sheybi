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

const COMPLETION_WINDOW_MS = 24 * 60 * 60 * 1000;

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
      pathname.startsWith("/su-admin") ||
      pathname.startsWith("/terms") ||
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
          cache: "no-store",
          headers: {
            Authorization: token ? `Bearer ${token}` : "",
          },
        });
        const json = (await res.json().catch(() => null)) as
          | {
              first_name?: string | null;
              last_name?: string | null;
              handle?: string | null;
              phone_number?: string | null;
              terms_accepted?: boolean | null;
            }
          | null;
        if (!active || !res.ok || !json) return;
        const hasFirstName = !!json.first_name?.trim();
        const hasLastName = !!json.last_name?.trim();
        const hasHandle = !!json.handle?.trim();
        const hasPhoneNumber = !!json.phone_number?.trim();
        const termsAccepted = !!json.terms_accepted;
        let recentOnboardingCompletion = false;
        try {
          const raw = window.sessionStorage.getItem("sheybi_onboarding_completed_at");
        if (raw) {
          const stamp = Number(raw);
            recentOnboardingCompletion = Number.isFinite(stamp) && Date.now() - stamp < COMPLETION_WINDOW_MS;
          }
        } catch {
          recentOnboardingCompletion = false;
        }
        let recentTermsAcceptance = false;
        if (!termsAccepted) {
          try {
            const raw = window.sessionStorage.getItem("sheybi_terms_accepted_at");
            if (raw) {
              const stamp = Number(raw);
              recentTermsAcceptance = Number.isFinite(stamp) && Date.now() - stamp < COMPLETION_WINDOW_MS;
            }
          } catch {
            recentTermsAcceptance = false;
          }
        }
        const normalizedTermsAccepted = termsAccepted || recentTermsAcceptance;
        const profileReady = hasFirstName && hasLastName && hasHandle && hasPhoneNumber;
        const normalizedProfileReady = profileReady || recentOnboardingCompletion;
        const complete = normalizedProfileReady && normalizedTermsAccepted;
        setProfileComplete(complete);
        setProfileChecked(true);
        if (!complete) {
          if (!normalizedProfileReady) {
            if (recentOnboardingCompletion && pathname.startsWith("/user")) {
              setProfileComplete(true);
              return;
            }
            router.replace("/onboarding");
          } else {
            if (recentTermsAcceptance && pathname.startsWith("/user")) {
              setProfileComplete(true);
              return;
            }
            router.replace("/terms");
          }
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

  if (pathname.startsWith("/admin") || pathname.startsWith("/su-admin")) {
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
