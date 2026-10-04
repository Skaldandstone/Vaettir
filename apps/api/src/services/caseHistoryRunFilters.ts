import { Prisma } from "@vaettir/db";
import type { CaseHistoryRunFilters } from "./caseHistoryRunFiltersSchema.js";

/** Stored provider/run status only. Never classifies case outcomes or verified automation. */
export function caseHistoryRunWhere(filters: CaseHistoryRunFilters | undefined): Prisma.TestRunWhereInput {
  return {
    ...(filters?.recordedSource === "MANUAL" ? { ciProvider: "manual" } : {}),
    ...(filters?.recordedSource === "CI_IMPORT" ? { ciProvider: { not: "manual" } } : {}),
    ...(filters?.runStatus === undefined ? {} : { status: filters.runStatus }),
  };
}

/** Alias r is the same native run in the bounded configuration candidate query. */
export function caseHistoryRunPredicate(filters: CaseHistoryRunFilters | undefined) {
  return Prisma.sql`
    ${filters?.recordedSource === "MANUAL" ? Prisma.sql`AND r."ciProvider"='manual'` : Prisma.empty}
    ${filters?.recordedSource === "CI_IMPORT" ? Prisma.sql`AND r."ciProvider"<>'manual'` : Prisma.empty}
    ${filters?.runStatus === undefined ? Prisma.empty : Prisma.sql`AND r.status::text=${filters.runStatus}`}`;
}
