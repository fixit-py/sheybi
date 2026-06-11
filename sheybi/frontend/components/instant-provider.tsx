"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";

import {
  db,
  hasInstantConfig,
  INSTANT_CLERK_CLIENT_NAME,
} from "@/lib/instant";
import type { ReactNode } from "react";

type InstantDbClient = Exclude<typeof db, null>;

function InstantAuthBridge({
  children,
  instantDb,
}: {
  children: ReactNode;
  instantDb: InstantDbClient;
}) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { auth } = instantDb;

  const instantAuth = instantDb.useAuth();

  useEffect(() => {
    if (!isLoaded || !db) {
      return;
    }

    let cancelled = false;

    const syncInstantAuth = async () => {
      if (!isSignedIn) {
        if (instantAuth?.user) {
          await auth.signOut();
        }
        return;
      }

      const idToken = await getToken();
      if (!idToken || cancelled) {
        return;
      }

      await auth.signInWithIdToken({
        clientName: INSTANT_CLERK_CLIENT_NAME,
        idToken,
      });
    };

    void syncInstantAuth().catch((error) => {
      console.error("InstantDB auth sync failed", error);
    });

    return () => {
      cancelled = true;
    };
  }, [auth, getToken, instantAuth.user, isLoaded, isSignedIn]);

  return children;
}

export function InstantProvider({ children }: { children: ReactNode }) {
  if (!hasInstantConfig || !db) {
    return children;
  }

  return (
    <InstantAuthBridge instantDb={db}>
      {children}
    </InstantAuthBridge>
  );
}
