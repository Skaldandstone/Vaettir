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
