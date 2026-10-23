import { z } from "zod";
import { CASE_QUERY_COLUMNS, caseQuerySchema } from "./caseQuerySchema.js";

export const caseQueryColumnsSchema = z
  .array(
    z.union([
      z.enum(CASE_QUERY_COLUMNS),
      z.string().regex(/^custom:[a-z][a-z0-9_]{0,39}$/),
    ]),
  )
  .min(1, "Choose at least one column beyond Case ID")
  .max(8)
  .refine(
    (columns) => new Set(columns).size === columns.length,
    "Choose each column once",
  );
const savedCaseQueryDefinitionObject = z
  .object({
    name: z.string().trim().min(1).max(80),
    visibility: z.enum(["PRIVATE", "SHARED"]),
    query: caseQuerySchema,
    columns: caseQueryColumnsSchema,
  })
  .strict();
const reviewColumns = (
  definition: z.infer<typeof savedCaseQueryDefinitionObject>,
  ctx: z.RefinementCtx,
) => {
  const keys = definition.columns
    .filter((column) => column.startsWith("custom:"))
    .map((column) => column.slice(7));
  if (
    keys.some(
      (key) =>
        !(definition.query.customColumns ?? []).some(
          (column) => column.key === key,
        ),
    ) ||
    (definition.query.customColumns ?? []).some(
      (column) => !keys.includes(column.key),
    )
  )
    ctx.addIssue({
      code: "custom",
      message:
        "Review each custom column and its current project-field binding before saving.",
    });
};
export const savedCaseQueryDefinition =
  savedCaseQueryDefinitionObject.superRefine(reviewColumns);
// Optional for legacy clients: absence must not change existing request hashes.
// New browser requests bind the reviewed actor/tenant before any receipt replay.
const expectedSavedQueryScope = z
  .object({
    organizationId: z.string().min(1).max(120),
    clerkActorId: z.string().min(1).max(200),
  })
  .strict()
  .optional();
// Catalog controls are additive read inputs. No defaults are injected into a
// legacy absent catalog or any saved write/receipt payload.
export const SAVED_QUERY_CATALOG_PAGE_SIZE = 50;
export const SAVED_QUERY_CATALOG_MAX_OFFSET = 150;
export const savedCaseQueryCatalogFilters = z
  .object({
    search: z.string().max(80),
    collection: z.enum(["ALL", "PERSONAL", "SHARED", "MINE"]),
    sort: z.enum(["NAME_ASC", "NAME_DESC", "UPDATED_DESC"]),
  })
  .strict();
export const savedCaseQueryCatalogInput = z
  .object({
    projectId: z.string().min(1).max(120),
    offset: z
      .number()
      .int()
      .min(0)
      .max(SAVED_QUERY_CATALOG_MAX_OFFSET)
      .default(0),
    catalog: savedCaseQueryCatalogFilters.optional(),
    expectedScope: expectedSavedQueryScope,
  })
  .strict();
export type SavedCaseQueryCatalogFilters = z.infer<
  typeof savedCaseQueryCatalogFilters
>;
export type SavedCaseQueryCatalogInput = z.infer<
  typeof savedCaseQueryCatalogInput
>;
// Selected bodies have their own authorization read. Catalog membership and a
// cached selection never stand in for the original actor/workspace binding.
export const savedCaseQueryReadInput = z
  .object({
    projectId: z.string().min(1).max(120),
    id: z.string().min(1).max(120),
    expectedScope: expectedSavedQueryScope,
  })
  .strict();
export type SavedCaseQueryReadInput = z.infer<typeof savedCaseQueryReadInput>;
export function savedCaseQueryCatalogKey(
  filters: SavedCaseQueryCatalogFilters,
) {
  return JSON.stringify([filters.search, filters.collection, filters.sort]);
}
export const savedCaseQueryWriteInput = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("CREATE"),
      projectId: z.string().min(1).max(120),
      requestId: z.string().uuid(),
      expectedScope: expectedSavedQueryScope,
      definition: savedCaseQueryDefinition,
    })
    .strict(),
  z
    .object({
      operation: z.literal("UPDATE"),
      projectId: z.string().min(1).max(120),
      requestId: z.string().uuid(),
      expectedScope: expectedSavedQueryScope,
      id: z.string().min(1).max(120),
      expectedVersion: z.number().int().min(1).max(999999),
      definition: savedCaseQueryDefinition,
    })
    .strict(),
  z
    .object({
      operation: z.literal("DELETE"),
      projectId: z.string().min(1).max(120),
      requestId: z.string().uuid(),
      expectedScope: expectedSavedQueryScope,
      id: z.string().min(1).max(120),
      expectedVersion: z.number().int().min(1).max(999999),
    })
    .strict(),
]);
export const savedCaseQueryValue = savedCaseQueryDefinitionObject
  .extend({
    id: z.string(),
    projectId: z.string(),
    createdById: z.string(),
    version: z.number().int().min(1).max(1000000),
    deleted: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine(reviewColumns);
export const savedCaseQueryWriteResponse = z
  .object({
    requestId: z.string().uuid(),
    operation: z.enum(["CREATE", "UPDATE", "DELETE"]),
    value: savedCaseQueryValue,
  })
  .strict();
export type SavedCaseQueryWriteInput = z.infer<typeof savedCaseQueryWriteInput>;
export type SavedCaseQueryValue = z.infer<typeof savedCaseQueryValue>;
export type SavedCaseQueryWriteResponse = z.infer<
  typeof savedCaseQueryWriteResponse
>;
