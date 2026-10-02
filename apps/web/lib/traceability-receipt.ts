export type TraceabilityReceipt<T> = { input: T; uncertain: boolean };

export function retainedTraceabilityReceipt<T>(
  receipt: TraceabilityReceipt<T>,
  cause: unknown,
): TraceabilityReceipt<T> | null {
  const code =
    cause &&
    typeof cause === "object" &&
    "data" in cause &&
    cause.data &&
    typeof cause.data === "object" &&
    "code" in cause.data
      ? cause.data.code
      : null;
  const definitelyRejected = [
    "CONFLICT",
    "BAD_REQUEST",
    "NOT_FOUND",
    "FORBIDDEN",
    "UNAUTHORIZED",
    "PRECONDITION_FAILED",
    "TOO_MANY_REQUESTS",
  ].includes(String(code));
  // An earlier lost response may already have committed. Later access failure
  // cannot prove that earlier attempt was rejected; retain its exact identity.
  return !receipt.uncertain && definitelyRejected
    ? null
    : { ...receipt, uncertain: true };
}
