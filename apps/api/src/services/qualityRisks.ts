import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient, type QualityRiskEntry } from "@vaettir/db";
import { qualityRiskDefinition, qualityRiskWriteInput, qualityRiskReceipt, qualityResidualDecision, qualityRiskEvidence,
  type QualityRiskDefinition, type QualityRiskWriteInput } from "./qualityRiskSchema.js";

type Tx = Prisma.TransactionClient;
export type RiskAccess = { organizationId: string; actorId: string; canWrite: boolean; caseKey: string };
export async function withQualityRiskAccess<T>(db: PrismaClient, projectId: string, actorId: string,
  organizationId: string, work: (tx: Tx, access: RiskAccess) => Promise<T>) {
  return db.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '8000ms'`);
    const org = await tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`
      SELECT "suspendedAt" FROM "Organization" WHERE id=${organizationId} FOR UPDATE`;
    const members = await tx.$queryRaw<Array<{ role: string; seatType: string }>>`
      SELECT role,"seatType" FROM "Membership" WHERE "organizationId"=${organizationId} AND "userId"=${actorId} FOR UPDATE`;
    const projects = await tx.$queryRaw<Array<{ organizationId: string; caseKey: string }>>`
      SELECT "organizationId","caseKey" FROM "Project" WHERE id=${projectId} FOR UPDATE`;
    if (!org[0] || org[0].suspendedAt || !members[0] || projects[0]?.organizationId !== organizationId)
      throw new TRPCError({ code: "FORBIDDEN", message: "Current project membership is required." });
    return work(tx, { organizationId, actorId, caseKey: projects[0].caseKey,
      canWrite: members[0].seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(members[0].role) });
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
}
const unavailable = () => new TRPCError({ code: "NOT_FOUND", message: "This risk record is unavailable." });
// Reads use the same current authorization locks as writes. A project moved to
// another organization must not expose its original register or linked choices.
export function withQualityRiskReadAccess<T>(db: PrismaClient, projectId: string, actorId: string,
  organizationId: string, originalOrganizationId: string | undefined, work: (tx: Tx, access: RiskAccess) => Promise<T>) {
  return withQualityRiskAccess(db, projectId, actorId, organizationId, async (tx, access) => {
    const state = await tx.projectQualityRiskState.findUnique({ where: { projectId }, select: { organizationId: true } });
    if ((state && state.organizationId !== organizationId) || (originalOrganizationId && originalOrganizationId !== organizationId)) throw unavailable();
    return work(tx, access);
  });
}
function parseDefinition(body: unknown) {
  try { return qualityRiskDefinition.parse(body); }
  catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This risk definition is unsupported. No fields have been silently removed." }); }
}
async function entryInScope(tx: Tx, access: RiskAccess, projectId: string, id: string) {
  const entry = await tx.qualityRiskEntry.findFirst({ where: { id, projectId, state: { organizationId: access.organizationId } } });
  if (!entry) throw unavailable();
  return entry;
}
async function links(tx: Tx, projectId: string, definition: QualityRiskDefinition) {
  const cases = definition.caseIds.length ? await tx.$queryRaw<Array<{ id: string; label: string; title: string; archived: boolean }>>(
    Prisma.sql`SELECT id,"displayId" AS label,left(title,160) AS title,archived FROM "TestCase" WHERE "projectId"=${projectId} AND id IN (${Prisma.join(definition.caseIds)})`) : [];
  const requirements = definition.requirementIds.length ? await tx.$queryRaw<Array<{ id: string; label: string }>>(
    Prisma.sql`SELECT id,left(title,160) AS label FROM "Requirement" WHERE "projectId"=${projectId} AND id IN (${Prisma.join(definition.requirementIds)})`) : [];
  const missing = definition.caseIds.length + definition.requirementIds.length - cases.length - requirements.length;
  return { cases, requirements, missing };
}
async function checkedDefinition(tx: Tx, projectId: string, definition: QualityRiskDefinition) {
  // Keep the authorized linked rows stable through definition + receipt commit.
  // A reparent/delete racing this approval must wait or fail serialization.
  if (definition.caseIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "TestCase"
    WHERE "projectId"=${projectId} AND id IN (${Prisma.join(definition.caseIds)}) ORDER BY id FOR SHARE`);
  if (definition.requirementIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "Requirement"
    WHERE "projectId"=${projectId} AND id IN (${Prisma.join(definition.requirementIds)}) ORDER BY id FOR SHARE`);
  const resolved = await links(tx, projectId, definition);
  if (resolved.missing) throw new TRPCError({ code: "BAD_REQUEST", message: "Every mitigation link must be a current record in this project." });
  return definition;
}
export async function qualityRiskList(tx: Tx, access: RiskAccess, projectId: string, offset: number) {
  const entries = await tx.qualityRiskEntry.findMany({ where: { projectId, state: { organizationId: access.organizationId } },
    orderBy: { number: "asc" }, skip: offset, take: 51,
    select: { id: true, displayId: true, title: true, definition: true, version: true, updatedAt: true,
      decisions: { orderBy: { createdVersion: "desc" }, take: 1,
        select: { id: true, createdVersion: true, createdAt: true, decision: true } } } });
  return { projectId, organizationId: access.organizationId, offset, canWrite: access.canWrite, hasMore: entries.length > 50,
    items: entries.slice(0, 50).map(entry => {
      const definition = parseDefinition(entry.definition), latest = entry.decisions[0];
      const residual = latest ? qualityResidualDecision.parse(latest.decision) : null;
      return { id: entry.id, displayId: entry.displayId, title: entry.title, version: entry.version, updatedAt: entry.updatedAt,
        component: definition.component, likelihood: definition.likelihood, consequence: definition.consequence,
        residual: residual ? { likelihood: residual.likelihood, consequence: residual.consequence, disposition: residual.disposition,
          recordedAt: latest!.createdAt, currentEntryBaseline: latest!.createdVersion === entry.version } : null,
        reviewState: !latest ? "NOT_REVIEWED" : latest.createdVersion === entry.version ? "HUMAN_REVIEW_RECORDED" : "REVIEW_BASELINE_CHANGED" };
    }),
    disclaimer: "Risk records and human reviews are not release RiskFlags, AI case scores, verified mitigations or qualified regulatory approvals." };
}
export async function qualityRiskDetail(tx: Tx, access: RiskAccess, projectId: string, id: string, historyOffset: number) {
  const entry = await entryInScope(tx, access, projectId, id), definition = parseDefinition(entry.definition);
  const resolved = await links(tx, projectId, definition);
  const decisions = await tx.qualityRiskDecision.findMany({ where: { entryId: entry.id },
    orderBy: { createdVersion: "desc" }, skip: historyOffset, take: 11 });
  const shown = decisions.slice(0, 10).map(d => ({ ...d, evidence: qualityRiskEvidence.parse(d.evidence),
    decision: qualityResidualDecision.parse(d.decision) }));
  const resultIds = [...new Set(shown.flatMap(d => d.evidence.map(e => e.resultId)))];
  const available = resultIds.length ? await tx.testResult.findMany({ where: { id: { in: resultIds }, testRun: { projectId } },
    select: { id: true, testCaseId: true, testRunId: true, testCase: { select: { projectId: true } } } }) : [];
  const currentResults = new Map(available.filter(r => r.testCase?.projectId === projectId).map(r => [r.id, r]));
  const isAvailable = (e: { resultId: string; caseId: string; runId: string }) => {
    const current = currentResults.get(e.resultId);
    return !!current && current.testCaseId === e.caseId && current.testRunId === e.runId;
  };
  return { projectId, organizationId: access.organizationId, canWrite: access.canWrite, entry: { id: entry.id, displayId: entry.displayId,
    version: entry.version, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
    definition: { ...definition, caseIds: resolved.cases.map(c => c.id), requirementIds: resolved.requirements.map(r => r.id) },
    links: resolved, missingLinks: resolved.missing }, historyOffset, hasMoreHistory: decisions.length > 10,
    decisions: shown.map(d => ({ id: d.id, assessedVersion: d.assessedVersion, createdVersion: d.createdVersion,
      createdAt: d.createdAt, createdById: d.createdById, currentBaseline: d.createdVersion === entry.version,
      decision: { ...d.decision, resultIds: d.evidence.filter(isAvailable).map(e => e.resultId) },
      assessedDefinition: (({ requirementIds: _requirements, caseIds: _cases, ...fields }) => fields)(parseDefinition(d.baseline)),
      evidence: d.evidence.map(e => isAvailable(e) ? { ...e, available: true } : {
        resultId: null, caseId: null, caseDisplayId: e.caseDisplayId, runId: null, status: e.status, observedAt: e.observedAt, runStartedAt: e.runStartedAt, available: false }),
      verification: "Status observed at review time. Later result, procedure or requirement changes are not automatically reverified or invalidated. Not current readiness or qualified approval." })),
    warnings: ["No numerical risk score, standard-specific acceptability threshold or regulatory sign-off is asserted.",
      "A requirement or case link describes intended mitigation; it does not prove execution or effectiveness.",
      resolved.missing ? `${resolved.missing} original links are unavailable; their native IDs are withheld.` : "All mitigation references currently resolve in this project.",
      "Any entry edit makes older residual decisions historical. Review again against the changed baseline."] };
}
async function captureResults(tx: Tx, projectId: string, definition: QualityRiskDefinition, resultIds: string[]) {
  if (!resultIds.length) return [];
  if (!definition.caseIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Link a mitigation case before attaching its execution evidence." });
  await checkedDefinition(tx, projectId, definition);
  // Lock every evidence owner and result through the immutable decision commit.
  await tx.$queryRaw(Prisma.sql`SELECT r.id FROM "TestResult" r
    JOIN "TestRun" t ON t.id=r."testRunId" JOIN "TestCase" c ON c.id=r."testCaseId"
    WHERE t."projectId"=${projectId} AND c."projectId"=${projectId}
    AND c.id IN (${Prisma.join(definition.caseIds)}) AND r.id IN (${Prisma.join(resultIds)})
    ORDER BY r.id FOR SHARE OF r,t,c`);
  const results = await tx.testResult.findMany({ where: { id: { in: resultIds },
    testRun: { projectId }, testCase: { projectId, id: { in: definition.caseIds } } },
    select: { id: true, status: true, testCaseId: true, testRunId: true,
      testRun: { select: { startedAt: true } }, testCase: { select: { displayId: true } } } });
  if (results.length !== resultIds.length)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Each evidence result must belong to a linked mitigation case and a run in this project. Unmatched or foreign results cannot substitute." });
  return results.map(r => ({ resultId: r.id, caseId: r.testCaseId!, runId: r.testRunId,
    caseDisplayId: r.testCase!.displayId, status: r.status, observedAt: new Date().toISOString(),
    runStartedAt: r.testRun.startedAt.toISOString() }));
}
export async function writeQualityRisk(tx: Tx, access: RiskAccess, raw: QualityRiskWriteInput) {
  const input = qualityRiskWriteInput.parse(raw);
  // Client readiness cannot prevent an asynchronous authentication-token switch.
  // Bind expected scope to the authenticated server actor under the existing
  // current tenant/membership/project transaction before receipt replay too.
  if (input.expectedScope) {
    const actor = await tx.user.findUnique({ where: { id: access.actorId }, select: { clerkUserId: true } });
    if (input.expectedScope.organizationId !== access.organizationId || !actor || input.expectedScope.clerkActorId !== actor.clerkUserId)
      throw new TRPCError({ code: "FORBIDDEN", message: "The originally reviewed risk actor or organization no longer matches current access. Restore that same scope before retrying; the exact request must not be rebound." });
  }
  if (!access.canWrite) throw new TRPCError({ code: "FORBIDDEN", message: "A current full editor seat is required for risk records and human decisions." });
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const prior = await tx.qualityRiskWrite.findUnique({ where: { projectId_actorId_requestId: {
    projectId: input.projectId, actorId: access.actorId, requestId: input.requestId } }, include: { state: true } });
  if (prior) {
    if (prior.state.organizationId !== access.organizationId) throw unavailable();
    if (prior.requestHash !== hash) throw new TRPCError({ code: "CONFLICT", message: "Retry the original risk-change payload for this request." });
    return qualityRiskReceipt.parse(prior.receipt);
  }
  const state = await tx.projectQualityRiskState.upsert({ where: { projectId: input.projectId },
    create: { projectId: input.projectId, organizationId: access.organizationId }, update: {} });
  if (state.organizationId !== access.organizationId) throw unavailable();
  if (await tx.qualityRiskWrite.count({ where: { projectId: input.projectId } }) >= 10000)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The bounded register write history is full. Existing exact retries remain available." });
  let entry: QualityRiskEntry, decisionId: string | null = null;
  if (input.operation === "CREATE") {
    if (state.nextNumber >= 1000) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This bounded project register supports up to 1,000 risk entries." });
    const definition = await checkedDefinition(tx, input.projectId, input.definition);
    const counter = await tx.projectQualityRiskState.update({ where: { projectId: input.projectId }, data: { nextNumber: { increment: 1 } } });
    const displayId = `${access.caseKey || "RISK"}-R${String(counter.nextNumber).padStart(4, "0")}`;
    entry = await tx.qualityRiskEntry.create({ data: { projectId: input.projectId, number: counter.nextNumber,
      displayId, title: definition.title, definition: definition as Prisma.InputJsonValue,
      createdById: access.actorId, updatedById: access.actorId } });
  } else {
    entry = await entryInScope(tx, access, input.projectId, input.id);
    if (entry.version !== input.expectedVersion) throw new TRPCError({ code: "CONFLICT", message: "The risk baseline changed. Load its current version before a new edit or review." });
    const baseline = parseDefinition(entry.definition);
    if (input.operation === "UPDATE") {
      const originalLinks = await links(tx, input.projectId, baseline);
      if (originalLinks.missing && !input.dropUnavailableLinks)
        throw new TRPCError({ code: "CONFLICT", message: "Original mitigation links are unavailable. Explicitly review their removal before replacing this definition." });
      const definition = await checkedDefinition(tx, input.projectId, input.definition);
      entry = await tx.qualityRiskEntry.update({ where: { id: entry.id }, data: { version: { increment: 1 },
        title: definition.title, definition: definition as Prisma.InputJsonValue, updatedById: access.actorId } });
    } else {
      if (await tx.qualityRiskDecision.count({ where: { entryId: entry.id } }) >= 100)
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This risk supports up to 100 retained human decisions." });
      const originalLinks = await links(tx, input.projectId, baseline);
      if (originalLinks.missing) throw new TRPCError({ code: "CONFLICT", message: "Review and explicitly remove unavailable mitigation references before recording a residual decision." });
      await checkedDefinition(tx, input.projectId, baseline);
      const evidence = await captureResults(tx, input.projectId, baseline, input.decision.resultIds);
      // Assessment is immutable; evidence references retain recorded statuses.
      // Missing execution, unknown likelihood or failed results never block a
      // truthful human decision, but are explicitly not verification evidence.
      const decision = await tx.qualityRiskDecision.create({ data: { entryId: entry.id,
        assessedVersion: entry.version, createdVersion: entry.version + 1, createdById: access.actorId,
        decision: input.decision as Prisma.InputJsonValue, baseline: baseline as Prisma.InputJsonValue,
        evidence: evidence as Prisma.InputJsonValue } });
      decisionId = decision.id;
      entry = await tx.qualityRiskEntry.update({ where: { id: entry.id }, data: { version: { increment: 1 }, updatedById: access.actorId } });
    }
  }
  const receipt = qualityRiskReceipt.parse({ requestId: input.requestId, operation: input.operation,
    entry: { id: entry.id, displayId: entry.displayId, version: entry.version }, decisionId });
  await tx.qualityRiskWrite.create({ data: { projectId: input.projectId, actorId: access.actorId,
    requestId: input.requestId, requestHash: hash, receipt: receipt as Prisma.InputJsonValue } });
  return receipt;
}
export async function lookupQualityRiskLinks(tx: Tx, projectId: string, kind: "CASE" | "REQUIREMENT" | "RESULT", search: string) {
  const term = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  if (kind === "CASE") {
    const items = await tx.$queryRaw<Array<{ id: string; label: string }>>`
      SELECT id, left("displayId" || ' · ' || title,220) AS label FROM "TestCase" WHERE "projectId"=${projectId}
      AND (title ILIKE ${term} OR "displayId" ILIKE ${term}) ORDER BY "caseNumber",id LIMIT 20`;
    return { projectId, kind, search, items };
  }
  if (kind === "REQUIREMENT") {
    const items = await tx.$queryRaw<Array<{ id: string; label: string }>>`
      SELECT id,left(title,220) AS label FROM "Requirement" WHERE "projectId"=${projectId} AND title ILIKE ${term} ORDER BY title,id LIMIT 20`;
    return { projectId, kind, search, items };
  }
  const items = await tx.$queryRaw<Array<{ id: string; label: string }>>`
    SELECT r.id,left(c."displayId" || ' · ' || r.status::text || ' · run started ' || to_char(t."startedAt",'YYYY-MM-DD HH24:MI') || ' UTC',220) AS label
    FROM "TestResult" r JOIN "TestRun" t ON t.id=r."testRunId" JOIN "TestCase" c ON c.id=r."testCaseId"
    WHERE t."projectId"=${projectId} AND c."projectId"=${projectId}
    AND (c."displayId" ILIKE ${term} OR c.title ILIKE ${term} OR r.id=${search})
    ORDER BY t."startedAt" DESC,r.id LIMIT 20`;
  return { projectId, kind, search, items };
}
