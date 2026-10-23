import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
/** Test-only opt-in, never application authorization. A flag cannot admit an
 * unknown database route or substitute for the exact existing safety check. */
export function admitOwnedLargeReviewFixture(env: Record<string, string | undefined>) {
  if (env.VAETTIR_OWNED_LARGE_REVIEW_FIXTURE !== "yes") return null;
  return assertOwnedTestDatabase(env.DATABASE_URL, env);
}
