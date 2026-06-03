export function isAdminUserId(userId: string | null | undefined) {
  const raw = process.env.ADMIN_USER_IDS ?? "";
  const allowed = new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return !!userId && allowed.has(userId);
}

