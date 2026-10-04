import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { withQualityRiskAccess } from "./qualityRisks.js";
import { riskOverviewProjection, qualityRiskOverviewRequestKey, qualityRiskOverviewLimits,
  type RiskOverviewProjection, type QualityRiskOverviewInput, type QualityRiskOverviewDetailInput } from "./qualityRiskOverviewSchema.js";
type Tx = Prisma.TransactionClient;
const tooLarge = () => new TRPCError({ code: "PRECONDITION_FAILED", message: "The complete risk population exceeds this bounded overview or contains unsupported recorded metadata. No entries, unknown categories or evidence references were silently dropped." });
const unavailable = () => new TRPCError({ code: "NOT_FOUND", message: "This risk record or its original project ownership is unavailable." });
export function withRiskOverviewAccess<T>(db: PrismaClient, input: { projectId: string; originalOrganizationId?: string; expectedClerkActorId?: string },
  actorId: string, organizationId: string, work: (tx: Tx, scope: { projectId: string; organizationId: string; actorClerkUserId: string }) => Promise<T>) {
  return withQualityRiskAccess(db, input.projectId, actorId, organizationId, async (tx, access) => {
    const state = await tx.projectQualityRiskState.findUnique({ where: { projectId: input.projectId }, select: { organizationId: true } });
    if ((state && state.organizationId !== organizationId) || (input.originalOrganizationId && input.originalOrganizationId !== organizationId)) throw unavailable();
    const actor = await tx.user.findUnique({ where: { id: access.actorId }, select: { clerkUserId: true } });
    const member = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId: access.organizationId, userId: access.actorId } }, select: { role: true, seatType: true } });
    if (!actor || !actor.clerkUserId || actor.clerkUserId.length > 200 || !member ||
      !["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(member.role) || !["FULL", "READ_ONLY"].includes(member.seatType) ||
      (input.expectedClerkActorId && input.expectedClerkActorId !== actor.clerkUserId))
      throw new TRPCError({ code: "FORBIDDEN", message: "Current original actor and project membership are required for this risk overview." });
    // Membership and project ownership remain locked throughout work. An actor
    // pin grants nothing; omitted legacy pins still receive server-owned echoes.
    return work(tx, { projectId: input.projectId, organizationId: access.organizationId, actorClerkUserId: actor.clerkUserId });
  });
}
const safeArray = (value: Prisma.Sql) => Prisma.sql`CASE WHEN jsonb_typeof(${value})='array' THEN ${value} ELSE '[]'::jsonb END`;
const safeObject = (value: Prisma.Sql) => Prisma.sql`CASE WHEN jsonb_typeof(${value})='object' THEN ${value} ELSE '{}'::jsonb END`;
const nativeIdsValid = (value: Prisma.Sql) => Prisma.sql`jsonb_typeof(${value})='array' AND jsonb_array_length(${safeArray(value)})<=20
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(${safeArray(value)}) AS ids(value)
    WHERE jsonb_typeof(value)<>'string' OR length(value #>> '{}') NOT BETWEEN 1 AND 120)`;
async function source(tx: Tx, projectId: string, id?: string) {
  if (await tx.qualityRiskEntry.count({ where: { projectId } }) > 1000) throw tooLarge();
  const definition = Prisma.sql`e.definition`, decision = Prisma.sql`d.decision`, evidence = Prisma.sql`d.evidence`;
  const strings = [["title", 160, true], ["component", 160, true], ["failureMode", 1000, true], ["cause", 1500, true],
    ["effect", 1500, true], ["rationale", 2000, true], ["mitigation", 2000, false]] as const;
  const validStrings = Prisma.join(strings.map(([key, max, required]) => Prisma.sql`jsonb_typeof(${definition}->${key})='string'
    AND length(${definition}->>${key})<=${max} ${required ? Prisma.sql`AND length(btrim(${definition}->>${key}))>0` : Prisma.empty}`), " AND ");
  const validDefinition = Prisma.sql`jsonb_typeof(${definition})='object' AND octet_length(${definition}::text)<=18000
    AND ${safeObject(definition)} - ARRAY['title','component','failureMode','cause','effect','likelihood','consequence','rationale','mitigation','requirementIds','caseIds']::text[]='{}'::jsonb
    AND ${validStrings} AND e.title=${definition}->>'title'
    AND jsonb_typeof(${definition}->'likelihood')='string' AND length(${definition}->>'likelihood')<=20
    AND jsonb_typeof(${definition}->'consequence')='string' AND length(${definition}->>'consequence')<=20
    AND ${nativeIdsValid(Prisma.sql`${definition}->'caseIds'`)} AND ${nativeIdsValid(Prisma.sql`${definition}->'requirementIds'`)}`;
  const validDecision = Prisma.sql`jsonb_typeof(${decision})='object' AND octet_length(${decision}::text)<=9000
    AND ${safeObject(decision)} - ARRAY['likelihood','consequence','rationale','evidenceNotes','disposition','resultIds','acknowledgeNotQualifiedApproval']::text[]='{}'::jsonb
    AND jsonb_typeof(${decision}->'rationale')='string' AND length(btrim(${decision}->>'rationale')) BETWEEN 1 AND 2000
    AND jsonb_typeof(${decision}->'evidenceNotes')='string' AND length(${decision}->>'evidenceNotes')<=2000
    AND jsonb_typeof(${decision}->'likelihood')='string' AND length(${decision}->>'likelihood')<=20
    AND jsonb_typeof(${decision}->'consequence')='string' AND length(${decision}->>'consequence')<=20
    AND jsonb_typeof(${decision}->'disposition')='string' AND length(${decision}->>'disposition')<=40
    AND ${decision}->'acknowledgeNotQualifiedApproval'='true'::jsonb AND ${nativeIdsValid(Prisma.sql`${decision}->'resultIds'`)}`;
  const validEvidence = Prisma.sql`jsonb_typeof(${evidence})='array' AND jsonb_array_length(${safeArray(evidence)})<=20
    AND octet_length(${evidence}::text)<=16000
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(${safeArray(evidence)}) AS captured(value)
      WHERE jsonb_typeof(value)<>'object' OR ${safeObject(Prisma.sql`value`)} - ARRAY['resultId','caseId','runId','caseDisplayId','status','observedAt','runStartedAt']::text[]<>'{}'::jsonb
        OR NOT (${Prisma.join(([["resultId",120],["caseId",120],["runId",120],["caseDisplayId",160],["status",20],["observedAt",40],["runStartedAt",40]] as const).map(([key,max]) =>
          Prisma.sql`COALESCE(jsonb_typeof(value->${key})='string' AND length(value->>${key})<=${max},false)`), " AND ")}))`;
  // Only bounded category/reference metadata reaches the application. No raw
  // decision rationale/evidence notes, initial procedure/cause text or baseline.
  const rows = await tx.$queryRaw<Array<{ metadata: unknown; populationBytes: bigint; reviewRecordedAt: Date | null }>>(Prisma.sql`
    WITH projected AS (
      SELECT CASE WHEN length(e.id)<=120 AND length(e."displayId") BETWEEN 1 AND 160 AND ${validDefinition}
        AND (d.id IS NULL OR (length(d.id)<=120 AND ${validDecision} AND ${validEvidence}))
      THEN jsonb_build_object('id',e.id,'number',e.number,'displayId',e."displayId",'version',e.version,
        'title',e.title,'component',${definition}->'component','likelihood',${definition}->'likelihood','consequence',${definition}->'consequence',
        'caseIds',${definition}->'caseIds','requirementIds',${definition}->'requirementIds',
        'latest',CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object('id',d.id,'createdVersion',d."createdVersion",'assessedVersion',d."assessedVersion",
          'createdAt',to_char(d."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'likelihood',${decision}->'likelihood','consequence',${decision}->'consequence',
          'disposition',${decision}->'disposition','resultIds',${decision}->'resultIds','evidence',${evidence}) END) ELSE NULL END AS metadata,
        e.number,e.id,d."createdAt" AS "reviewRecordedAt" FROM "QualityRiskEntry" e
        LEFT JOIN LATERAL (SELECT id,"createdVersion","assessedVersion","createdAt",decision,evidence FROM "QualityRiskDecision"
          WHERE "entryId"=e.id ORDER BY "createdVersion" DESC,id DESC LIMIT 1) d ON true
        WHERE e."projectId"=${projectId} ${id ? Prisma.sql`AND e.id=${id}` : Prisma.empty}
    ), bounded AS (SELECT metadata,number,id,"reviewRecordedAt",sum(octet_length(metadata::text)) OVER () AS bytes FROM projected)
    SELECT CASE WHEN bytes<=8388608 THEN metadata ELSE NULL END AS metadata,bytes AS "populationBytes","reviewRecordedAt"
    FROM bounded ORDER BY number,id LIMIT 1001`);
  if (rows.length > 1000 || rows.some(row => !row.metadata || Number(row.populationBytes) > 8388608)) throw tooLarge();
  return rows.map(row => {
    const metadata = row.metadata as Record<string, unknown>;
    if (metadata.latest !== null) {
      // Use the actual driver-decoded timestamp, not a presumed SQL timezone.
      if (!row.reviewRecordedAt || Number.isNaN(row.reviewRecordedAt.getTime())) throw tooLarge();
      metadata.latest = { ...(metadata.latest as Record<string, unknown>), createdAt: row.reviewRecordedAt.toISOString() };
    }
    const parsed = riskOverviewProjection.safeParse(metadata); if (!parsed.success) throw tooLarge(); return parsed.data;
  });
}
type Availability = { results: Map<string, { caseId: string; runId: string }>; cases: Map<string, { label: string; title: string; titleIsExcerpt: boolean; archived: boolean }>;
  requirements: Map<string, { label: string; titleIsExcerpt: boolean }> };
async function availability(tx: Tx, projectId: string, entries: RiskOverviewProjection[]): Promise<Availability> {
  const resultIds = [...new Set(entries.flatMap(row => row.latest?.evidence.map(ref => ref.resultId) ?? []))],
    caseIds = [...new Set(entries.flatMap(row => row.caseIds))], requirementIds = [...new Set(entries.flatMap(row => row.requirementIds))];
  // <=20k input references per category, each native ID <=120 chars; no raw JSON.
  const results = resultIds.length ? await tx.$queryRaw<Array<{ id: string; caseId: string; runId: string }>>(
    Prisma.sql`SELECT r.id,r."testCaseId" AS "caseId",r."testRunId" AS "runId" FROM "TestResult" r
      JOIN "TestRun" t ON t.id=r."testRunId" AND t."projectId"=${projectId}
      JOIN "TestCase" c ON c.id=r."testCaseId" AND c."projectId"=${projectId}
      WHERE r.id IN (${Prisma.join(resultIds)})`) : [];
  const cases = caseIds.length ? await tx.$queryRaw<Array<{ id: string; label: string; title: string; titleIsExcerpt: boolean; archived: boolean }>>(
    Prisma.sql`SELECT id,CASE WHEN length("displayId")<=160 THEN "displayId" ELSE NULL END AS label,left(title,160) AS title,length(title)>160 AS "titleIsExcerpt",archived
      FROM "TestCase" WHERE "projectId"=${projectId} AND id IN (${Prisma.join(caseIds)})`) : [];
  const requirements = requirementIds.length ? await tx.$queryRaw<Array<{ id: string; label: string; titleIsExcerpt: boolean }>>(
    Prisma.sql`SELECT id,left(title,160) AS label,length(title)>160 AS "titleIsExcerpt"
      FROM "Requirement" WHERE "projectId"=${projectId} AND id IN (${Prisma.join(requirementIds)})`) : [];
  if (cases.some(row => !row.label || row.label.length > 160)) throw tooLarge();
  return { results: new Map(results.map(row => [row.id, { caseId: row.caseId, runId: row.runId }])),
    cases: new Map(cases.map(row => { const excerpt = riskOverviewLabel(row.title); return [row.id, { ...row, title: excerpt.label,
      titleIsExcerpt: row.titleIsExcerpt || excerpt.excerpt }] as const; })),
    requirements: new Map(requirements.map(row => { const excerpt = riskOverviewLabel(row.label); return [row.id, { ...row, label: excerpt.label,
      titleIsExcerpt: row.titleIsExcerpt || excerpt.excerpt }] as const; })) };
}
/** <=160 UTF-16 units without splitting a surrogate pair; SQL first bounds
 * materialization to160 codepoints. Both truncation stages remain disclosed. */
export function riskOverviewLabel(value: string) {
  let label = ""; for (const character of value) { if (label.length + character.length > 160) break; label += character; }
  return { label, excerpt: label.length < value.length };
}
const state = <T extends "NONE_RECORDED" | "NO_LINKS">(total: number, available: number, empty: T) => !total ? empty
  : available === total ? "ALL_REFERENCES_AVAILABLE" as const : !available ? "ALL_REFERENCES_UNAVAILABLE" as const : "SOME_REFERENCES_UNAVAILABLE" as const;
function entryMetadata(entry: RiskOverviewProjection, available: Availability) {
  const evidence = entry.latest?.evidence ?? [], resolvedEvidence = evidence.filter(ref => {
    const current = available.results.get(ref.resultId); return !!current && current.caseId === ref.caseId && current.runId === ref.runId;
  }).length;
  const intendedLinks = entry.caseIds.length + entry.requirementIds.length,
    resolvedLinks = entry.caseIds.filter(id => available.cases.has(id)).length + entry.requirementIds.filter(id => available.requirements.has(id)).length;
  return { id: entry.id, number: entry.number, displayId: entry.displayId, version: entry.version, title: entry.title, component: entry.component,
    likelihood: entry.likelihood, consequence: entry.consequence,
    review: !entry.latest ? "NO_REVIEW" as const : entry.latest.createdVersion === entry.version ? "VERSION_MATCHING_REVIEW" as const : "BASELINE_CHANGED" as const,
    disposition: entry.latest?.disposition ?? "NOT_RECORDED" as const,
    residual: entry.latest ? { likelihood: entry.latest.likelihood, consequence: entry.latest.consequence, recordedAt: entry.latest.createdAt,
      assessedVersion: entry.latest.assessedVersion, createdVersion: entry.latest.createdVersion } : null,
    evidence: { total: evidence.length, available: resolvedEvidence, unavailable: evidence.length - resolvedEvidence,
      state: entry.latest ? state(evidence.length, resolvedEvidence, "NONE_RECORDED") : "NO_REVIEW" as const },
    mitigation: { total: intendedLinks, available: resolvedLinks, unavailable: intendedLinks - resolvedLinks, state: state(intendedLinks, resolvedLinks, "NO_LINKS") } };
}
type EntryMetadata = ReturnType<typeof entryMetadata>;
export function riskOverviewCounts(rows: EntryMetadata[]) {
  const likelihood = { UNKNOWN: 0, RARE: 0, POSSIBLE: 0, FREQUENT: 0 }, consequence = { UNKNOWN: 0, MINOR: 0, SIGNIFICANT: 0, SEVERE: 0 },
    review = { NO_REVIEW: 0, VERSION_MATCHING_REVIEW: 0, BASELINE_CHANGED: 0 },
    disposition = { NOT_RECORDED: 0, FURTHER_ACTION: 0, REVIEW_RECORDED: 0, HUMAN_ACCEPTANCE_RECORDED: 0 },
    evidence = { NO_REVIEW: 0, NONE_RECORDED: 0, ALL_REFERENCES_AVAILABLE: 0, SOME_REFERENCES_UNAVAILABLE: 0, ALL_REFERENCES_UNAVAILABLE: 0 },
    mitigation = { NO_LINKS: 0, ALL_REFERENCES_AVAILABLE: 0, SOME_REFERENCES_UNAVAILABLE: 0, ALL_REFERENCES_UNAVAILABLE: 0 };
  for (const row of rows) { likelihood[row.likelihood]++; consequence[row.consequence]++; review[row.review]++; disposition[row.disposition]++;
    evidence[row.evidence.state]++; mitigation[row.mitigation.state]++; }
  return { entries: rows.length, likelihood, consequence, review, disposition, evidence, mitigation,
    evidenceReferences: rows.reduce((counts, row) => ({ total: counts.total + row.evidence.total, available: counts.available + row.evidence.available,
      unavailable: counts.unavailable + row.evidence.unavailable }), { total: 0, available: 0, unavailable: 0 }) };
}
export async function qualityRiskOverview(tx: Tx, organizationId: string, input: QualityRiskOverviewInput) {
  const sources = await source(tx, input.projectId), available = await availability(tx, input.projectId, sources);
  const rows = sources.map(row => entryMetadata(row, available)), needle = input.search.toLowerCase();
  const filtered = rows.filter(row => (!needle || [row.displayId, row.title, row.component].some(value => value.toLowerCase().includes(needle)))
    && (!input.likelihood || row.likelihood === input.likelihood) && (!input.consequence || row.consequence === input.consequence)
    && (input.review === "ANY" || row.review === input.review) && (input.disposition === "ANY" || row.disposition === input.disposition)
    && (input.evidence === "ANY" || row.evidence.state === input.evidence) && (input.mitigation === "ANY" || row.mitigation.state === input.mitigation));
  return { projectId: input.projectId, organizationId, requested: qualityRiskOverviewRequestKey(input), observedAt: new Date().toISOString(),
    population: riskOverviewCounts(rows), filtered: riskOverviewCounts(filtered), items: filtered.slice(input.offset, input.offset + 20),
    hasMore: filtered.length > input.offset + 20, limits: qualityRiskOverviewLimits };
}
export async function qualityRiskOverviewDetail(tx: Tx, organizationId: string, input: QualityRiskOverviewDetailInput) {
  const entries = await source(tx, input.projectId, input.id); if (!entries[0]) throw unavailable();
  const available = await availability(tx, input.projectId, entries), entry = entries[0], metadata = entryMetadata(entry, available);
  return { projectId: input.projectId, organizationId, requested: qualityRiskOverviewRequestKey(input), observedAt: new Date().toISOString(), entry: metadata,
    // Missing historical tuples redact all native IDs; retained public labels and
    // captured statuses remain historical, not current outcome classifications.
    evidence: (entry.latest?.evidence ?? []).map(ref => {
      const current = available.results.get(ref.resultId), resolved = !!current && current.caseId === ref.caseId && current.runId === ref.runId;
      return { ...ref, resultId: resolved ? ref.resultId : null, caseId: resolved ? ref.caseId : null,
        runId: resolved ? ref.runId : null, available: resolved };
    }),
    cases: entry.caseIds.map(id => { const row = available.cases.get(id); return row ? { caseId: id, available: true, label: row.label, title: row.title,
      titleIsExcerpt: row.titleIsExcerpt, archived: row.archived } : { caseId: null, available: false, label: "Unavailable intended case", title: null, titleIsExcerpt: false, archived: null }; }),
    requirements: entry.requirementIds.map(id => { const row = available.requirements.get(id); return row ? { requirementId: id, available: true, label: row.label,
      titleIsExcerpt: row.titleIsExcerpt } : { requirementId: null, available: false, label: "Unavailable intended requirement", titleIsExcerpt: false }; }),
    limits: qualityRiskOverviewLimits };
}
