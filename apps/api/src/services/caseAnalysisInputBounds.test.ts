import { describe, expect, it } from "vitest";
import {
  caseAnalysisSelectionSchema,
  MAX_ANALYSIS_SELECTION,
} from "./caseAnalysisQueueSchema.js";

const request = {
  projectId: "synthetic-project",
  action: "RISK" as const,
  requestId: "00000000-0000-4000-8000-000000000001",
  originalOrganizationId: "synthetic-workspace",
  expectedClerkActorId: "synthetic-actor",
};

describe("analysis selection validation resource bounds", () => {
  it("rejects an oversized malformed selection before reading its elements", () => {
    // This small fixture produced one error per element with Zod 3, despite
    // the existing maximum. Do not attempt an actual out-of-memory payload.
    const ids: unknown[] = Array(4096).fill(0);
    let elementReads = 0;
    Object.defineProperty(ids, 0, {
      get() {
        elementReads++;
        return 0;
      },
    });

    const parsed = caseAnalysisSelectionSchema.safeParse({ ...request, ids });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("Oversized selection was accepted");
    expect(elementReads).toBe(0);
    expect(parsed.error.issues).toHaveLength(1);
    expect(parsed.error.issues[0]).toMatchObject({
      code: "too_big",
      path: ["ids"],
      maximum: MAX_ANALYSIS_SELECTION,
    });
  });

  it("preserves the full supported selection and existing review boundaries", () => {
    const ids = Array.from(
      { length: MAX_ANALYSIS_SELECTION },
      (_, index) => `synthetic-case-${index}`,
    );
    expect(caseAnalysisSelectionSchema.parse({ ...request, ids })).toEqual({
      ...request,
      ids,
    });
    expect(
      caseAnalysisSelectionSchema.safeParse({
        ...request,
        ids: ["same-case", "same-case"],
      }).success,
    ).toBe(false);
    expect(
      caseAnalysisSelectionSchema.safeParse({
        ...request,
        expectedClerkActorId: undefined,
        ids: ["synthetic-case"],
      }).success,
    ).toBe(false);
    expect(
      caseAnalysisSelectionSchema.safeParse({
        ...request,
        ids: ["synthetic-case"],
        approved: true,
      }).success,
    ).toBe(false);
  });
});
