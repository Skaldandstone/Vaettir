import { z } from "zod";
import {
  manualExecutionReadScopeOutputSchema,
  supportedManualExecutionIdentity,
} from "./manualExecutionReadScopeSchema.js";
import { manualRunScopeAvailabilitySchema } from "./manualRunScopeAvailability.js";
import { runExperienceSnapshotSchema } from "./qualityExperienceProfile.js";
import {
  validationDomainSchema,
  verificationProfileSchema,
  observationsSchema,
} from "./physicalValidation.js";
import { stepRevisionOutputSchema } from "./manualStepExecution.js";

/** Server-side schema preserves the legacy supported view exactly. It is not a
 * browser entrypoint or a raw native JSON/full-history audit schema. */
export const manualExecutionCurrentOutputSchema =
  manualExecutionReadScopeOutputSchema.extend({
    ...manualRunScopeAvailabilitySchema.shape,
    status: z.string(),
    stepFieldLabels: z.record(z.string()),
    executionContext: runExperienceSnapshotSchema.nullable(),
    datasetBatchRuns: z
      .array(
        z.object({
          testRunId: z.string(),
          rowIndex: z.number().int(),
          rowName: z.string(),
          status: z.string(),
        }),
      )
      .max(50)
      .default([]),
    cases: z
      .array(
        z.object({
          testCaseId: z.string(),
          displayId: z.string().nullable(),
          title: z.string(),
          background: z.string().nullable(),
          prerequisiteIds: z.array(z.string()),
          validationDomain: validationDomainSchema,
          verificationProfile: verificationProfileSchema,
          given: z.array(z.string()),
          when: z.array(z.string()),
          then: z.array(z.string()),
          steps: z.array(
            z.object({
              order: z.number(),
              action: z.string(),
              expectedActionOrData: z.string().nullable(),
              expectedResult: z.string().nullable(),
              expectedResponse: z.string().nullable(),
              mediaAttachmentIds: z.array(z.string()).default([]),
            }),
          ),
          stepExecutionAvailable: z.boolean(),
          stepResults: z
            .array(
              z.object({
                stepIndex: z.number(),
                current: stepRevisionOutputSchema.nullable(),
                revisionCount: z.number(),
              }),
            )
            .max(500),
          currentResult: z
            .object({
              status: z.string(),
              note: z.string().nullable(),
              observations: observationsSchema,
            })
            .nullable(),
        }),
      )
      .max(1000),
  });
const identity = z
  .string()
  .min(1)
  .max(200)
  .refine(supportedManualExecutionIdentity);
export const manualRunCurrentReadInput = z
  .object({
    projectId: identity,
    testRunId: identity,
    originalOrganizationId: identity,
    expectedClerkActorId: identity,
    expectedNativeActorId: identity.optional(),
    requestId: z.string().uuid(),
  })
  .strict();
export type ManualRunCurrentReadInput = z.infer<
  typeof manualRunCurrentReadInput
>;
export const manualRunCurrentReadOutput = z
  .object({
    readContext: z
      .object({
        requestId: z.string().uuid(),
        requestedKey: z.string().max(5600),
        projection: z.literal("CURRENT_WHOLE_MANUAL_RUN_VIEW"),
        scope: z
          .object({
            projectId: identity,
            testRunId: identity,
            organizationId: identity,
            actorId: identity,
            actorClerkUserId: identity,
          })
          .strict(),
      })
      .strict(),
    view: manualExecutionCurrentOutputSchema,
    provenance: z
      .object({
        procedures: z.enum([
          "FROZEN_RUN_DEFINITIONS",
          "LEGACY_CURRENT_CASE_DEFINITIONS",
        ]),
        observations: z.literal(
          "CURRENT_SUPPORTED_API_VIEW_NOT_RAW_NATIVE_JSON",
        ),
        history: z.literal("CURRENT_HEADS_NOT_COMPLETE_REVISION_HISTORY"),
        media: z.literal("IDENTIFIER_REFERENCES_NO_FILES_FETCHED"),
      })
      .strict(),
  })
  .strict()
  .superRefine((result, ctx) => {
    const scope = result.readContext.scope,
      view = result.view,
      planned = new Set(view.plannedCaseIds),
      available = view.cases.map((testCase) => testCase.testCaseId),
      unavailable = view.unavailableCases.map(
        (testCase) => testCase.testCaseId,
      ),
      availability = view.scopeAvailability;
    if (
      scope.projectId !== view.projectId ||
      scope.testRunId !== view.testRunId ||
      scope.organizationId !== view.organizationId ||
      scope.organizationId !== view.originalOrganizationId ||
      scope.actorId !== view.actorId ||
      scope.actorClerkUserId !== view.clerkActorId ||
      result.provenance.procedures !== availability.procedureBasis ||
      planned.size !== view.plannedCaseIds.length ||
      new Set(available).size !== available.length ||
      new Set(unavailable).size !== unavailable.length ||
      available.some((id) => !planned.has(id) || unavailable.includes(id)) ||
      unavailable.some((id) => !planned.has(id)) ||
      available.length + unavailable.length !== planned.size ||
      availability.plannedCount !== planned.size ||
      availability.availableCount !== available.length ||
      availability.unavailableCount !== unavailable.length ||
      availability.complete !== (unavailable.length === 0)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Current whole-run scope/provenance does not match its native view.",
      });
  });
export function manualRunCurrentReadKey(input: ManualRunCurrentReadInput) {
  return JSON.stringify({
    projectId: input.projectId,
    testRunId: input.testRunId,
    originalOrganizationId: input.originalOrganizationId,
    expectedClerkActorId: input.expectedClerkActorId,
    ...(input.expectedNativeActorId === undefined
      ? {}
      : { expectedNativeActorId: input.expectedNativeActorId }),
    requestId: input.requestId,
  });
}
