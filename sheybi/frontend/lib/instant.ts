import { init } from "@instantdb/react";

const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID?.trim() ?? "";

export const INSTANT_APP_ID = appId;
export const INSTANT_CLERK_CLIENT_NAME =
  process.env.NEXT_PUBLIC_INSTANT_CLERK_CLIENT_NAME?.trim() || "sheybi";
export const hasInstantConfig = appId.length > 0;

export const db = hasInstantConfig ? init({ appId }) : null;
