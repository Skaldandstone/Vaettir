export function retainSavedQueryRequest(previousUnknown: boolean, error: unknown) {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  // A later typed refusal cannot disprove acceptance of the original attempt.
  // Transport errors and unavailable/current-auth refusals also retain recovery.
  return previousUnknown || !["BAD_REQUEST", "CONFLICT", "PRECONDITION_FAILED"].includes(code ?? "");
}
