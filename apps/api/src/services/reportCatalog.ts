import { Prisma } from "@vaettir/db";
import {
  reportCatalogKey,
  reportCatalogTitlePattern,
  type ReportCatalogInput,
} from "./reportCatalogSchema.js";

// Called only inside the report router's current membership/org/project transaction.
export async function readReportCatalog(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: ReportCatalogInput,
) {
  const conditions = [
    Prisma.sql`"projectId"=${input.projectId}`,
    Prisma.sql`"organizationId"=${organizationId}`,
    Prisma.sql`payload->>'state'='approved'`,
  ];
  if (input.search) {
    conditions.push(
      Prisma.sql`title ILIKE ${reportCatalogTitlePattern(input.search)}`,
    );
  }
  if (input.audience !== "all")
    conditions.push(
      Prisma.sql`payload->'definition'->>'audience'=${input.audience}`,
    );
  if (input.purpose === "custom")
    conditions.push(Prisma.sql`payload->'definition'->>'templateId' IS NULL`);
  else if (input.purpose !== "all")
    conditions.push(
      Prisma.sql`payload->'definition'->>'templateId'=${input.purpose}`,
    );
  if (input.capturedInterval) {
    const start = new Date(`${input.capturedInterval.start}T00:00:00.000Z`);
    const end = new Date(
      Date.parse(`${input.capturedInterval.end}T00:00:00.000Z`) + 86400000,
    );
    conditions.push(Prisma.sql`"asOf">=${start} AND "asOf"<${end}`);
  }
  const where = Prisma.join(conditions, " AND ");
  const order =
    input.sort === "title-asc"
      ? Prisma.sql`title ASC, "asOf" DESC, id ASC`
      : Prisma.sql`"asOf" DESC, id ASC`;
  await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout='5000ms'`);
  const items = await tx.$queryRaw<
    Array<{
      id: string;
      title: string;
      asOf: Date;
      audience: string | null;
      purpose: string | null;
    }>
  >`
    SELECT id,left(title,120) AS title,"asOf",left(payload->'definition'->>'audience',40) AS audience,
      left(payload->'definition'->>'templateId',40) AS purpose
    FROM "ProjectReportSnapshot" WHERE ${where} ORDER BY ${order} LIMIT 21 OFFSET ${input.page * 20}`;
  const [count] = await tx.$queryRaw<
    Array<{ count: bigint }>
  >`SELECT count(*)::bigint AS count FROM "ProjectReportSnapshot" WHERE ${where}`;
  return {
    projectId: input.projectId,
    organizationId,
    page: input.page,
    requestKey: reportCatalogKey(input),
    total: Number(count?.count ?? 0),
    hasMore: items.length > 20,
    items: items.slice(0, 20),
    limitations: [
      "Approved workspace snapshots only; private previews and author notes are not included.",
      "Purpose identifies the chosen starter, not a fixed metric set. Older/custom reports have no starter identity.",
      "Capture dates are UTC, not the execution interval. Each opened report retains its own exact execution scope.",
      "Catalog pages are live, not a frozen search export. New captures can move rows between pages; refresh before reviewing the whole collection.",
    ],
  };
}
