import { z } from "zod";
import { reportDefinitionSchema } from "./reportDefinitionSchema.js";
const base = z.object({ projectId: z.string().min(1).max(120) }).strict();
export const reportDefinitionListInput = base.extend({
  page: z.number().int().min(0).max(9).default(0),
  includeArchived: z.boolean().default(false),
});
export const reportDefinitionHistoryInput = base.extend({
  id: z.string().min(1).max(120),
  page: z.number().int().min(0).max(199).default(0),
});
export const reportDefinitionManageInput = base.extend({
  id: z.string().min(1).max(120),
  version: z.number().int().positive(),
  requestId: z.string().uuid(),
  action: z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("settings"),
        definition: reportDefinitionSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("rename"),
        name: z.string().trim().min(1).max(80),
      })
      .strict(),
    z
      .object({
        kind: z.literal("visibility"),
        visibility: z.enum(["private", "project"]),
      })
      .strict(),
    z.object({ kind: z.literal("archive"), archived: z.boolean() }).strict(),
    z
      .object({
        kind: z.literal("restore"),
        receiptKey: z.string().length(64),
        side: z.enum(["before", "after"]),
      })
      .strict(),
  ]),
  reason: z.string().trim().min(1).max(1000),
  approve: z.literal(true),
  // Explicit sharing consent, required when any resulting settings/author notes
  // will remain visible to project members, including historical restoration.
  approveProjectSharing: z.boolean().default(false),
});
export type ReportDefinitionManageInput = z.infer<
  typeof reportDefinitionManageInput
>;
export const retainedReportDefinitionStateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    definition: z.unknown(),
    visibility: z.enum(["private", "project"]),
    archived: z.boolean(),
    version: z.number().int().positive(),
  })
  .strict();
