import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import {
  renderBoundedSpreadsheetCsv,
  type SpreadsheetCsvCell,
} from "@vaettir/core";
import { queryCasePage, caseQueryHash } from "./caseQuery.js";
import { caseFieldSchema } from "./caseFieldSchema.js";
import type { CaseCustomCell } from "./caseCustomQuery.js";
import type {
  CaseQueryExportInput,
  ApprovedCaseQueryExportInput,
} from "./caseQueryExportSchema.js";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const LIMIT = 1000;
const labels: Record<string, string> = {
  title: "Title",
  type: "Test type",
  priority: "Priority",
  risk: "Risk score",
  automation: "Automation",
  review: "Review status",
  suite: "Suite path",
  updated: "Updated at (UTC)",
};
const limitations = [
  "Current whole-query metadata, not a frozen stakeholder report or full-fidelity backup. No procedures, setup, media, sources, drafts, approvals, result history or unselected custom values are exported.",
  "At most 1,000 matching cases and one MiB CSV; larger populations or selected clipped labels are refused, never silently truncated. Review confirmation rechecks the whole current population.",
  "Custom values include a separate state: ABSENT, NULL, INVALID or VALUE. Invalid legacy values are unavailable, not coerced; empty text, false and zero remain distinct values.",
  "Counts describe current inventory, not execution outcomes, code coverage, release readiness or improvement velocity. Downloading grants no external recipient access; review authored titles, selected custom values and recipients before sharing.",
  "Leading spreadsheet formulas are text-protected; spreadsheet re-save or import settings can remove protection. No persistent export snapshot or reload-safe export receipt is created.",
];
type Metadata = Awaited<ReturnType<typeof queryCasePage>>["items"][number];

function values(row: Metadata, key: string): SpreadsheetCsvCell[] {
  if (key.startsWith("custom:")) {
    const cell: CaseCustomCell | undefined = row.customValues[key.slice(7)];
    if (!cell || !["ABSENT", "NULL", "INVALID", "VALUE"].includes(cell.state))
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "A selected custom value is unavailable. Repair the metadata before exporting.",
      });
    if (cell.state !== "VALUE") return [cell.state, "Unavailable"];
    if (!["string", "number", "boolean"].includes(typeof cell.value))
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "A selected value has an unsupported representation.",
      });
    return [
      "VALUE",
      typeof cell.value === "boolean"
        ? String(cell.value)
        : (cell.value as string | number),
    ];
  }
  switch (key) {
    case "title":
      return [row.title];
    case "type":
      return [row.testType];
    case "priority":
      return [row.priority];
    case "risk":
      return [row.riskScore ?? "Unavailable: not assessed"];
    case "automation":
      return [row.automationStatus];
    case "review":
      return [row.reviewStatus];
    case "suite":
      return [
        row.suitePath === null ? "UNASSIGNED" : "VALUE",
        row.suitePath ?? "",
      ];
    case "updated":
      return [row.updatedAt.toISOString()];
    default:
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Unsupported export column.",
      });
  }
}
export async function withCaseQueryExportAccess<T>(
  db: PrismaClient,
  actor: string,
  projectId: string,
  originalOrg: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '8000ms'`);
      // Match the existing query lock order; bind to the organization observed
      // before opening this transaction, never follow a concurrent reparent.
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${originalOrg} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Membership" WHERE "organizationId"=${originalOrg} AND "userId"=${actor} FOR UPDATE`;
      const parents = await tx.$queryRaw<
        Array<{ organizationId: string }>
      >`SELECT "organizationId" FROM "Project" WHERE id=${projectId} FOR UPDATE`;
      const [member, org] = await Promise.all([
        tx.membership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: originalOrg,
              userId: actor,
            },
          },
          select: { id: true },
        }),
        tx.organization.findUnique({
          where: { id: originalOrg },
          select: { suspendedAt: true },
        }),
      ]);
      if (
        !member ||
        !org ||
        org.suspendedAt ||
        parents[0]?.organizationId !== originalOrg
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Current access to the original project organization is required.",
        });
      return work(tx);
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}

async function collect(
  tx: Prisma.TransactionClient,
  input: CaseQueryExportInput,
  actor: string,
  organizationId: string,
  env: NodeJS.ProcessEnv,
) {
  const hasCustom =
    !!input.query.customColumns?.length ||
    input.query.groups.some((group) =>
      group.rules.some((rule) => rule.field === "custom"),
    );
  if (hasCustom) {
    const bound = await tx.$queryRaw<
      Array<{ fits: boolean }>
    >`SELECT COALESCE(octet_length("caseFieldSchema"::text)<=65536,false) AS fits FROM "Project" WHERE id=${input.projectId}`;
    if (!bound[0]?.fits)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Project field definitions exceed supported bounds; repair them before exporting.",
      });
  }
  const project = await tx.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: { id: true, name: true, caseKey: true, caseFieldSchema: hasCustom },
  });
  const schema = caseFieldSchema.safeParse(project.caseFieldSchema);
  if (hasCustom && !schema.success)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Repair current project fields before exporting this typed query.",
    });
  const headers = input.columns.flatMap((column) =>
    column.startsWith("custom:")
      ? [
          `${schema.success ? (schema.data.fields.find((field) => field.key === column.slice(7))?.label ?? column) : column} [${column.slice(7)}] state`,
          `${column.slice(7)} value`,
        ]
      : column === "suite"
        ? ["Suite state", "Suite path"]
        : [labels[column]!],
  );
  const rows: Metadata[] = [];
  let cursor: string | undefined,
    total: number | undefined,
    watermark: string | undefined;
  const seen = new Set<string>();
  for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
    const page = await queryCasePage(
      tx,
      {
        projectId: input.projectId,
        query: input.query,
        requestId: input.requestId,
        ...(cursor ? { cursor } : {}),
      },
      actor,
      organizationId,
      env,
    );
    if (page.total > LIMIT)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `This query matches ${page.total} cases. Narrow it to at most ${LIMIT}; no partial export was produced.`,
      });
    if (
      total !== undefined &&
      (total !== page.total || watermark !== page.watermark)
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "The complete query scope changed; review it again.",
      });
    total = page.total;
    watermark = page.watermark;
    for (const row of page.items) {
      if (!row.displayId || seen.has(row.id))
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Case identity or page continuity is unavailable; no substituted export was created.",
        });
      if (
        (input.columns.includes("title") && row.titleClipped) ||
        (input.columns.includes("suite") && row.suiteClipped)
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "A selected title or suite is too long for this bounded metadata projection. Deselect it or repair the label; no clipped export was created.",
        });
      seen.add(row.id);
      rows.push(row);
    }
    cursor = page.nextCursor ?? undefined;
    if (!cursor) break;
  }
  if (cursor || total === undefined || rows.length !== total)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The entire query population could not be read within supported bounds; no truncated export was created.",
    });
  const cells = rows.map((row) => [
    row.displayId,
    String(row.archived),
    ...input.columns.flatMap((column) => values(row, column)),
  ]);
  const aggregates: Array<{ field: string; value: string; count: number }> = [];
  for (const column of [
    "archived",
    ...input.columns.filter((key) =>
      ["type", "priority", "automation", "review"].includes(key),
    ),
  ]) {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value =
        column === "archived"
          ? String(row.archived)
          : String(values(row, column)[0]);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    for (const [value, count] of [...counts.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    ))
      aggregates.push({
        field: column === "archived" ? "Archived" : labels[column]!,
        value,
        count,
      });
  }
  const fingerprint = hash({
    purpose: "vaettir-whole-query-export-v1",
    actor,
    organizationId,
    project: { id: project.id, name: project.name, caseKey: project.caseKey },
    query: input.query,
    columns: input.columns,
    format: input.format,
    schema: hasCustom ? project.caseFieldSchema : null,
    rows: rows.map((row, index) => ({
      id: row.id,
      updatedAt: row.updatedAt.toISOString(),
      cells: cells[index],
    })),
  });
  const queryHash = caseQueryHash(input.query);
  // Render during review too: encoding/file limits must fail before approval,
  // not after a successful-looking review of an unexportable population.
  const exportHeaders =
    input.format === "METADATA"
      ? [
          "Row type",
          "Project",
          "Project key",
          "Read at (UTC)",
          "Query SHA256",
          "Evidence fingerprint",
          "Matching case count",
          "Export boundary",
          "Case ID",
          "Archived",
          ...headers,
        ]
      : [
          "Row type",
          "Project",
          "Project key",
          "Read at (UTC)",
          "Query SHA256",
          "Evidence fingerprint",
          "Matching case count",
          "Export boundary",
          "Inventory field",
          "Recorded value",
          "Case count",
        ];
  const prefix: SpreadsheetCsvCell[] = [
    project.name,
    project.caseKey ?? "Unavailable",
    watermark!,
    queryHash,
    fingerprint,
    total,
    "Current inventory metadata, not a full-fidelity backup or execution verdict. Selected current custom values only. Internal download grants no recipient access. Formula-like text is apostrophe-protected; spreadsheet re-save may remove protection.",
  ];
  const exportRows: SpreadsheetCsvCell[][] =
    input.format === "METADATA"
      ? [
          [
            "Summary",
            ...prefix,
            "Not a case",
            "Not applicable",
            ...headers.map(() => "Not applicable"),
          ],
          ...cells.map((row) => ["Case", ...prefix, ...row]),
        ]
      : [
          [
            "Summary",
            ...prefix,
            "Entire applied query",
            "Matching cases",
            total,
          ],
          ...aggregates.map((row) => [
            "Inventory count",
            ...prefix,
            row.field,
            row.value,
            row.count,
          ]),
        ];
  let csv: string;
  try {
    csv = renderBoundedSpreadsheetCsv(exportHeaders, exportRows, LIMIT + 1);
  } catch (error) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "This whole-query export exceeds its safe format bounds.",
    });
  }
  return {
    csv,
    requestId: input.requestId,
    organizationId,
    projectId: project.id,
    projectName: project.name,
    caseKey: project.caseKey,
    queryHash,
    fingerprint,
    asOf: watermark!,
    total,
    columns: input.columns,
    format: input.format,
    headers,
    aggregates,
    byteLength: Buffer.byteLength(csv, "utf8"),
    sample: input.format === "METADATA" ? cells.slice(0, 5) : [],
    limitations,
  };
}
export async function reviewCaseQueryExport(
  tx: Prisma.TransactionClient,
  input: CaseQueryExportInput,
  actor: string,
  organizationId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const { csv, ...review } = await collect(
    tx,
    input,
    actor,
    organizationId,
    env,
  );
  void csv;
  return review;
}
export async function confirmCaseQueryExport(
  tx: Prisma.TransactionClient,
  input: ApprovedCaseQueryExportInput,
  actor: string,
  organizationId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (input.organizationId !== organizationId)
    throw new TRPCError({ code: "FORBIDDEN" });
  const fresh = await collect(tx, input, actor, organizationId, env);
  if (fresh.fingerprint !== input.expectedFingerprint)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Cases, project identity, criteria or field definitions changed since review. Review the whole query again; no stale CSV was returned.",
    });
  return {
    requestId: input.requestId,
    projectId: input.projectId,
    organizationId,
    fingerprint: fresh.fingerprint,
    total: fresh.total,
    asOf: fresh.asOf,
    filename: `vaettir-query-${input.format.toLowerCase()}-${fresh.queryHash.slice(0, 12)}.csv`,
    csv: fresh.csv,
  };
}
