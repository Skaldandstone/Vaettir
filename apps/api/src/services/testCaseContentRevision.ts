import { createHash } from "node:crypto";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function testCaseContentRevision(value: {
  title: string;
  background: string | null;
  given: string[];
  when: string[];
  then: string[];
  tags: string[];
  testType: string;
  priority: string;
  suitePath: string | null;
  testPlanId: string | null;
  validationDomain: string;
  verificationProfile: unknown;
  sharedStepGroupId: string | null;
  sharedStepGroup?: { steps: unknown } | null;
  steps: Array<{
    order: number;
    action: string;
    expectedActionOrData: string | null;
    expectedResult: string | null;
    expectedResponse: string | null;
    mediaAttachmentIds: string[];
  }>;
}) {
  // Hash editable content only, including the currently resolved shared
  // library. Do not substitute a structured-step hash for the BDD/editor draft.
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          title: value.title,
          background: value.background,
          given: value.given,
          when: value.when,
          then: value.then,
          tags: value.tags,
          testType: value.testType,
          priority: value.priority,
          suitePath: value.suitePath,
          testPlanId: value.testPlanId,
          validationDomain: value.validationDomain,
          verificationProfile: value.verificationProfile,
          sharedStepGroupId: value.sharedStepGroupId,
          sharedSteps: value.sharedStepGroup?.steps ?? null,
          steps: value.steps.map((step) => ({
            order: step.order,
            action: step.action,
            expectedActionOrData: step.expectedActionOrData,
            expectedResult: step.expectedResult,
            expectedResponse: step.expectedResponse,
            mediaAttachmentIds: step.mediaAttachmentIds,
          })),
        }),
      ),
    )
    .digest("hex");
}
