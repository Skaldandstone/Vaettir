import { z } from "zod";
import { TestCaseType } from "@vaettir/db";
import { experienceProfileSchema } from "@vaettir/core";
import {
  validationDomainSchema,
  verificationProfileSchema,
} from "./physicalValidation.js";
import { caseFieldValues } from "./caseFieldSchema.js";

const id = z.string().min(1).max(200),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  text = z.string().max(10000);
export const caseAuthoringPresetExpectedScope = z.object({
  organizationId: id,
  clerkActorId: id,
}).strict();
export const caseAuthoringPresetCatalogScope = z.object({
  projectId: id,
  expectedScope: caseAuthoringPresetExpectedScope.optional(),
}).strict();
export const caseAuthoringPresetDefinition = z
  .object({
    version: z.literal(1),
    titleSuggestion: text,
    background: text,
    given: z.array(text.min(1)).max(100),
    when: z.array(text.min(1)).max(100),
    then: z.array(text.min(1)).max(100),
    steps: z
      .array(
        z
          .object({
            action: text.min(1),
            expectedActionOrData: text,
            expectedResult: text,
            expectedResponse: text,
          })
          .strict(),
      )
      .max(100),
    testType: z.nativeEnum(TestCaseType),
    priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
    tags: z
      .array(z.string().min(1).max(200))
      .max(50)
      .refine((tags) => new Set(tags).size === tags.length, "Duplicate tags"),
    validationDomain: validationDomainSchema,
    verificationProfile: verificationProfileSchema.strict(),
    customFields: caseFieldValues,
    applicability: experienceProfileSchema.nullable(),
  })
  .strict();
const selection = {
  projectId: id,
  expectedScope: caseAuthoringPresetExpectedScope.optional(),
  operation: z.enum(["CREATE", "UPDATE", "ARCHIVE", "UNARCHIVE", "RESTORE"]),
  presetId: id.optional(),
  restoreReceiptId: id.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  definition: caseAuthoringPresetDefinition.optional(),
};
function operationShape(
  input: {
    operation: string;
    presetId?: string;
    restoreReceiptId?: string;
    name?: string;
    definition?: unknown;
  },
  ctx: z.RefinementCtx,
) {
  if (
    (input.operation === "CREATE") === !!input.presetId ||
    (input.operation === "RESTORE") !== !!input.restoreReceiptId ||
    ["CREATE", "UPDATE"].includes(input.operation) !== !!input.name ||
    ["CREATE", "UPDATE"].includes(input.operation) !==
      (input.definition !== undefined)
  )
    ctx.addIssue({
      code: "custom",
      message:
        "Choose the complete definition only for create/edit, the existing preset for other changes and a retained receipt only for restore.",
    });
}
export const caseAuthoringPresetReview = z
  .object(selection)
  .strict()
  .superRefine(operationShape);
export const caseAuthoringPresetApproval = z
  .object({
    ...selection,
    expectedHash: hash,
    requestId: z.string().uuid(),
    confirmed: z.literal(true),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict()
  .superRefine(operationShape);
export const caseAuthoringPresetScope = z
  .object({ projectId: id, presetId: id, expectedScope: caseAuthoringPresetExpectedScope.optional() })
  .strict();
export const caseAuthoringPresetPrefill = caseAuthoringPresetScope
  .extend({ expectedHash: hash, confirmed: z.literal(true) })
  .strict();
export const caseAuthoringPresetSaved = z
  .object({
    presetId: id,
    name: z.string().min(1).max(80),
    version: z.number().int().min(1).max(1000000),
    archived: z.boolean(),
    definition: caseAuthoringPresetDefinition,
  })
  .strict();
export const caseAuthoringPresetReceipt = z
  .object({
    schemaVersion: z.literal(1),
    organizationId: id,
    projectId: id,
    actorId: id,
    operation: z.enum(["CREATE", "UPDATE", "ARCHIVE", "UNARCHIVE", "RESTORE"]),
    reason: z.string().max(1000),
    before: caseAuthoringPresetSaved.nullable(),
    after: caseAuthoringPresetSaved,
    fieldSchemaHash: hash,
    profileHash: hash,
    restoredReceiptId: id.nullable(),
  })
  .strict();
export const presetEvidenceNotice =
  "This is an authoring scaffold, not an approved or executable protocol. Prefill creates a separate new local draft, never edits an existing case. No results, approvals, risk assessments, paid drafts, imports/provider links, attachments/media, shared libraries, datasets, prerequisite-case links or plan/run references are copied. Preconditions/setup remain separate from Given/When/Then and ordered actions. Profile matching is advisory, not qualified regulatory, clinical, food-safety or console TRC applicability. Required criteria, safety and regulatory applicability need qualified human review. No AI credits are used.";
