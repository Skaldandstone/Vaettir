import { describe, expect, it } from "vitest";
import { qualityRiskOverviewInput, qualityRiskOverviewRequestKey, riskOverviewProjection } from "./qualityRiskOverviewSchema.js";
import { riskOverviewCounts, riskOverviewLabel } from "./qualityRiskOverview.js";
// SOURCE-ONLY authored tests; no execution in tonight's deferred validation.
const projection = () => ({ id: "risk-1", number: 1, displayId: "SYN-R0001", version: 1, title: "Synthetic risk", component: "Synthetic component",
  likelihood: "UNKNOWN", consequence: "UNKNOWN", caseIds: [], requirementIds: [], latest: null });
describe("bounded human risk overview source contract", () => {
  it("accepts explicit qualitative states and refuses arbitrary/oversized query fields", () => {
    expect(qualityRiskOverviewInput.parse({ projectId: "synthetic" })).toMatchObject({ offset: 0, review: "ANY", evidence: "ANY" });
    for (const input of [{ projectId: "synthetic", score: 100 }, { projectId: "synthetic", likelihood: "LOW_RISK" },
      { projectId: "synthetic", review: "VERIFIED" }, { projectId: "synthetic", offset: 1 }, { projectId: "synthetic", offset: 1000 },
      { projectId: "synthetic", search: "x".repeat(81) }]) expect(qualityRiskOverviewInput.safeParse(input).success).toBe(false);
  });
  it("distinguishes explicitly UNKNOWN from missing/unsupported categories and inconsistent reviews", () => {
    expect(riskOverviewProjection.safeParse(projection()).success).toBe(true);
    expect(riskOverviewProjection.safeParse({ ...projection(), likelihood: undefined }).success).toBe(false);
    expect(riskOverviewProjection.safeParse({ ...projection(), likelihood: "LOW" }).success).toBe(false);
    expect(riskOverviewProjection.safeParse({ ...projection(), notes: "unapproved raw field" }).success).toBe(false);
    const latest = { id: "decision", createdVersion: 2, assessedVersion: 1, createdAt: "2026-09-20T00:00:00.000Z", likelihood: "RARE", consequence: "MINOR",
      disposition: "HUMAN_ACCEPTANCE_RECORDED", resultIds: [], evidence: [] };
    expect(riskOverviewProjection.safeParse({ ...projection(), version: 2, latest }).success).toBe(true);
    expect(riskOverviewProjection.safeParse({ ...projection(), latest }).success).toBe(false);
    expect(riskOverviewProjection.safeParse({ ...projection(), version: 2, latest: { ...latest, resultIds: ["missing-snapshot-reference"] } }).success).toBe(false);
  });
  it("binds query/filter/page/organization identities and preserves surrogate-safe bounded excerpts", () => {
    const a = qualityRiskOverviewInput.parse({ projectId: "synthetic", evidence: "NONE_RECORDED" });
    expect(qualityRiskOverviewRequestKey(a)).toBe(qualityRiskOverviewRequestKey({ ...a, offset: 0 }));
    expect(qualityRiskOverviewRequestKey(a)).not.toBe(qualityRiskOverviewRequestKey({ ...a, originalOrganizationId: "other" }));
    expect(qualityRiskOverviewRequestKey(a)).not.toBe(qualityRiskOverviewRequestKey({ ...a, offset: 20 }));
    const unicode = riskOverviewLabel("x".repeat(159) + "🎮"); expect(unicode.label).toBe("x".repeat(159)); expect(unicode.excerpt).toBe(true);
    const emoji = riskOverviewLabel("🎮".repeat(160)); expect(emoji.label.length).toBe(160); expect(emoji.label).toBe("🎮".repeat(80)); expect(emoji.excerpt).toBe(true);
    expect(riskOverviewLabel("Synthetic case")).toEqual({ label: "Synthetic case", excerpt: false });
  });
  it("counts recorded human categories, absent reviews and no evidence separately without a safety metric", () => {
    const row: Parameters<typeof riskOverviewCounts>[0][number] = { id: "r", number: 1, displayId: "SYN-R0001", version: 1, title: "Synthetic", component: "Synthetic",
      likelihood: "UNKNOWN", consequence: "UNKNOWN", review: "NO_REVIEW", disposition: "NOT_RECORDED", residual: null,
      evidence: { total: 0, available: 0, unavailable: 0, state: "NO_REVIEW" }, mitigation: { total: 0, available: 0, unavailable: 0, state: "NO_LINKS" } };
    const review = { ...row, id: "reviewed", version: 2, review: "VERSION_MATCHING_REVIEW" as const, disposition: "REVIEW_RECORDED" as const,
      evidence: { total: 0, available: 0, unavailable: 0, state: "NONE_RECORDED" as const } };
    const counts = riskOverviewCounts([row, review]); expect(counts.entries).toBe(2); expect(counts.likelihood.UNKNOWN).toBe(2);
    expect(counts.review).toEqual({ NO_REVIEW: 1, VERSION_MATCHING_REVIEW: 1, BASELINE_CHANGED: 0 });
    expect(counts.evidence.NO_REVIEW).toBe(1); expect(counts.evidence.NONE_RECORDED).toBe(1);
    expect(JSON.stringify(counts)).not.toMatch(/score|riskReduction|verified|safety/);
  });
});
