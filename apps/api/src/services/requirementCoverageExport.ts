import { Prisma } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { coverageOutcomes, readRequirementCoverageRunScope } from "./requirementCoverage.js";
import { requirementCoverageLimitations, requirementCoverageRequestKey } from "./requirementCoverageSchema.js";
import { requirementCoverageExportOutput, type RequirementCoverageExportInput } from "./requirementCoverageExportSchema.js";

type Tx = Prisma.TransactionClient;
const refuse = () => new TRPCError({ code: "PRECONDITION_FAILED", message: "The complete selected coverage matrix exceeds its export bounds or has unsupported/foreign native relationships or labels. No partial file or combined browse pages were substituted." });
const MAX_BYTES = 4 * 1024 * 1024;
function boundedCount(value: bigint | undefined, maximum: number) {
  if (value === undefined || value < 0n || value > BigInt(maximum)) throw refuse();
  return Number(value);
}
function title(value: string, excerpt: boolean) {
  if (!value.trim()) throw refuse();
  let text = value.slice(0, 180);
  if (text.length && /[\uD800-\uDBFF]/.test(text[text.length - 1]!)) text = text.slice(0, -1);
  return { text, excerpt: excerpt || text !== value };
}

/** Caller owns one existing bounded locked/current-authorized RR transaction. */
export async function requirementCoverageExport(tx: Tx, access: { projectId: string; organizationId: string; actorClerkUserId: string }, input: RequirementCoverageExportInput) {
  if (access.projectId !== input.projectId || (input.originalOrganizationId && input.originalOrganizationId !== access.organizationId) ||
    (input.expectedClerkActorId && input.expectedClerkActorId !== access.actorClerkUserId)) throw refuse();
  const observedAt = new Date().toISOString();
  const { runWhere, window } = await readRequirementCoverageRunScope(tx, input);
  const escaped = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
  const selected = Prisma.sql`r."projectId"=${input.projectId} AND (${input.search}='' OR r.title ILIKE ${escaped})`;
  const nativeEdges = Prisma.sql`l."projectId"=${input.projectId} AND l.provider='requirement' AND l.kind='requirement' AND l."removedAt" IS NULL`;
  // Gate every active native direct edge, including foreign/deleted requirements.
  // Such an edge must not quietly fall out of the selected join as zero coverage.
  const [edgeGate] = await tx.$queryRaw<Array<{ invalid: bigint }>>(Prisma.sql`
    SELECT count(*) FILTER (WHERE r.id IS NULL OR r."projectId"<>${input.projectId} OR c.id IS NULL OR c."projectId"<>${input.projectId}
      OR l."providerOrigin" IS DISTINCT FROM 'vaettir' OR l."nativeId" IS DISTINCT FROM r.id) AS invalid
    FROM "CaseTraceabilityLink" l LEFT JOIN "Requirement" r ON r.id=l."requirementId" LEFT JOIN "TestCase" c ON c.id=l."caseId" WHERE ${nativeEdges}`);
  if (boundedCount(edgeGate?.invalid, 0)) throw refuse();
  const [requirementGate] = await tx.$queryRaw<Array<{ total: bigint; invalid: bigint }>>(Prisma.sql`
    SELECT count(*) AS total,count(*) FILTER (WHERE length(r.id)>200 OR octet_length(r.id)>800 OR length(btrim(r.title))=0) AS invalid
    FROM "Requirement" r WHERE ${selected}`);
  const requirements = boundedCount(requirementGate?.total, 1000);
  boundedCount(requirementGate?.invalid, 0);
  const pairs = Prisma.sql`SELECT DISTINCT l."requirementId",l."caseId" FROM "CaseTraceabilityLink" l WHERE ${nativeEdges}`;
  const joined = Prisma.sql`FROM "Requirement" r LEFT JOIN (${pairs}) p ON p."requirementId"=r.id
    LEFT JOIN "TestCase" c ON c.id=p."caseId" AND c."projectId"=${input.projectId} WHERE ${selected}`;
  const [gate] = await tx.$queryRaw<Array<{ rows: bigint; pairs: bigint; unlinked: bigint; cases: bigint; archived: bigint; invalid: bigint; bytes: bigint }>>(Prisma.sql`
    SELECT count(*) AS rows,count(c.id) AS pairs,count(*) FILTER (WHERE c.id IS NULL) AS unlinked,
      count(DISTINCT c.id) AS cases,count(DISTINCT c.id) FILTER (WHERE c.archived) AS archived,
      count(*) FILTER (WHERE c.id IS NOT NULL AND (length(c.id)>200 OR octet_length(c.id)>800 OR length(c."displayId") NOT BETWEEN 1 AND 200
        OR octet_length(c."displayId")>800 OR length(btrim(c.title))=0)) AS invalid,
      COALESCE(sum(octet_length(left(r.title,180))+octet_length(r.id)+COALESCE(octet_length(left(c.title,180)),0)
        +COALESCE(octet_length(c."displayId"),0)+COALESCE(octet_length(c.id),0)+1024),0) AS bytes ${joined}`);
  const rowCount = boundedCount(gate?.rows, 1000), directPairs = boundedCount(gate?.pairs, 1000), unlinkedRequirements = boundedCount(gate?.unlinked, 1000);
  const distinctCases = boundedCount(gate?.cases, 1000), archivedCases = boundedCount(gate?.archived, 1000);
  boundedCount(gate?.invalid, 0); boundedCount(gate?.bytes, MAX_BYTES);
  // A public case key must identify exactly one current native project case,
  // even if another duplicate case is outside this requirement search.
  const [duplicateKeys] = await tx.$queryRaw<Array<{ invalid: bigint }>>(Prisma.sql`
    SELECT count(*) AS invalid FROM (SELECT c."displayId" FROM "TestCase" c WHERE c."projectId"=${input.projectId}
      AND c."displayId" IN (SELECT c."displayId" ${joined}) GROUP BY c."displayId" HAVING count(DISTINCT c.id)>1) bad`);
  boundedCount(duplicateKeys?.invalid, 0);
  const rows = await tx.$queryRaw<Array<{ requirementId: string; requirementTitle: string; requirementExcerpt: boolean;
    caseId: string | null; displayId: string | null; caseTitle: string | null; caseExcerpt: boolean | null; archived: boolean | null }>>(Prisma.sql`
    SELECT r.id AS "requirementId",left(r.title,180) AS "requirementTitle",length(r.title)>180 AS "requirementExcerpt",
      c.id AS "caseId",c."displayId" AS "displayId",left(c.title,180) AS "caseTitle",length(c.title)>180 AS "caseExcerpt",c.archived
    ${joined} ORDER BY r.id,c."displayId",c.id`);
  if (rows.length !== rowCount) throw refuse();
  const caseIds = [...new Set(rows.flatMap(row => row.caseId ? [row.caseId] : []))];
  if (caseIds.length !== distinctCases || caseIds.length > 1000) throw refuse();
  const grouped = caseIds.length ? await tx.testResult.groupBy({ by: ["testCaseId", "status"],
    where: { testCaseId: { in: caseIds }, testCase: { projectId: input.projectId }, testRun: runWhere }, _count: { _all: true } }) : [];
  const distinctCaseOutcomes = coverageOutcomes(grouped);
  const outcomes = new Map(caseIds.map(id => [id, coverageOutcomes(grouped.filter(row => row.testCaseId === id))]));
  // Before bounded native run identifiers are materialized, reject unsupported
  // identifier widths in the selected time window. No JSON/array bodies fetched.
  const [runIdGate] = await tx.$queryRaw<Array<{ invalid: bigint }>>`
    SELECT count(*) FILTER (WHERE length(id)>200 OR octet_length(id)>800) AS invalid FROM "TestRun"
    WHERE "projectId"=${input.projectId} AND "startedAt">=${window.start} AND "startedAt"<=${window.end}`;
  boundedCount(runIdGate?.invalid, 0);
  const manualRuns = caseIds.length ? await tx.testRun.findMany({ where: { AND: [runWhere, { ciProvider: "manual" }] }, select: { id: true }, take: 10001 }) : [];
  if (manualRuns.length > 10000) throw refuse();
  const planned = manualRuns.length && caseIds.length ? await tx.$queryRaw<Array<{ id: string; total: bigint }>>(Prisma.sql`
    SELECT c.id,count(DISTINCT r.id) AS total FROM "TestCase" c JOIN "TestRun" r
      ON r.id IN (${Prisma.join(manualRuns.map(run => run.id))}) AND r."projectId"=${input.projectId} AND r."ciProvider"='manual' AND c.id=ANY(r."manualTestCaseIds")
    WHERE c."projectId"=${input.projectId} AND c.id IN (${Prisma.join(caseIds)})
      AND NOT EXISTS (SELECT 1 FROM "TestResult" result WHERE result."testRunId"=r.id AND result."testCaseId"=c.id)
    GROUP BY c.id`) : [];
  const plannedByCase = new Map(planned.map(row => [row.id, boundedCount(row.total, 10000)]));
  const ordinals = new Map<string, number>();
  const matrix = rows.map(row => {
    if (!ordinals.has(row.requirementId)) ordinals.set(row.requirementId, ordinals.size + 1);
    const req = title(row.requirementTitle, row.requirementExcerpt);
    const caseTitle = row.caseId && row.caseTitle !== null ? title(row.caseTitle, !!row.caseExcerpt) : null;
    if (row.caseId && (!row.displayId || !caseTitle || row.archived === null)) throw refuse();
    return { requirementOrdinal: ordinals.get(row.requirementId)!, requirementTitle: req.text, titleIsExcerpt: req.excerpt,
      case: row.caseId ? { displayId: row.displayId!, title: caseTitle!.text, titleIsExcerpt: caseTitle!.excerpt, archived: row.archived! } : null,
      outcomes: row.caseId ? outcomes.get(row.caseId)! : coverageOutcomes([]), plannedWithoutResult: row.caseId ? plannedByCase.get(row.caseId) ?? 0 : 0 };
  });
  if (ordinals.size !== requirements || directPairs + unlinkedRequirements !== rowCount) throw refuse();
  const output = { version: 1 as const, ...access, requested: requirementCoverageRequestKey(input), observedAt,
    window: { start: window.start.toISOString(), end: window.end.toISOString() }, appliedScope: input.scope ?? null, searchPresence: !!input.search,
    selection: { mode: "SEARCH_OR_ALL" as const, requirementCount: requirements },
    population: { requirements, unlinkedRequirements, directPairs, distinctCases, archivedCases,
      distinctCaseResultRecords: distinctCaseOutcomes.total, distinctCaseOutcomes }, rows: matrix,
    limits: [...requirementCoverageLimitations.filter(limit => !limit.startsWith("Each response is a fresh transaction")),
      "All selected requirements and explicit pairs in this response come from one bounded current repeatable-read transaction, never combined browse pages. Not an approved or persisted snapshot.",
      "A case linked to multiple requirements repeats its outcome counts on each pair row. Population distinct-case/result denominators count it only once; summing pair outcomes would double count.",
      "Distinct-case outcomes include only current cases explicitly linked to selected requirements. Unmatched result records and cases outside those links are excluded, not assigned as coverage.",
      "Report-local requirement ordinals distinguish rows only within this response; they are not native stable requirement identities. Titles and public case keys may contain internal information. Title excerpts are flagged; not a full backup.",
      "Unlinked requirements and no-result cases retain literal zero counts. Planned-without-result counts manual run/case presence, not completed execution. Archived cases remain explicit.",
      "Zero selected requirements is not evidence of no risk, fulfillment or readiness. Export refuses over 1,000 requirements, complete pair/unlinked rows or distinct cases, or 4 MiB bounded response metadata."] };
  if (new TextEncoder().encode(JSON.stringify(output)).length > MAX_BYTES) throw refuse();
  const parsed = requirementCoverageExportOutput.safeParse(output);
  if (!parsed.success) throw refuse();
  return parsed.data;
}
