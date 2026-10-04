import { z } from "zod";
// Pure shared contract. Keep database filtering in reportSnapshotScope.ts.
export const reportExecutionScopeSchema = z
  .object({
    planId: z.string().min(1).max(200).optional(),
    runId: z.string().min(1).max(200).optional(),
    platform: z.string().trim().min(1).max(300).optional(),
    environment: z.string().trim().min(1).max(2000).optional(),
    build: z.string().trim().min(1).max(300).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Choose at least one scope filter",
  );
export type ReportExecutionScope = z.infer<typeof reportExecutionScopeSchema>;
