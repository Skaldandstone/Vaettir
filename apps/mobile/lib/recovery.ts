/** Never surface serialized provider payloads, token URLs, or raw internal errors. */
export function readableError(error: unknown): string {
  const value = error as { message?: unknown; status?: number; data?: { code?: string }; errors?: { code?: string }[] } | null;
  const message = typeof value?.message === "string" ? value.message : typeof error === "string" ? error : "";
  const code = value?.data?.code ?? value?.errors?.[0]?.code;
  if (/fetch|network|offline|timeout|abort/i.test(message)) return "You are offline or Vaettir is unavailable. Reconnect and retry. No project data is stored offline.";
  if (code === "UNAUTHORIZED" || value?.status === 401) return "Your session expired. Sign in again to continue.";
  if (code === "FORBIDDEN" || /permission|access denied|read.only/i.test(message)) return "Your access has changed or this action is not allowed. Refresh the workspace or ask your team administrator.";
  if (code === "NOT_FOUND") return "This item is no longer available. Close it and refresh the workspace.";
  if (code === "TOO_MANY_REQUESTS" || value?.status === 429) return "Too many attempts. Wait a moment before trying again.";
  if (/credit|balance/i.test(message)) return "Your team's AI credits are exhausted. Wait for the monthly reset or contact your beta support contact. No automatic overage is charged.";
  if (code === "form_password_incorrect" || code === "form_identifier_not_found") return "The email or password is not correct. Check your invited account, or recover access on the web.";
  if (code === "form_code_incorrect" || code === "verification_expired") return "That verification code is invalid or expired. Use a fresh code and try again.";
  if (code === "too_many_requests" || code === "too_many_requests_error") return "Too many sign-in attempts. Wait a moment before trying again.";
  return "Vaettir could not complete this request. Check your connection and retry, or contact your beta support contact.";
}

export function canRevealWorkspace(state: { purged: boolean; foreground: boolean; invalidated: boolean }) {
  return state.purged && state.foreground && !state.invalidated;
}

export function containsExpiredSession(body: unknown): boolean {
  return (Array.isArray(body) ? body : [body]).some((entry: unknown) => {
    if (!entry || typeof entry !== "object" || !("error" in entry)) return false;
    const error = entry.error as { data?: { code?: string }; json?: { data?: { code?: string } } } | null;
    return error?.data?.code === "UNAUTHORIZED" || error?.json?.data?.code === "UNAUTHORIZED";
  });
}
