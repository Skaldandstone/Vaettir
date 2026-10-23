import { describe, expect, it } from "vitest";
import { requirementCoverageListInput, requirementCoverageCasesInput, requirementCoverageEvidenceInput, requirementCoverageRequestKey } from "./requirementCoverageSchema.js";
import { coverageOutcomes } from "./requirementCoverage.js";
// Authored source-only: not executed in the deferred-validation session.
const input = { projectId: "synthetic", asOf: "2026-10-04T03:00:00.000Z" };
describe("bounded explicit coverage input and truthful outcomes", () => {
  it("allows the existing 30-day default and explicit inclusive UTC date scope", () => {
    expect(requirementCoverageListInput.parse(input)).toMatchObject({ offset: 0, search: "" });
    expect(requirementCoverageListInput.parse({ ...input, interval: { start: "2026-09-01", end: "2026-10-03" },
      scope: { planId: "retained-plan", runId: "native-run", platform: "PC", environment: "Synthetic staging", build: "b1" } }).scope?.build).toBe("b1");
  });
  it("refuses unknown fields, noncalendar dates, excessive windows/pages and arbitrary SQL", () => {
    for (const invalid of [{ ...input, sql: "SELECT synthetic" }, { ...input, scope: { query: "anything" } },
      { ...input, scope: {} }, { ...input, offset: 1 }, { ...input, offset: 10000 },
      { ...input, interval: { start: "2025-01-01", end: "2026-10-01" } },
      { ...input, interval: { start: "2026-02-30", end: "2026-03-01" } },
      { ...input, scope: { environment: "x".repeat(2001) } }]) expect(requirementCoverageListInput.safeParse(invalid).success).toBe(false);
    expect(requirementCoverageCasesInput.safeParse({ ...input, requirementId: "r", offset: 1000 }).success).toBe(false);
    expect(requirementCoverageEvidenceInput.safeParse({ ...input, requirementId: "r", caseId: "c", defectOffset: 100 }).success).toBe(false);
  });
  it("binds scope/target/page identities independently of property insertion order", () => {
    const a = requirementCoverageListInput.parse({ ...input, scope: { build: "b", platform: "PC" } });
    const b = { search: "", offset: 0, scope: { platform: "PC", build: "b" }, asOf: input.asOf, projectId: input.projectId };
    expect(requirementCoverageRequestKey(a)).toBe(requirementCoverageRequestKey(b));
    expect(requirementCoverageRequestKey(a)).not.toBe(requirementCoverageRequestKey({ ...b, offset: 20 }));
    expect(requirementCoverageRequestKey(a)).not.toBe(requirementCoverageRequestKey({ ...b, scope: { build: "other" } }));
  });
  it("never turns no result or only skip/blocked outcomes into PASS", () => {
    expect(coverageOutcomes([])).toMatchObject({ PASS: 0, total: 0, state: "NO_RECORDED_RESULT" });
    expect(coverageOutcomes([{ status: "BLOCKED", _count: { _all: 2 } }, { status: "SKIP", _count: { _all: 1 } }]))
      .toMatchObject({ PASS: 0, BLOCKED: 2, SKIP: 1, total: 3, state: "ONLY_SKIPPED_OR_BLOCKED" });
    expect(coverageOutcomes([{ status: "FLAKY", _count: { _all: 1 } }, { status: "PASS", _count: { _all: 2 } }, { status: "FAIL", _count: { _all: 1 } }]))
      .toMatchObject({ PASS: 2, FAIL: 1, FLAKY: 1, total: 4, state: "RECORDED_OUTCOMES" });
    expect(() => coverageOutcomes([{ status: "PASS", _count: { _all: -1 } }])).toThrow();
    expect(() => coverageOutcomes([{ status: "PASS", _count: { _all: 100001 } }])).toThrow();
  });
});
