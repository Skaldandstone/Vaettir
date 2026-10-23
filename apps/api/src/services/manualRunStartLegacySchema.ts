import { z } from "zod";
import { runConfigurationSchema } from "./qualityExperienceProfile.js";
import { planReferenceSchema } from "./testPlanExecution.js";

// EXACT old router schemas. No reviewed outer pins/defaults enter legacy input.
export const manualRunStartLegacyInputSchema = z
  .object({
    projectId: z.string(),
    testCaseIds: z.array(z.string()).min(1).max(1000),
    expectedProfileHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    executionContext: runConfigurationSchema.optional(),
    idempotencyKey: z.string().uuid().optional(),
    planReference: planReferenceSchema.optional(),
    originalOrganizationId: z.string().min(1).max(200).optional(),
    expectedClerkActorId: z.string().min(1).max(200).optional(),
  })
  .refine(
    (input) =>
      Boolean(input.originalOrganizationId) ===
        Boolean(input.expectedClerkActorId) &&
      (!input.originalOrganizationId || !!input.idempotencyKey),
    {
      message:
        "Provide both original workspace and signed-in account with a durable key for a reviewed run start.",
    },
  );
export const manualRunStartLegacyOutputSchema = z.object({
  testRunId: z.string(),
  originalOrganizationId: z.string().optional(),
  expectedClerkActorId: z.string().optional(),
  idempotencyKey: z.string().uuid().optional(),
});
export type ManualRunStartLegacyInput = z.infer<
  typeof manualRunStartLegacyInputSchema
>;
export type ManualRunStartLegacyRawInput = z.input<
  typeof manualRunStartLegacyInputSchema
>;
