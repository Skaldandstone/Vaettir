export function manualStartDefinitivelyRejected(
  cause: unknown,
  everAmbiguous: boolean,
) {
  const code =
    cause &&
    typeof cause === "object" &&
    "data" in cause &&
    cause.data &&
    typeof cause.data === "object" &&
    "code" in cause.data
      ? cause.data.code
      : null;
  return (
    !everAmbiguous &&
    [
      "BAD_REQUEST",
      "CONFLICT",
      "FORBIDDEN",
      "UNAUTHORIZED",
      "NOT_FOUND",
      "PRECONDITION_FAILED",
    ].includes(String(code))
  );
}

export function assertManualStartAcknowledgement(saved: { testRunId: string; originalOrganizationId?: string; expectedClerkActorId?: string; idempotencyKey?: string }, request: { originalOrganizationId: string; expectedClerkActorId: string; idempotencyKey: string }) {
  if (!saved.testRunId.startsWith("manual_") || saved.originalOrganizationId !== request.originalOrganizationId || saved.expectedClerkActorId !== request.expectedClerkActorId || saved.idempotencyKey !== request.idempotencyKey)
    throw new Error("The response did not identify this original run request. Retain and retry the same request.");
}
