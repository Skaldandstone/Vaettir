import { describe, expect, it } from "vitest";
import { admitOwnedLargeReviewFixture } from "./testOnlyLargeReviewSafety.js";
describe("explicit owned large-review fixture admission only", () => {
  const local = "postgresql://synthetic:synthetic@localhost:5432/vaettir_day_test_1791146033728?schema=public&connection_limit=5";
  it("requires the exact explicit flag and owned generated route", () => {
    for (const flag of [undefined, "true", "YES", "1", "yes "]) expect(admitOwnedLargeReviewFixture({ DATABASE_URL: local, VAETTIR_OWNED_LARGE_REVIEW_FIXTURE: flag })).toBeNull();
    expect(admitOwnedLargeReviewFixture({ DATABASE_URL: local, VAETTIR_OWNED_LARGE_REVIEW_FIXTURE: "yes" })).toEqual({ route: "LOCAL_DISPOSABLE", database: "vaettir_day_test_1791146033728" });
  });
  it("an enabled flag never admits generic test names, unknown hosts/ports, query overrides or CI flags alone", () => {
    for (const url of [undefined, "", "not-a-url", local.replace("localhost", "production.example"), local.replace("localhost", "localhost."), local.replace(":5432/", ":6543/"), local.replace("vaettir_day_test_1791146033728", "any_test"), local.replace("vaettir_day_test_1791146033728", "vaettir_test"), local + "&host=remote", local.replace("schema=public", "schema=private")]) {
      expect(() => admitOwnedLargeReviewFixture({ VAETTIR_OWNED_LARGE_REVIEW_FIXTURE: "yes", DATABASE_URL: url, CI: "true", GITHUB_ACTIONS: "true" })).toThrow("Exact owned disposable loopback test database required");
    }
  });
  it("refusal diagnostics never expose even synthetic credentials or raw routes", () => {
    const unsafe = local.replace("synthetic:synthetic", "PRIVATE-USER:PRIVATE-CREDENTIAL") + "&host=remote";
    try { admitOwnedLargeReviewFixture({ VAETTIR_OWNED_LARGE_REVIEW_FIXTURE: "yes", DATABASE_URL: unsafe }); expect.fail("Unknown route must refuse"); } catch (error) { expect(String(error)).toBe("Error: Exact owned disposable loopback test database required"); }
  });
});
