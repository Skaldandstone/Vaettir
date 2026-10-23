import { z } from "zod";

const identity = z.string().min(1).max(200);
export const sharedLibraryRefSchema = z
  .object({ projectId: identity, id: identity })
  .strict();
export const sharedLibraryStepSchema = z
  .object({
    order: z.number().int().min(0).max(499),
    action: z.string().min(1).max(10000),
    expectedActionOrData: z.string().max(10000).nullable().optional(),
    expectedResult: z.string().max(10000).nullable().optional(),
    expectedResponse: z.string().max(10000).nullable().optional(),
    mediaAttachmentIds: z
      .array(identity)
      .max(8)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
  })
  .strict();
export const sharedLibraryContentSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(10000).nullable(),
    steps: z.array(sharedLibraryStepSchema).min(1).max(500),
  })
  .strict()
  .refine(
    (content) => content.steps.every((step, i) => step.order === i),
    "Step order must be contiguous.",
  );
export const sharedLibrarySnapshotSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(10000).nullable(),
    steps: z.array(sharedLibraryStepSchema).min(1).max(500),
    archived: z.boolean(),
  })
  .strict();
export const sharedLibraryWriteSchema = sharedLibraryRefSchema
  .extend({
    expectedRevisionHash: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: z.string().uuid(),
    confirmed: z.literal(true),
    reason: z.string().trim().min(1).max(1000),
    action: z.enum(["UPDATE", "RESTORE", "ARCHIVE", "RECOVER"]),
    content: sharedLibraryContentSchema.optional(),
    sourceRevision: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if ((input.action === "UPDATE") !== !!input.content)
      ctx.addIssue({
        code: "custom",
        message: "Only an update supplies reviewed content.",
      });
    if ((input.action === "RESTORE") !== !!input.sourceRevision)
      ctx.addIssue({
        code: "custom",
        message: "Only a restore supplies a saved revision.",
      });
  });
