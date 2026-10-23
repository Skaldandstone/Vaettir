import { describe, expect, it } from "vitest";
import {
  recommendAndroidObjectRepair,
  type AndroidObjectRepairInput,
} from "./androidObjectRepair.js";
const scope = {
  projectId: "synthetic",
  organizationId: "org",
  actorId: "actor",
  sessionId: "session",
};
function fixture(): AndroidObjectRepairInput {
  const target = (id: string) => ({
    packageName: "com.example.synthetic",
    objectId: id,
    className: "android.widget.Button",
    selector: { kind: "RESOURCE_ID" as const, value: id },
    bounds: [0, 0, 100, 100] as [number, number, number, number],
  });
  return {
    original: {
      scope,
      caseId: "case",
      caseRevision: "a".repeat(64),
      stepId: "step",
      expectedResult: "Catalog is visible",
      label: "Open catalog",
      target: target("com.example.synthetic:id/old"),
    },
    failure: "TARGET_NOT_FOUND",
    current: {
      scope: { ...scope },
      caseRevision: "a".repeat(64),
      packageName: "com.example.synthetic",
      screenId: "b".repeat(64),
      observedAt: 1000,
      blocked: false,
      controls: [
        {
          id: "c".repeat(64),
          label: "Open catalog",
          enabled: true,
          navigable: true,
          target: target("com.example.synthetic:id/new"),
        },
      ],
    },
  };
}
describe("reviewed Android object replacement recommendations", () => {
  it("asks about the observed replacement without granting retry, changing expectations or mutating input", () => {
    const input = fixture(),
      before = JSON.stringify(input),
      result = recommendAndroidObjectRepair(input, 1001);
    expect(result.status).toBe("REVIEW_REPLACEMENTS");
    expect(result.reason).toBe("ASK_WHICH_OBJECT_IS_THE_INTENDED_PATH");
    expect(result.candidates[0]).toMatchObject({
      object: { objectId: "com.example.synthetic:id/new" },
      expectedResult: "Catalog is visible",
      requiresCandidateApproval: true,
      requiresFreshResolution: true,
      requiresOriginalAssertionVerification: true,
    });
    expect(result.outcome).toBe("NOT_EXECUTED");
    expect(result.automaticRetryAllowed).toBe(false);
    expect(result.caseUpdateAllowed).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("retains multiple equally supported choices rather than silently selecting one", () => {
    const input = fixture(),
      second = structuredClone(input.current.controls[0]!);
    second.id = "d".repeat(64);
    second.target.objectId = second.target.selector.value =
      "com.example.synthetic:id/other";
    input.current.controls.push(second);
    const result = recommendAndroidObjectRepair(input, 1001);
    expect(result).toMatchObject({
      status: "REVIEW_REPLACEMENTS",
      ambiguous: true,
    });
    expect(result.candidates).toHaveLength(2);
  });
  it("blocks stale/future observations, changed scope/revision, protected screens and foreign objects", () => {
    const mutations = [
      (v: AndroidObjectRepairInput) => {
        v.current.observedAt = -30000;
      },
      (v: AndroidObjectRepairInput) => {
        v.current.observedAt = 2000;
      },
      (v: AndroidObjectRepairInput) => {
        v.current.scope.projectId = "other";
      },
      (v: AndroidObjectRepairInput) => {
        v.current.caseRevision = "d".repeat(64);
      },
      (v: AndroidObjectRepairInput) => {
        v.current.blocked = true;
      },
      (v: AndroidObjectRepairInput) => {
        v.current.controls[0]!.target.packageName = "com.other.app";
      },
    ];
    for (const mutate of mutations) {
      const input = fixture();
      mutate(input);
      const result = recommendAndroidObjectRepair(input, 1001);
      expect(result.status).toBe("BLOCKED");
      expect(result.candidates).toEqual([]);
    }
  });
  it("never heals assertion failures, unknown action outcomes or an original object still present", () => {
    for (const failure of [
      "EXPECTED_RESULT_MISMATCH",
      "OUTCOME_UNCERTAIN",
    ] as const) {
      const input = fixture();
      input.failure = failure;
      expect(recommendAndroidObjectRepair(input, 1001).status).toBe("BLOCKED");
    }
    const input = fixture();
    input.current.controls[0]!.target = structuredClone(input.original.target);
    expect(recommendAndroidObjectRepair(input, 1001).reason).toBe(
      "ORIGINAL_OBJECT_PRESENT_REVIEW_FAILURE",
    );
  });
  it("excludes ambiguous selectors, bounds-only, disabled, destructive and weak class-only candidates", () => {
    for (const change of [
      "DUPLICATE",
      "BOUNDS",
      "DISABLED",
      "UNSAFE",
      "WEAK",
    ]) {
      const input = fixture();
      const c = input.current.controls[0]!;
      if (change === "DUPLICATE") {
        const duplicate = structuredClone(c);
        duplicate.id = "e".repeat(64);
        input.current.controls.push(duplicate);
      }
      if (change === "BOUNDS") {
        c.target.selector = { kind: "BOUNDS_ONLY", value: null };
      }
      if (change === "DISABLED") c.enabled = false;
      if (change === "UNSAFE") c.label = "Delete Open catalog";
      if (change === "WEAK") c.label = "Open something else";
      const result = recommendAndroidObjectRepair(input, 1001);
      expect(result.status).toBe("MANUAL_REVIEW");
      expect(result.candidates).toEqual([]);
    }
  });
});
