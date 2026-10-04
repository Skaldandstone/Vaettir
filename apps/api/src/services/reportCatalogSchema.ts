import { z } from "zod";
import { reportDateIntervalSchema } from "./reportDateIntervalSchema.js";

export const reportCatalogInput = z
  .object({
    projectId: z.string().min(1).max(120),
    page: z.number().int().min(0).max(24).default(0),
    search: z.string().trim().max(80).default(""),
    audience: z
      .enum(["all", "stakeholders", "engineering", "quality"])
      .default("all"),
    purpose: z
      .enum([
        "all",
        "custom",
        "quality-status",
        "execution-progress",
        "requirements-coverage",
        "defect-review",
        "automation-progress",
      ])
      .default("all"),
    sort: z.enum(["captured-desc", "title-asc"]).default("captured-desc"),
    capturedInterval: reportDateIntervalSchema.optional(),
  })
  .strict();
export type ReportCatalogInput = z.infer<typeof reportCatalogInput>;
/** A literal title search, not caller-supplied SQL wildcard syntax. */
export function reportCatalogTitlePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, "\\$&")}%`;
}
/** Plain bounded query identity; it contains no credentials, payload or author notes. */
export function reportCatalogKey(input: ReportCatalogInput) {
  return JSON.stringify([
    input.projectId,
    input.page,
    input.search,
    input.audience,
    input.purpose,
    input.sort,
    input.capturedInterval?.start ?? null,
    input.capturedInterval?.end ?? null,
  ]);
}
