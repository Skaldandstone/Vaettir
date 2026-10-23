import { describe, expect, it } from "vitest";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";

const ci = {
  CI: "true", GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "Skaldandstone/Vaettir",
  GITHUB_RUN_ID: "37233246251", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: "a".repeat(40),
  GITHUB_WORKFLOW: "CI", GITHUB_JOB: "build", GITHUB_REF: "refs/heads/main",
  GITHUB_WORKFLOW_REF: "Skaldandstone/Vaettir/.github/workflows/ci.yml@refs/heads/main",
};
const service = "postgresql://synthetic:synthetic@localhost:5432/vaettir_test?schema=public&connection_limit=5";
const local = "postgresql://synthetic:synthetic@localhost:5432/vaettir_day_test_1791146033728?schema=public&connection_limit=5";

describe("exact test-only owned database admission", () => {
  it("preserves the two generated local routes without CI metadata", () => {
    expect(assertOwnedTestDatabase(local, {})).toEqual({ route: "LOCAL_DISPOSABLE", database: "vaettir_day_test_1791146033728" });
    expect(assertOwnedTestDatabase("postgres://synthetic@127.0.0.1/vaettir_away_full_test_1791146033728", {})).toEqual({ route: "LOCAL_DISPOSABLE", database: "vaettir_away_full_test_1791146033728" });
  });
  it("admits only the configured GitHub build service with full matching identity", () => {
    expect(assertOwnedTestDatabase(service, ci)).toEqual({ route: "GITHUB_SERVICE", database: "vaettir_test" });
    for (const ref of ["refs/heads/codex/overnight-readiness-20260921", "refs/pull/125/merge"]) {
      expect(assertOwnedTestDatabase(service, { ...ci, GITHUB_REF: ref, GITHUB_WORKFLOW_REF: `Skaldandstone/Vaettir/.github/workflows/ci.yml@${ref}` }).route).toBe("GITHUB_SERVICE");
    }
  });
  it("refuses CI flags alone and each missing supplied GitHub identity variable", () => {
    expect(() => assertOwnedTestDatabase(service, { CI: "true", GITHUB_ACTIONS: "true" })).toThrow();
    expect(() => assertOwnedTestDatabase(service, {})).toThrow();
    for (const key of Object.keys(ci)) expect(() => assertOwnedTestDatabase(service, { ...ci, [key]: undefined })).toThrow();
  });
  it.each([
    ["CI", "1"], ["GITHUB_ACTIONS", "false"], ["GITHUB_REPOSITORY", "Foreign/Vaettir"],
    ["GITHUB_REPOSITORY", "Skaldandstone/Other"], ["GITHUB_RUN_ID", "0"], ["GITHUB_RUN_ID", "one"],
    ["GITHUB_RUN_ATTEMPT", "0"], ["GITHUB_SHA", "a".repeat(39)], ["GITHUB_SHA", "G".repeat(40)],
    ["GITHUB_WORKFLOW", "Other workflow"], ["GITHUB_JOB", "llvm-configure-diagnostic"],
    ["GITHUB_WORKFLOW_REF", "Foreign/Vaettir/.github/workflows/ci.yml@refs/heads/main"],
    ["GITHUB_WORKFLOW_REF", "Skaldandstone/Vaettir/.github/workflows/other.yml@refs/heads/main"],
    ["GITHUB_WORKFLOW_REF", "Skaldandstone/Vaettir/.github/workflows/ci.yml@refs/heads/other"],
    ["GITHUB_REF", "refs/tags/release"], ["GITHUB_REF", "refs/heads/../main"],
  ])("refuses mismatched or malformed %s identity", (key, value) => {
    expect(() => assertOwnedTestDatabase(service, { ...ci, [key]: value })).toThrow();
  });
  it.each([
    service.replace("localhost", "production.example"), service.replace("localhost", "localhost."),
    service.replace(":5432/", ":6543/"), service.replace("/vaettir_test?", "/foreign_test?"),
    service.replace("/vaettir_test?", "/vaettir_test_copy?"), service.replace("/vaettir_test?", "/vaettir_test/?"),
    service.replace("/vaettir_test?", "/%76aettir_test?"), service.replace("schema=public", "schema=private"),
    service + "&host=production.example", service + "&port=6543", service + "&options=-csearch_path%3Dprivate",
    service + "&schema=public", service + "&connection_limit=5", service.replace("connection_limit=5", "connection_limit=100"),
    service + "#ignored", ` ${service}`, service.replace("postgresql:", "https:"),
  ])("refuses unsupported connection route without credentials in its error", value => {
    try { assertOwnedTestDatabase(value, ci); throw Error("Expected exact route refusal"); }
    catch (error) { expect(String(error)).toBe("Error: Exact owned disposable loopback test database required"); }
  });
  it.each([
    local.replace("1791146033728", "179114603372"), local.replace("1791146033728", "17911460337280"),
    local.replace("day_test", "test"), local.replace("day_test", "arbitrary_test"),
    local + "&host=localhost", local.replace("schema=public", "schema=private"), local.replace(":5432/", ":5433/"),
  ])("does not broaden local generated-name or query/port safety", value => {
    expect(() => assertOwnedTestDatabase(value, {})).toThrow();
  });
  it("does not expose credentials or raw URL even for malformed input", () => {
    for (const value of [undefined, "", "not-a-database-url", service.replace("synthetic:synthetic", "sensitive-user:sensitive-token") + "&host=remote"]) {
      expect(() => assertOwnedTestDatabase(value, ci)).toThrow("Exact owned disposable loopback test database required");
    }
  });
  it("refuses every ASCII control or space before URL normalization", () => {
    for (const code of [...Array.from({ length: 33 }, (_, index) => index), 127]) {
      const character = String.fromCharCode(code);
      for (const value of [character + service, service + character, service.replace("localhost", `local${character}host`)]) {
        expect(() => assertOwnedTestDatabase(value, ci)).toThrow("Exact owned disposable loopback test database required");
      }
    }
  });
});
