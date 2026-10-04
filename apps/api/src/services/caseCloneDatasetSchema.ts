import { z } from "zod";
import {
  folderDatasetSourceSchema,
  copiedFolderDatasetSchema,
} from "./caseFolderCopySchema.js";

export const cloneExpectedScopeSchema = z
  .object({
    organizationId: z.string().min(1).max(200),
    clerkActorId: z.string().min(1).max(200),
  })
  .strict();
export const cloneDatasetSourceSchema = folderDatasetSourceSchema;
export const cloneDatasetMappingSchema = copiedFolderDatasetSchema;
export const cloneDatasetApprovalFields = {
  expectedDatasetHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  expectedDataset: cloneDatasetSourceSchema.optional(),
};
export function requireCloneDatasetApproval(
  input: {
    copyParameterDataset?: true;
    expectedDatasetHash?: string;
    expectedDataset?: z.infer<typeof cloneDatasetSourceSchema>;
  },
  ctx: z.RefinementCtx,
) {
  if (input.copyParameterDataset) {
    if (
      !input.expectedDatasetHash ||
      !input.expectedDataset ||
      input.expectedDataset.rows.length !== input.expectedDataset.rowCount ||
      input.expectedDataset.rows.some((r, i) => r.rowIndex !== i)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Review the complete supported dataset and every row before duplicating it.",
      });
  } else if (
    input.expectedDatasetHash !== undefined ||
    input.expectedDataset !== undefined
  )
    ctx.addIssue({
      code: "custom",
      message:
        "Dataset evidence requires explicit independent dataset-copy approval.",
    });
}
