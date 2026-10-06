import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { lockManualExecutionReadScope } from "./manualExecutionReadScope.js";
import { supportedManualExecutionIdentity } from "./manualExecutionReadScopeSchema.js";
import { readRunExperienceSnapshot, qualityProfileHash } from "./qualityExperienceProfile.js";
import { runProgress } from "./runProgress.js";
import { manualRunCatalogInputSchema, manualRunCatalogOutputSchema, manualRunComparisonInputSchema, manualRunComparisonOutputSchema, manualRunComparisonRequestKey, type ManualRunCatalogInput, type ManualRunComparisonInput } from "./manualRunComparisonSchema.js";
type Tx = Prisma.TransactionClient;
const MiB = 1024n * 1024n;
const limitations = [
  "Recorded manual-run comparison, not regression detection, verified recovery, release readiness or coverage. NO_CASE_VERDICT means no recorded case verdict, not proof no step was attempted.",
  "Definitions and configuration are saved run snapshots. Friendly case ID labels are current same-project identity metadata, not captured historical labels. Same recorded configuration labels do not establish equivalent environments or comparable execution.",
  "Current original-organization and actor binding authorizes this read. Historical original tenant/session attribution is not recorded in these frozen records and is not inferred.",
  "The catalogue uses stored run startedAt in UTC, not observation dates. Imports and later observations do not establish original chronology.",
  "Missing on one side means not in that run's saved planned scope. Unmatched/out-of-scope result rows do not advance planned-case progress. Conflicting or duplicate planned results refuse the comparison; no latest writer is guessed.",
  "Current read-time view, at most 1,000 planned cases per run and 50 comparison rows per page. Changes to compared definitions, run metadata or result identities/statuses invalidate pagination; notes, errors and step history are not loaded or pinned. Exports cover the current comparison page, not every page or full revision history/media.",
  "Legacy or unsupported/incomplete frozen procedures refuse explicitly. No current case bodies, source, result notes, errors or attachment files are substituted or fetched.",
];
const denied = () => new TRPCError({ code: "FORBIDDEN", message: "Current original-organization membership and signed-in comparison actor are required." });
const unavailable = (message: string) => new TRPCError({ code: "PRECONDITION_FAILED", message });
const runSelect = Prisma.sql`CASE WHEN length(id)<=200 AND octet_length(id)<=800 THEN id ELSE NULL END AS id,status::text AS status,"startedAt","finishedAt",CASE WHEN cardinality("manualTestCaseIds")<=1000 THEN cardinality("manualTestCaseIds")::int ELSE NULL END AS "plannedCases",NOT coalesce(cardinality("manualTestCaseIds") BETWEEN 0 AND 1000,false) AS "scopeUnsupported",coalesce(jsonb_typeof("executionContext")='object' AND "executionContext"->>'version'='1',false) AS "versionOneSnapshotPresent"`;
type StoredMetadata = { id: string; status: "RUNNING" | "PASSED" | "FAILED" | "PARTIAL"; startedAt: Date; finishedAt: Date | null; plannedCases: number | null; scopeUnsupported?: boolean; versionOneSnapshotPresent: boolean };
const metadata = (run: StoredMetadata) => {
  if (!run.id) throw unavailable("A run identity exceeds the supported catalogue/comparison boundary. No identifier was clipped or substituted.");
  if (!Number.isFinite(run.startedAt.getTime()) || (run.finishedAt && !Number.isFinite(run.finishedAt.getTime()))) throw unavailable("Stored run timestamps are unsupported. No original chronology was invented.");
  return { ...run, scopeUnsupported: run.plannedCases === null || !!run.scopeUnsupported, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null };
};

async function withAccess<T>(db: PrismaClient, actorId: string, clerkActorId: string, input: ManualRunCatalogInput | ManualRunComparisonInput, work: (tx: Tx) => Promise<T>) {
  if (!supportedManualExecutionIdentity(actorId) || !supportedManualExecutionIdentity(clerkActorId) || clerkActorId !== input.expectedClerkActorId) throw denied();
  return db.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout='8000ms'`);
    const [org] = await tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`SELECT "suspendedAt" FROM "Organization" WHERE id=${input.originalOrganizationId} FOR SHARE`;
    const [member] = await tx.$queryRaw<Array<{ role: string; seatType: string }>>`SELECT role::text AS role,"seatType"::text AS "seatType" FROM "Membership" WHERE "organizationId"=${input.originalOrganizationId} AND "userId"=${actorId} FOR SHARE`;
    const [project] = await tx.$queryRaw<Array<{ organizationId: string | null }>>`SELECT CASE WHEN length("organizationId")<=200 AND octet_length("organizationId")<=800 THEN "organizationId" ELSE NULL END AS "organizationId" FROM "Project" WHERE id=${input.projectId} FOR SHARE`;
    const [actor] = await tx.$queryRaw<Array<{ clerkUserId: string | null }>>`SELECT CASE WHEN length("clerkUserId")<=200 AND octet_length("clerkUserId")<=800 THEN "clerkUserId" ELSE NULL END AS "clerkUserId" FROM "User" WHERE id=${actorId} FOR SHARE`;
    if (!org || org.suspendedAt || !member || !["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(member.role) || !["FULL", "READ_ONLY"].includes(member.seatType) || project?.organizationId !== input.originalOrganizationId || actor?.clerkUserId !== clerkActorId || actor.clerkUserId !== input.expectedClerkActorId) throw denied();
    const value = await work(tx);
    return { ...value, projectId: input.projectId, organizationId: input.originalOrganizationId, clerkActorId, requestId: input.requestId, requestKey: manualRunComparisonRequestKey(input) };
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
}

export async function listManualComparisonRuns(db: PrismaClient, actorId: string, clerkActorId: string, raw: ManualRunCatalogInput) {
  const input = manualRunCatalogInputSchema.parse(raw);
  const start = new Date(`${input.interval.start}T00:00:00.000Z`), endExclusive = new Date(Date.parse(`${input.interval.end}T00:00:00.000Z`) + 86400000);
  const value = await withAccess(db, actorId, clerkActorId, input, async tx => {
    if (input.cursor) {
      const [anchor] = await tx.$queryRaw<Array<{ startedAt: Date }>>`SELECT "startedAt" FROM "TestRun" WHERE id=${input.cursor.id} AND "projectId"=${input.projectId} AND "ciProvider"='manual' AND "startedAt">=${start} AND "startedAt"<${endExclusive}`;
      if (!anchor || anchor.startedAt.toISOString() !== input.cursor.startedAt) throw new TRPCError({ code: "CONFLICT", message: "The catalogue cursor changed or leaves this manual run/date scope. Restart the catalogue; selections were not replaced." });
    }
    const runs = await tx.$queryRaw<StoredMetadata[]>(Prisma.sql`SELECT ${runSelect} FROM "TestRun" WHERE "projectId"=${input.projectId} AND "ciProvider"='manual' AND "startedAt">=${start} AND "startedAt"<${endExclusive} AND ${input.cursor ? Prisma.sql`("startedAt",id)<(${new Date(input.cursor.startedAt)},${input.cursor.id})` : Prisma.sql`true`} ORDER BY "startedAt" DESC,id DESC LIMIT 21`);
    const items = runs.slice(0, 20).map(metadata), last = items.at(-1);
    return { items, nextCursor: runs.length > 20 && last ? { id: last.id, startedAt: last.startedAt } : null, limitations: [limitations[2]!, limitations[3]!, "Version-one snapshot presence is a catalogue hint, not validation. Comparison validates complete frozen procedures. Catalogue pages are current deterministic metadata, not immutable pagination."] };
  });
  return manualRunCatalogOutputSchema.parse(value);
}

type NativeResult = { id: string; runId: string; caseId: string | null; status: "PASS" | "FAIL" | "BLOCKED" | "SKIP" | "FLAKY" };
type SavedRun = { id: string; projectId: string; ciProvider: string; executionContext: unknown; manualTestCaseIds: string[]; manualPrerequisites: Record<string, string[]> };
function frozenRun(run: SavedRun) {
  const snapshot = readRunExperienceSnapshot(run.executionContext);
  if (!snapshot) throw unavailable("A selected legacy run has no supported frozen procedure snapshot. Open its original record; no current case content was substituted.");
  const ids = new Set(run.manualTestCaseIds);
  if (ids.size !== run.manualTestCaseIds.length || ids.size > 1000 || snapshot.caseDefinitions.length !== ids.size || new Set(snapshot.caseDefinitions.map(c => c.testCaseId)).size !== ids.size || snapshot.caseDefinitions.some(c => !ids.has(c.testCaseId))) throw unavailable("A selected saved procedure scope is incomplete or ambiguous. No smaller population was substituted.");
  if (snapshot.caseDefinitions.some(c => !c.steps.length && !(c.given.length && c.when.length && c.then.length))) throw unavailable("A selected frozen procedure lacks a supported complete step or Given/When/Then shape. No missing instructions were invented.");
  const rawDefinitions = (run.executionContext as { caseDefinitions: Array<{ testCaseId: string }> }).caseDefinitions;
  return { snapshot, definitions: new Map(snapshot.caseDefinitions.map(c => [c.testCaseId, c])), hashes: new Map(rawDefinitions.map(c => [c.testCaseId, qualityProfileHash({ definition: c, prerequisites: run.manualPrerequisites[c.testCaseId] ?? [] })])) };
}
export function assembleManualRunComparison(input: ManualRunComparisonInput, actorId: string, runs: Array<{ metadata: StoredMetadata; saved: SavedRun }>, results: NativeResult[], caseLabels: Array<{ id: string; label: string | null }> = []) {
  const baseline = runs.find(run => run.saved.id === input.baselineRunId), candidate = runs.find(run => run.saved.id === input.candidateRunId);
  if (!baseline || !candidate || runs.length !== 2 || runs.some(run => run.saved.projectId !== input.projectId || run.saved.ciProvider !== "manual")) throw unavailable("Both exact selected manual runs must belong to the currently authorized project.");
  if (runs.some(run => run.metadata.id !== run.saved.id || run.metadata.plannedCases !== run.saved.manualTestCaseIds.length)) throw unavailable("Selected run metadata and saved planned scope disagree; no totals were guessed.");
  if (results.some(result => ![input.baselineRunId, input.candidateRunId].includes(result.runId) || !["PASS", "FAIL", "BLOCKED", "SKIP", "FLAKY"].includes(result.status))) throw unavailable("A result leaves this exact pair or has an unsupported outcome.");
  if (new Set(results.map(result => result.id)).size !== results.length || results.some(result => !supportedManualExecutionIdentity(result.id) || (result.caseId !== null && !supportedManualExecutionIdentity(result.caseId)))) throw unavailable("Compared result identities are unsupported or ambiguous. No result was substituted.");
  const a = frozenRun(baseline.saved), b = frozenRun(candidate.saved);
  function side(run: NonNullable<typeof baseline>, frozen: typeof a) {
    const selected = results.filter(result => result.runId === run.saved.id), statuses = new Map<string, NativeResult["status"]>();
    for (const result of selected) {
      if (!result.caseId || !frozen.definitions.has(result.caseId)) continue;
      if (statuses.has(result.caseId)) throw new TRPCError({ code: "CONFLICT", message: "A selected planned case has duplicate/conflicting results with no reliable chronology. No latest outcome was chosen." });
      statuses.set(result.caseId, result.status);
    }
    const progress = runProgress("manual", run.saved.manualTestCaseIds, selected.map(result => ({ testCaseId: result.caseId, status: result.status, count: 1 })));
    if (!progress) throw unavailable("Selected manual progress is unavailable; no outcome was invented.");
    const { other: _unsupported, ...summary } = progress;
    return { statuses, summary: { ...summary, ignoredOutsideScopeResults: selected.filter(result => !result.caseId || !frozen.definitions.has(result.caseId)).length } };
  }
  const left = side(baseline, a), right = side(candidate, b);
  const compareId = (x: { id: string }, y: { id: string }) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  const pairHash = qualityProfileHash({ projectId: input.projectId, organizationId: input.originalOrganizationId, clerkActorId: input.expectedClerkActorId, actorId, baseline: { saved: baseline.saved, metadata: metadata(baseline.metadata) }, candidate: { saved: candidate.saved, metadata: metadata(candidate.metadata) }, results: [...results].sort(compareId), caseLabels: [...caseLabels].sort(compareId) });
  if ((input.expectedPairHash && input.expectedPairHash !== pairHash) || (input.cursor && input.cursor.expectedPairHash !== pairHash)) throw new TRPCError({ code: "CONFLICT", message: "Selected saved definitions, run metadata or recorded outcome population changed. Restart this same pair explicitly; no new population was substituted." });
  const ids = [...new Set([...a.definitions.keys(), ...b.definitions.keys()])].sort();
  if (input.cursor && !ids.includes(input.cursor.caseId)) throw new TRPCError({ code: "CONFLICT", message: "The case cursor is not in this selected pair." });
  const offset = input.cursor ? ids.indexOf(input.cursor.caseId) + 1 : 0;
  function itemSide(id: string, frozen: typeof a, state: typeof left) {
    const definition = frozen.definitions.get(id); if (!definition) return null;
    const title = definition.title.slice(0, 1000).replace(/[\uD800-\uDBFF]$/u, "");
    return { title, titleClipped: title.length < definition.title.length, definitionHash: frozen.hashes.get(id)!, outcome: state.statuses.get(id) ?? "NO_CASE_VERDICT" as const };
  }
  const items = ids.slice(offset, offset + 50).map(caseId => {
    const baselineSide = itemSide(caseId, a, left), candidateSide = itemSide(caseId, b, right);
    return { caseId, currentCaseIdLabel: caseLabels.find(label => label.id === caseId)?.label ?? null, baseline: baselineSide, candidate: candidateSide, definitionState: !baselineSide ? "CANDIDATE_ONLY" as const : !candidateSide ? "BASELINE_ONLY" as const : baselineSide.definitionHash === candidateSide.definitionHash ? "SAME_SAVED_DEFINITION" as const : "SAVED_DEFINITION_CHANGED" as const };
  });
  const baselineHash = qualityProfileHash(a.snapshot.configuration), candidateHash = qualityProfileHash(b.snapshot.configuration);
  return { pairHash, baseline: metadata(baseline.metadata), candidate: metadata(candidate.metadata), baselineSummary: left.summary, candidateSummary: right.summary, configuration: { baselineHash, candidateHash, sameRecordedConfiguration: baselineHash === candidateHash }, unionCaseCount: ids.length, items, nextCursor: offset + items.length < ids.length ? { caseId: items.at(-1)!.caseId, expectedPairHash: pairHash } : null, limitations };
}

export async function compareManualRuns(db: PrismaClient, actorId: string, clerkActorId: string, raw: ManualRunComparisonInput) {
  const input = manualRunComparisonInputSchema.parse(raw);
  const value = await withAccess(db, actorId, clerkActorId, input, async tx => {
    const pairIds = [input.baselineRunId, input.candidateRunId].sort();
    for (const id of pairIds) await lockManualExecutionReadScope(tx, actorId, clerkActorId, { testRunId: id, projectId: input.projectId, originalOrganizationId: input.originalOrganizationId, expectedClerkActorId: input.expectedClerkActorId });
    const runMetadataRows = await tx.$queryRaw<StoredMetadata[]>(Prisma.sql`SELECT ${runSelect} FROM "TestRun" WHERE "projectId"=${input.projectId} AND "ciProvider"='manual' AND id IN (${Prisma.join(pairIds)}) ORDER BY id`);
    const [size] = await tx.$queryRaw<Array<{ bytes: bigint; count: bigint; invalidIdentity: boolean }>>(Prisma.sql`SELECT count(*) AS count,coalesce(sum(octet_length(concat(id,"testRunId","testCaseId",status::text))),0)::bigint AS bytes,coalesce(bool_or(length(id)>200 OR length("testCaseId")>200),false) AS "invalidIdentity" FROM "TestResult" WHERE "testRunId" IN (${Prisma.join(pairIds)})`);
    if (!size || size.count > 20000n || size.bytes > 2n * MiB || size.invalidIdentity) throw unavailable("Selected result identity population exceeds the bounded comparison. Nothing was truncated.");
    const saved = await tx.testRun.findMany({ where: { id: { in: pairIds }, projectId: input.projectId, ciProvider: "manual" }, select: { id: true, projectId: true, ciProvider: true, executionContext: true, manualTestCaseIds: true, manualPrerequisites: true } });
    if (saved.length !== 2 || runMetadataRows.length !== 2) throw unavailable("Both exact selected manual runs must remain available in this project.");
    const results = await tx.$queryRaw<NativeResult[]>(Prisma.sql`SELECT id,"testRunId" AS "runId","testCaseId" AS "caseId",status::text AS status FROM "TestResult" WHERE "testRunId" IN (${Prisma.join(pairIds)}) ORDER BY id LIMIT 20001`);
    if (BigInt(results.length) !== size.count) throw unavailable("The complete bounded result population was not available. No subset was substituted.");
    const caseIds = [...new Set(saved.flatMap(run => run.manualTestCaseIds))];
    const caseLabels = caseIds.length ? await tx.$queryRaw<Array<{ id: string; label: string | null }>>(Prisma.sql`SELECT id,CASE WHEN length("displayId")<=200 AND octet_length("displayId")<=800 THEN "displayId" ELSE NULL END AS label FROM "TestCase" WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join(caseIds)}) ORDER BY id LIMIT 2001`) : [];
    return assembleManualRunComparison(input, actorId, saved.map(run => ({ saved: run as SavedRun, metadata: runMetadataRows.find(meta => meta.id === run.id)! })), results, caseLabels);
  });
  const parsed = manualRunComparisonOutputSchema.parse(value);
  if (Buffer.byteLength(JSON.stringify(parsed), "utf8") > 16 * 1024 * 1024) throw unavailable("Comparison response exceeds 16 MiB. No content was truncated.");
  return parsed;
}
