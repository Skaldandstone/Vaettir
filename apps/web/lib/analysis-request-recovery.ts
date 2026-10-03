export function definitiveAnalysisRefusal(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { data?: { code?: unknown } }).data?.code;
  return (
    typeof code === "string" &&
    ["BAD_REQUEST", "CONFLICT", "PRECONDITION_FAILED"].includes(code)
  );
}
// A later validation rejection is not proof an earlier ambiguous attempt did
// not commit. Preserve the original request until its durable receipt recovers.
export function retainAnalysisRequest(
  hadUnconfirmedAttempt: boolean,
  error: unknown,
) {
  return hadUnconfirmedAttempt || !definitiveAnalysisRefusal(error);
}
