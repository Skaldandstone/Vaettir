import { z } from "zod";
import { observationsSchema } from "./physicalValidation.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.string().min(1).max(200);
export const retestSourceResultSchema = z
  .object({
    id: identity,
    testCaseId: identity,
    status: z.enum(["PASS", "FAIL", "BLOCKED", "SKIP", "FLAKY"]),
    note: z.string().max(10000).nullable(),
    errorMessage: z.string().max(10000).nullable(),
    observations: observationsSchema,
  })
  .strict();

/** Evidence captured at retest approval, not invented whole-case event history. */
export const manualRetestMetadataSchema = z
  .object({
    version: z.literal(1),
    sourceRunId: identity,
    sourceCaseId: identity,
    sourceDisplayId: identity,
    sourceOutcome: z.enum(["FAIL", "BLOCKED"]),
    sourceEvidenceHash: hash,
    sourceDefinitionHash: hash,
    configurationHash: hash,
    sourceResults: z.array(retestSourceResultSchema).min(1).max(500),
    sourceStepRevisions: z
      .array(
        z
          .object({
            testCaseId: identity,
            stepIndex: z.number().int().min(0).max(499),
            revisionId: identity,
            revisionNumber: z.number().int().positive(),
          })
          .strict(),
      )
      .max(500),
    sourceDatasetExecution: z
      .object({
        batchId: z.string().regex(/^dataset_[a-f0-9]{64}$/),
        datasetId: identity,
        datasetHash: hash,
        rowIndex: z.number().int().min(0).max(49),
        rowName: z.string().min(1).max(200),
        values: z.record(z.string().max(10000)),
      })
      .strict()
      .optional(),
  })
  .strict();
