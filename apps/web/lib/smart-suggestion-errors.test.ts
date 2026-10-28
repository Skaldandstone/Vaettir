import { expect, it } from "vitest";
import { definitiveSuggestionRefusal } from "./smart-suggestion-errors";
it("distinguishes explicit admission/transaction refusals from unknown outcomes", () => {
  for (const code of ["CONFLICT", "FORBIDDEN", "BAD_REQUEST", "UNAUTHORIZED", "NOT_FOUND", "TOO_MANY_REQUESTS"]) expect(definitiveSuggestionRefusal({ data: { code } })).toBe(true);
  for (const error of [new Error("Failed to fetch"), { data: { code: "INTERNAL_SERVER_ERROR" } }, { data: null }, null, "CONFLICT"]) expect(definitiveSuggestionRefusal(error)).toBe(false);
});
