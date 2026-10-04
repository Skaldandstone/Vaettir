import { Prisma } from "@vaettir/db";
import {
  SAVED_QUERY_CATALOG_MAX_OFFSET,
  SAVED_QUERY_CATALOG_PAGE_SIZE,
  type SavedCaseQueryCatalogFilters,
} from "./savedCaseQuerySchema.js";

// Fixed SQL fragments only: callers can supply values, never SQL identifiers.
export function savedQueryCatalogOrder(
  sort: SavedCaseQueryCatalogFilters["sort"],
) {
  if (sort === "NAME_DESC") return Prisma.sql`q.name DESC, q.id ASC`;
  if (sort === "UPDATED_DESC")
    return Prisma.sql`q."updatedAt" DESC, q.name ASC, q.id ASC`;
  return Prisma.sql`q.name ASC, q.id ASC`;
}
export function savedQueryCatalogCollection(
  collection: SavedCaseQueryCatalogFilters["collection"],
  actorId: string,
) {
  if (collection === "PERSONAL")
    return Prisma.sql`q.visibility='PRIVATE' AND q."createdById"=${actorId}`;
  if (collection === "SHARED") return Prisma.sql`q.visibility='SHARED'`;
  if (collection === "MINE") return Prisma.sql`q."createdById"=${actorId}`;
  return Prisma.sql`TRUE`;
}
export function savedQueryCatalogPaging(offset: number, hasMore: boolean) {
  const proposed = offset + SAVED_QUERY_CATALOG_PAGE_SIZE;
  return {
    nextOffset:
      hasMore && proposed <= SAVED_QUERY_CATALOG_MAX_OFFSET ? proposed : null,
    catalogTruncated: hasMore && proposed > SAVED_QUERY_CATALOG_MAX_OFFSET,
    pageSize: SAVED_QUERY_CATALOG_PAGE_SIZE,
    maxOffset: SAVED_QUERY_CATALOG_MAX_OFFSET,
  };
}
