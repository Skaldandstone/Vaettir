/** Only explicit server admission/transaction refusals establish no write for
 * the first attempt. A refusal after an earlier unknown outcome cannot erase it. */
export function definitiveSuggestionRefusal(error: unknown) {
  if (!error || typeof error !== "object" || !("data" in error)) return false;
  const data = error.data;
  return Boolean(data && typeof data === "object" && "code" in data &&
    ["BAD_REQUEST", "CONFLICT", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "TOO_MANY_REQUESTS"].includes(String(data.code)));
}
