import { z } from "@vaettir/core/dist/validation.js";
import {
  androidExplorationScope,
  observedAndroidObject,
} from "./androidExplorationSchema.js";
import { androidNetworkEvidence } from "./androidNetworkEvidenceSchema.js";
const text = (max = 200) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (v) =>
        ![...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
    );
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const androidReplayLocator = z
  .object({
    kind: z.enum(["RESOURCE_ID", "ACCESSIBILITY_ID", "TEXT_CLASS"]),
    value: text(500),
    className: text().nullable(),
  })
  .strict()
  .refine((v) => v.kind !== "TEXT_CLASS" || v.className !== null);
export const androidReplayAssertion = z
  .object({
    kind: z.literal("VISIBLE_LABEL"),
    value: text(),
    relationReviewed: z.literal(true),
  })
  .strict();
export const androidReplayPlan = z
  .object({
    caseId: text(),
    revision: digest,
    packageName: text().regex(/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/),
    steps: z
      .array(
        z
          .object({
            stepId: text(),
            label: text(),
            expectedResult: text(10000),
            locator: androidReplayLocator,
            assertion: androidReplayAssertion,
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict()
  .refine((v) => new Set(v.steps.map((s) => s.stepId)).size === v.steps.length);
export const androidReplayReceipt = z
  .object({
    stepId: text(),
    expectedResult: text(10000),
    requestId: z.string().uuid(),
    sequence: z.number().int().min(1).max(24),
    from: digest,
    to: digest,
    observedAt: z.number().int().nonnegative(),
    originalLocator: androidReplayLocator,
    target: observedAndroidObject,
    commandArgs: z.tuple([
      z.literal("shell"),
      z.literal("input"),
      z.literal("tap"),
      z.string().regex(/^\d{1,5}$/),
      z.string().regex(/^\d{1,5}$/),
    ]),
    assertion: androidReplayAssertion
      .extend({
        matches: z.number().int().min(0).max(150),
        passed: z.boolean(),
      })
      .strict(),
    repaired: z.boolean(),
    repairApproval: z
      .object({
        candidateId: digest,
        screenId: digest,
        reasons: z
          .array(z.enum(["SAME_LABEL", "SHARED_LABEL_WORDS"]))
          .min(1)
          .max(2),
        retryApproved: z.literal(true),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const b = v.target.bounds;
    if (
      v.repaired !== (v.repairApproval !== null) ||
      (v.repairApproval && v.repairApproval.screenId !== v.from)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Retain the exact explicit repair approval and original screen.",
      });
    if (
      v.target.selector.kind === "BOUNDS_ONLY" ||
      v.commandArgs[3] !== String(Math.floor((b[0] + b[2]) / 2)) ||
      v.commandArgs[4] !== String(Math.floor((b[1] + b[3]) / 2)) ||
      v.assertion.passed !== (v.assertion.matches === 1)
    )
      ctx.addIssue({
        code: "custom",
        message: "Preserve the exact dispatched target and assertion result.",
      });
  });
export const androidReplayState = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[a-f0-9]{48}$/),
    scope: androidExplorationScope,
    plan: androidReplayPlan,
    planHash: digest,
    status: z.enum([
      "ACTIVE",
      "REPAIR_REVIEW",
      "STOPPED",
      "UNCERTAIN",
      "ASSERTION_FAILED",
      "COMPLETED",
    ]),
    reason: text().nullable(),
    sequence: z.number().int().min(0).max(24),
    index: z.number().int().min(0).max(12),
    expiresAt: z.number().int().nonnegative(),
    screen: z
      .object({
        id: digest,
        label: text(),
        controls: z
          .array(
            z
              .object({
                id: digest,
                label: text(),
                navigable: z.boolean(),
                target: observedAndroidObject.nullable(),
              })
              .strict(),
          )
          .max(150),
      })
      .strict()
      .nullable(),
    receipts: z.array(androidReplayReceipt).max(12),
    candidates: z
      .array(
        z
          .object({
            id: digest,
            label: text(),
            target: observedAndroidObject,
            reasons: z
              .array(z.enum(["SAME_LABEL", "SHARED_LABEL_WORDS"]))
              .min(1)
              .max(2),
          })
          .strict(),
      )
      .max(150),
    lastRequestId: z.string().uuid().nullable(),
    nativeExecutionIndependentlyVerified: z.literal(false),
  })
  .strict();
export const androidReplayScopeInput = z
  .object({
    projectId: text(),
    originalOrganizationId: text(),
    expectedClerkActorId: text(),
    expectedNativeActorId: text(),
  })
  .strict();
export const androidReplayCaseInput = androidReplayScopeInput
  .extend({ caseId: text(), expectedRevision: digest.optional() })
  .strict();
export const androidReplayCase = z
  .object({
    id: text(),
    title: z.string().max(10000),
    revision: digest,
    steps: z
      .array(
        z
          .object({
            id: text(),
            order: z.number().int(),
            action: z.string().max(20000),
            expectedResult: text(10000),
            locator: androidReplayLocator.nullable(),
            label: text().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    packageName: text().nullable(),
  })
  .strict();
export const androidReplayPatchInput = androidReplayScopeInput
  .extend({
    requestId: z.string().uuid(),
    plan: androidReplayPlan,
    runId: z.string().regex(/^[a-f0-9]{48}$/),
    planHash: digest,
    receipts: z.array(androidReplayReceipt).min(1).max(12),
    network: androidNetworkEvidence.nullable(),
    networkSelection: z
      .object({
        sourceId: text(64),
        approvedRouteKeys: z.array(text(64)).min(1).max(32),
        startedAt: z.number().int().nonnegative(),
        endedAt: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    localReportedEvidenceReviewed: z.literal(true),
    patchReviewed: z.literal(true),
    disclosureApproved: z.literal(true),
  })
  .strict();
export const androidReplayPatchReceipt = z
  .object({
    requestId: z.string().uuid(),
    requestHash: digest,
    caseId: text(),
    priorRevision: digest,
    newRevision: digest,
    versionNumber: z.number().int().positive(),
    runId: text(48),
    nativeExecutionIndependentlyVerified: z.literal(false),
  })
  .strict();
export type AndroidReplayPlan = z.infer<typeof androidReplayPlan>;
export type AndroidReplayState = z.infer<typeof androidReplayState>;
export type AndroidReplayCase = z.infer<typeof androidReplayCase>;
export function androidReplayPatchedAction(
  action: string,
  runId: string,
  r: z.infer<typeof androidReplayReceipt>,
  network: z.infer<typeof androidNetworkEvidence> | null,
  requestId: string,
) {
  return `${action}\nReviewed Android replay ${runId}; package=${r.target.packageName}; selector=${JSON.stringify(r.target.selector)}; class=${JSON.stringify(r.target.className)}; ADB=${JSON.stringify(r.commandArgs)}; request=${r.requestId}; assertion=${JSON.stringify(r.assertion)}. Local-reported evidence, not independently verified execution. ${network ? `Approved debug-app HTTP metadata source=${network.sourceId}; ${network.events.length} events; receipt=${requestId}. No response bodies or API correctness assertion.` : "App HTTP traffic NOT_CAPTURED; ADB is not HTTP evidence."} Automation suggestion: UI Automator; retain expected result; review locator and assertion before generating a draft.`;
}
