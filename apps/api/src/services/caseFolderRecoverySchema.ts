import { z } from "zod";
import {
  folderPathSchema,
  folderStateSchema,
  MAX_FOLDER_CASES,
} from "./caseFolderSchema.js";

const ref = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const folderRecoveryInputSchema = z
  .object({ projectId: ref, originalReceiptId: ref })
  .strict();
export const approvedFolderRecoverySchema = folderRecoveryInputSchema
  .extend({
    expectedHash: hash,
    requestId: z.string().uuid(),
    expectedScope: z
      .object({ organizationId: ref, clerkActorId: ref })
      .strict()
      .optional(),
    confirmed: z.literal(true),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export const recoverableFolderReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    organizationId: ref,
    action: z.enum(["RENAME", "MOVE"]),
    fromPath: folderPathSchema,
    toPath: folderPathSchema,
    reason: z.string().min(1).max(1000),
    revision: z.number().int().positive(),
    foldersBefore: folderStateSchema,
    foldersAfter: folderStateSchema,
    moves: z
      .array(
        z
          .object({
            id: ref,
            displayId: z.string().min(1).max(100),
            fromSuitePath: z.string().max(1024).nullable(),
            sourceFilePath: z.string().max(4096).nullable(),
            toSuitePath: folderPathSchema,
            sortPosition: z.number().finite(),
            updatedAt: z.string().datetime(),
            version: z.number().int().nonnegative(),
            archived: z.boolean(),
            newVersion: z.number().int().positive(),
            appliedUpdatedAt: z.string().datetime(),
            appliedCaseHash: hash,
          })
          .strict(),
      )
      .max(MAX_FOLDER_CASES),
  })
  .strict()
  .superRefine((row, ctx) => {
    if (new Set(row.moves.map((m) => m.id)).size !== row.moves.length)
      ctx.addIssue({
        code: "custom",
        message: "Recovery must identify each case exactly once.",
      });
  });
