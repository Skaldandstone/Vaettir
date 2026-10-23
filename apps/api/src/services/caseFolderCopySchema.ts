import { z } from "zod";
import { folderPathSchema } from "./caseFolderSchema.js";
export const MAX_FOLDER_COPY_CASES = 50;
export const MAX_FOLDER_COPY_PREREQUISITES = 2500;
export const MAX_FOLDER_COPY_DATASET_ROWS = 500;
export const folderDatasetSourceSchema = z
  .object({
    sourceCaseId: z.string().min(1).max(200),
    sourceDatasetId: z.string().min(1).max(200),
    sourceRevisionHash: z.string().regex(/^[a-f0-9]{64}$/),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    parameterCount: z.number().int().min(1).max(50),
    rowCount: z.number().int().min(1).max(50),
    rows: z
      .array(
        z
          .object({
            rowIndex: z.number().int().min(0).max(49),
            name: z.string().min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export const copiedFolderDatasetSchema = folderDatasetSourceSchema
  .extend({
    caseId: z.string().min(1).max(200),
    displayId: z.string().min(1).max(200),
    datasetId: z.string().min(1).max(200),
  })
  .strict();
export const folderCopyPrerequisiteSchema = z
  .object({
    dependentId: z.string().min(1).max(200),
    prerequisiteId: z.string().min(1).max(200),
  })
  .strict();
export const folderCopyReviewSchema = z
  .object({
    projectId: z.string().min(1).max(200),
    fromPath: folderPathSchema,
    toPath: folderPathSchema,
    // Omit this field for the exact legacy independent-copy contract/hash.
    copyInternalPrerequisites: z.literal(true).optional(),
    copyParameterDatasets: z.literal(true).optional(),
  })
  .strict();
export const folderCopyApprovalSchema = folderCopyReviewSchema
  .extend({
    expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: z.string().uuid(),
    expectedScope: z
      .object({
        organizationId: z.string().min(1).max(200),
        clerkActorId: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
    confirmed: z.literal(true),
    reason: z.string().trim().min(1).max(1000),
    expectedPrerequisiteHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    expectedInternalPrerequisites: z
      .array(folderCopyPrerequisiteSchema)
      .max(MAX_FOLDER_COPY_PREREQUISITES)
      .optional(),
    expectedDatasetHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    expectedDatasets: z
      .array(folderDatasetSourceSchema)
      .max(MAX_FOLDER_COPY_CASES)
      .optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.copyInternalPrerequisites) {
      if (
        !input.expectedPrerequisiteHash ||
        !input.expectedInternalPrerequisites
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Review the complete internal prerequisite graph before copying it.",
        });
    } else if (
      input.expectedPrerequisiteHash !== undefined ||
      input.expectedInternalPrerequisites !== undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Internal prerequisite approval requires explicit opt-in.",
      });
    }
    if (input.copyParameterDatasets) {
      if (
        !input.expectedDatasetHash ||
        !input.expectedDatasets ||
        input.expectedDatasets.reduce((sum, d) => sum + d.rowCount, 0) >
          MAX_FOLDER_COPY_DATASET_ROWS ||
        new Set(input.expectedDatasets.map((d) => d.sourceCaseId)).size !==
          input.expectedDatasets.length ||
        new Set(input.expectedDatasets.map((d) => d.sourceDatasetId)).size !==
          input.expectedDatasets.length ||
        input.expectedDatasets.some(
          (d) =>
            d.rows.length !== d.rowCount ||
            d.rows.some((row, index) => row.rowIndex !== index),
        )
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Review every supported dataset and row within the complete 500-row copy bound.",
        });
    } else if (
      input.expectedDatasetHash !== undefined ||
      input.expectedDatasets !== undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Dataset approval requires explicit copy opt-in.",
      });
    }
  });
