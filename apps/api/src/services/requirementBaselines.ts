import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { traceabilityHref } from "../routers/caseTraceability.js";
import { withQualityRiskAccess, type RiskAccess } from "./qualityRisks.js";
import { requirementBaselineSnapshot, requirementBaselineReceipt, requirementBaselineCaptureInput,
  requirementBaselineAcknowledgementKey, type RequirementBaselineSnapshot, type RequirementBaselineCapture } from "./requirementBaselineSchema.js";
type Tx = Prisma.TransactionClient;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const unavailable = () => new TRPCError({ code: "NOT_FOUND", message: "This requirement baseline is unavailable in the current project." });
const tooLarge = () => new TRPCError({ code: "PRECONDITION_FAILED", message: "This requirement or its direct link population exceeds the bounded baseline capture. No text or links have been silently omitted." });
const limits = ["Direct native requirement links only. Acceptance-criteria plans are not inferred as direct test coverage.",
  "Links and unchanged wording do not prove execution, requirement fulfilment, verified coverage or qualified approval.",
  "Case labels are explicitly bounded excerpts, not full procedure revisions. Case procedure, result, external issue status and acceptance-criterion changes are not reverified.",
  "Unsafe external metadata is withheld; no provider/source fetching, media or share tokens are captured.",
  "Up to 100 immutable captures per native requirement and 10,000 per project. Prior exact retries remain available when history is full."];
export function withRequirementBaselineAccess<T>(db: PrismaClient, projectId: string, actorId: string, organizationId: string,
  work: (tx: Tx, access: RiskAccess) => Promise<T>, scope?: { expectedScope?: RequirementBaselineCapture["expectedScope"]; verifiedClerkActorId?: string }) {
  return withQualityRiskAccess(db, projectId, actorId, organizationId, async (tx, access) => {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { clerkUserId: true } });
    if (!actor?.clerkUserId || actor.clerkUserId.length > 200 || (scope?.verifiedClerkActorId !== undefined && actor.clerkUserId !== scope.verifiedClerkActorId) ||
      (scope?.expectedScope && (scope.expectedScope.organizationId !== organizationId || scope.expectedScope.clerkActorId !== actor.clerkUserId)))
      throw new TRPCError({ code: "FORBIDDEN", message: "Original organization and current signed-in actor are required. Retained baselines, rationale and requests were not replaced." });
    const state = await tx.projectRequirementBaselineState.findUnique({ where: { projectId } });
    const traceability = await tx.caseTraceabilityState.findUnique({ where: { projectId }, select: { organizationId: true } });
    if (state && state.organizationId !== organizationId) throw unavailable();
    if (traceability && traceability.organizationId !== organizationId) throw unavailable();
    const value = await work(tx, access);
    return { ...value, projectId, organizationId, clerkActorId: actor.clerkUserId };
  });
}
function parseSnapshot(value: unknown) {
  try { return requirementBaselineSnapshot.parse(value); }
  catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This retained baseline has unavailable fields. No partial comparison or replacement capture was substituted." }); }
}
function safeRef(value: string | null): { value: string | null; withheld: boolean } {
  if (!value) return { value: null, withheld: false };
  if (/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/.test(value)) return { value, withheld: false };
  try { return { value: traceabilityHref(value), withheld: false }; }
  catch { return { value: null, withheld: true }; }
}
async function currentSnapshot(tx: Tx, projectId: string, requirementId: string, lock: boolean) {
  if (lock) {
    await tx.$queryRaw`SELECT id FROM "Requirement" WHERE id=${requirementId} AND "projectId"=${projectId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "CaseTraceabilityLink" WHERE "projectId"=${projectId} AND "requirementId"=${requirementId}
      AND "removedAt" IS NULL AND provider='requirement' AND kind='requirement'
      ORDER BY id LIMIT 41 FOR SHARE`;
  }
  // Check size before materializing legacy unbounded text fields. No truncation.
  const rows = await tx.$queryRaw<Array<{ id: string; title: string | null; description: string | null;
    externalRef: string | null; linearIssueId: string | null; jiraIssueKey: string | null; tooLarge: boolean }>>`
    SELECT id,CASE WHEN length(title)<=300 AND octet_length(title)<=1200 THEN title END AS title,
    CASE WHEN length(COALESCE(description,''))<=10000 AND octet_length(COALESCE(description,''))<=24000 THEN description END AS description,
    CASE WHEN octet_length(COALESCE("externalRef",''))<=1500 THEN "externalRef" END AS "externalRef",
    CASE WHEN length(COALESCE("linearIssueId",''))<=120 THEN "linearIssueId" END AS "linearIssueId",
    CASE WHEN length(COALESCE("jiraIssueKey",''))<=120 THEN "jiraIssueKey" END AS "jiraIssueKey",
    (length(title)>300 OR octet_length(title)>1200 OR length(COALESCE(description,''))>10000
      OR octet_length(COALESCE(description,''))>24000 OR octet_length(COALESCE("externalRef",''))>1500
      OR length(COALESCE("linearIssueId",''))>120 OR length(COALESCE("jiraIssueKey",''))>120) AS "tooLarge"
    FROM "Requirement" WHERE id=${requirementId} AND "projectId"=${projectId}`;
  const row = rows[0]; if (!row) return null; if (row.tooLarge || !row.title) throw tooLarge();
  // Metadata-only completeness check MUST precede label materialization. An
  // inner join alone could silently discard an unavailable/foreign native case.
  // Count all active direct links (including malformed links), never just joins.
  const directMetadata = await tx.$queryRaw<Array<{ invalid: boolean }>>`
    SELECT (c.id IS NULL OR l."providerOrigin" IS DISTINCT FROM 'vaettir'
      OR l."nativeId" IS DISTINCT FROM ${requirementId}) AS invalid
    FROM "CaseTraceabilityLink" l LEFT JOIN "TestCase" c
      ON c.id=l."caseId" AND c."projectId"=l."projectId"
    WHERE l."projectId"=${projectId} AND l."requirementId"=${requirementId} AND l."removedAt" IS NULL
      AND l.provider='requirement' AND l.kind='requirement'
    ORDER BY l.id LIMIT 41`;
  if (directMetadata.length > 40) throw tooLarge();
  if (directMetadata.some(link => link.invalid))
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Current direct requirement links contain unavailable or incompatible native associations. No links were silently omitted, no partial comparison was substituted and no replacement baseline was captured." });
  const linked = await tx.$queryRaw<Array<{ id: string; caseId: string; displayId: string; title: string; titleIsExcerpt: boolean; archived: boolean }>>`
    SELECT l.id,l."caseId",c."displayId",left(c.title,60) AS title,(length(c.title)>60) AS "titleIsExcerpt",c.archived
    FROM "CaseTraceabilityLink" l JOIN "TestCase" c ON c.id=l."caseId" AND c."projectId"=l."projectId"
    WHERE l."projectId"=${projectId} AND l."requirementId"=${requirementId} AND l."removedAt" IS NULL
      AND l.provider='requirement' AND l.kind='requirement'
    ORDER BY l.id LIMIT 41`;
  if (linked.length > 40) throw tooLarge();
  if (lock && linked.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "TestCase"
    WHERE "projectId"=${projectId} AND id IN (${Prisma.join(linked.map(l => l.caseId))}) ORDER BY id FOR SHARE`);
  const external = safeRef(row.externalRef), linear = safeRef(row.linearIssueId), jira = safeRef(row.jiraIssueKey);
  const snapshot = parseSnapshot({ version: 1, requirement: { title: row.title, description: row.description,
    externalRef: external.value, externalRefWithheld: external.withheld, linearIssueId: linear.value, jiraIssueKey: jira.value,
    issueIdentifiersWithheld: linear.withheld || jira.withheld }, links: linked });
  // Unsafe metadata never enters the retained snapshot/response. Its digest
  // still detects reference changes without exposing credential/query text.
  return { id: row.id, snapshot, fingerprint: hash({ snapshot,
    referenceDigest: hash([row.externalRef, row.linearIssueId, row.jiraIssueKey]) }) };
}
function compare(current: Awaited<ReturnType<typeof currentSnapshot>>, baseline: { snapshot: unknown; fingerprint: string } | null) {
  const old = baseline ? parseSnapshot(baseline.snapshot) : null;
  const fields = old && current ? Object.keys(old.requirement).filter(key =>
    old.requirement[key as keyof typeof old.requirement] !== current.snapshot.requirement[key as keyof typeof old.requirement]) : [];
  const coverageChanged = !!old && !!current && hash(old.links) !== hash(current.snapshot.links);
  const metadataChanged = !!baseline && !!current && baseline.fingerprint !== current.fingerprint;
  const status = !current ? "REQUIREMENT_UNAVAILABLE" : !baseline ? "NO_BASELINE" : metadataChanged ? "CHANGED_REVIEW_REQUIRED" : "UNCHANGED_RECORDED_SCOPE";
  return { old, fields, coverageChanged, status, metadataChanged,
    withheldMetadataChanged: metadataChanged && !fields.length && !coverageChanged };
}
export async function requirementBaselineList(tx: Tx, access: RiskAccess, projectId: string, offset: number, search: string) {
  const term = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const identities = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT candidate.id FROM (SELECT id FROM "Requirement" WHERE "projectId"=${projectId}
      UNION SELECT b."requirementId" AS id FROM "RequirementBaseline" b JOIN "ProjectRequirementBaselineState" s ON s."projectId"=b."projectId"
        WHERE b."projectId"=${projectId} AND s."organizationId"=${access.organizationId}) candidate
    WHERE EXISTS(SELECT 1 FROM "Requirement" r WHERE r.id=candidate.id AND r."projectId"=${projectId} AND r.title ILIKE ${term})
      OR EXISTS(SELECT 1 FROM "RequirementBaseline" b WHERE b."projectId"=${projectId} AND b."requirementId"=candidate.id
        AND b.snapshot#>>'{requirement,title}' ILIKE ${term})
    ORDER BY candidate.id LIMIT 21 OFFSET ${offset}`;
  let bytes = 0;
  const items = [];
  for (const identity of identities.slice(0, 20)) {
    const latest = await tx.requirementBaseline.findFirst({ where: { projectId, requirementId: identity.id }, orderBy: { version: "desc" } });
    const current = await currentSnapshot(tx, projectId, identity.id, false);
    bytes += Buffer.byteLength(JSON.stringify([latest?.snapshot ?? null, current?.snapshot ?? null]));
    if (bytes > 2200000) throw tooLarge();
    const delta = compare(current, latest);
    const title = current?.snapshot.requirement.title ?? delta.old?.requirement.title ?? "Unavailable requirement";
    items.push({ requirementId: current?.id ?? null, baselineId: latest?.id ?? null, title,
      baselineDisplayId: latest?.displayId ?? null, baselineVersion: latest?.version ?? 0,
      status: delta.status, wordingChanged: !!delta.fields.length || delta.withheldMetadataChanged,
      coverageChanged: delta.coverageChanged, currentDirectCases: current ? new Set(current.snapshot.links.map(l => l.caseId)).size : null,
      capturedDirectCases: delta.old ? new Set(delta.old.links.map(l => l.caseId)).size : null });
  }
  return { projectId, offset, search, canWrite: access.canWrite, hasMore: identities.length > 20, items, limits };
}
export async function requirementBaselineDetail(tx: Tx, access: RiskAccess, input: {
  projectId: string; requirementId?: string; baselineId?: string; historyOffset: number; affectedOffset: number }) {
  const selected = input.baselineId ? await tx.requirementBaseline.findFirst({ where: { id: input.baselineId,
    projectId: input.projectId, state: { organizationId: access.organizationId } } }) : null;
  if (input.baselineId && !selected) throw unavailable();
  const requirementId = input.requirementId ?? selected!.requirementId;
  if (selected && selected.requirementId !== requirementId) throw unavailable();
  const latest = await tx.requirementBaseline.findFirst({ where: { projectId: input.projectId, requirementId }, orderBy: { version: "desc" } });
  const state = await tx.projectRequirementBaselineState.findUnique({ where: { projectId: input.projectId }, select: { nextNumber: true } });
  const current = await currentSnapshot(tx, input.projectId, requirementId, false);
  if (!current && !latest) throw unavailable();
  const baseline = selected ?? latest, delta = compare(current, baseline);
  const history = await tx.requirementBaseline.findMany({ where: { projectId: input.projectId, requirementId },
    orderBy: { version: "desc" }, skip: input.historyOffset, take: 11,
    select: { id: true, displayId: true, version: true, createdAt: true, rationale: true } });
  const union = new Map((delta.old?.links ?? []).map(l => [l.caseId, { ...l, wasLinked: true, isLinked: false }]));
  const oldCaseIds = new Set(delta.old?.links.map(l => l.caseId) ?? []);
  for (const link of current?.snapshot.links ?? []) union.set(link.caseId, { ...link, wasLinked: oldCaseIds.has(link.caseId), isLinked: true });
  const candidates = [...union.values()].sort((a, b) => a.displayId.localeCompare(b.displayId) || a.caseId.localeCompare(b.caseId));
  const slice = candidates.slice(input.affectedOffset, input.affectedOffset + 20);
  const available = slice.length ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "TestCase"
    WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join(slice.map(c => c.caseId))})`) : [];
  const live = new Set(available.map(c => c.id));
  // Snapshot bodies cannot carry live foreign/missing native IDs to the UI.
  const safeText = (snapshot: RequirementBaselineSnapshot | null) => snapshot ? snapshot.requirement : null;
  return { projectId: input.projectId, requested: { requirementId: input.requirementId ?? null, baselineId: input.baselineId ?? null,
    historyOffset: input.historyOffset, affectedOffset: input.affectedOffset }, canWrite: access.canWrite && !!current,
    requirementId: current?.id ?? null, current: safeText(current?.snapshot ?? null), currentFingerprint: current?.fingerprint ?? null,
    captureAvailable: !!current && (latest?.version ?? 0) < 100 && (state?.nextNumber ?? 0) < 10000,
    captureUnavailableReason: !current ? "Native requirement unavailable; retained baselines cannot recreate it."
      : (latest?.version ?? 0) >= 100 ? "This requirement's 100-capture retained history is full."
        : (state?.nextNumber ?? 0) >= 10000 ? "This project's 10,000-capture retained history is full." : null,
    latestVersion: latest?.version ?? 0, selectedIsLatest: !baseline || baseline.id === latest?.id,
    latestBaselineId: latest?.id ?? null,
    currentDirectCases: current ? new Set(current.snapshot.links.map(l => l.caseId)).size : null,
    capturedDirectCases: delta.old ? new Set(delta.old.links.map(l => l.caseId)).size : null,
    baseline: baseline ? { id: baseline.id, displayId: baseline.displayId, version: baseline.version,
      createdAt: baseline.createdAt, rationale: baseline.rationale, requirement: safeText(delta.old) } : null,
    comparison: { status: delta.status, changedFields: delta.fields, coverageChanged: delta.coverageChanged,
      withheldMetadataChanged: delta.withheldMetadataChanged },
    affected: { total: candidates.length, offset: input.affectedOffset, hasMore: candidates.length > input.affectedOffset + 20,
      items: slice.map(c => ({ caseId: live.has(c.caseId) ? c.caseId : null, displayId: c.displayId, title: c.title,
        titleIsExcerpt: c.titleIsExcerpt, archived: c.archived, wasLinked: c.wasLinked, isLinked: c.isLinked, available: live.has(c.caseId) })) },
    history: history.slice(0, 10), hasMoreHistory: history.length > 10, limits };
}
export async function captureRequirementBaseline(tx: Tx, access: RiskAccess, raw: RequirementBaselineCapture) {
  const input = requirementBaselineCaptureInput.parse(raw);
  if (input.expectedScope) {
    const actor = await tx.user.findUnique({ where: { id: access.actorId }, select: { clerkUserId: true } });
    if (!actor || input.expectedScope.organizationId !== access.organizationId || input.expectedScope.clerkActorId !== actor.clerkUserId)
      throw new TRPCError({ code: "FORBIDDEN", message: "This exact reviewed capture belongs to a different original organization or actor." });
  }
  if (!access.canWrite) throw new TRPCError({ code: "FORBIDDEN", message: "A current full editor seat is required to capture a reviewed baseline." });
  const requestHash = hash(input);
  const prior = await tx.requirementBaselineWrite.findUnique({ where: { projectId_actorId_requestId: {
    projectId: input.projectId, actorId: access.actorId, requestId: input.requestId } }, include: { state: true } });
  if (prior) {
    if (prior.state.organizationId !== access.organizationId) throw unavailable();
    if (prior.requestHash !== requestHash) throw new TRPCError({ code: "CONFLICT", message: "Retry this baseline capture with its original reviewed payload." });
    const receipt = requirementBaselineReceipt.parse(prior.receipt);
    const captured = await tx.requirementBaseline.findFirst({ where: { id: receipt.baselineId, projectId: input.projectId,
      state: { organizationId: access.organizationId } }, select: { requirementId: true, fingerprint: true, createdById: true, version: true, displayId: true } });
    if (!captured || captured.createdById !== access.actorId || captured.requirementId !== input.requirementId ||
      captured.fingerprint !== input.currentFingerprint || captured.version !== input.expectedLatestVersion + 1 ||
      receipt.version !== captured.version || receipt.displayId !== captured.displayId || receipt.requestId !== input.requestId)
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Retained acknowledgement does not match its exact captured actor, requirement and direct-case fingerprint. No replacement capture was made." });
    return { ...receipt, requirementId: captured.requirementId, capturedFingerprint: captured.fingerprint, acknowledgementKey: requirementBaselineAcknowledgementKey(input) };
  }
  const state = await tx.projectRequirementBaselineState.upsert({ where: { projectId: input.projectId },
    create: { projectId: input.projectId, organizationId: access.organizationId }, update: {} });
  if (state.organizationId !== access.organizationId) throw unavailable();
  if (state.nextNumber >= 10000) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The bounded project baseline history is full; retained exact retries remain available." });
  const latest = await tx.requirementBaseline.findFirst({ where: { projectId: input.projectId, requirementId: input.requirementId }, orderBy: { version: "desc" } });
  if ((latest?.version ?? 0) !== input.expectedLatestVersion || (latest?.version ?? 0) >= 100)
    throw new TRPCError({ code: "CONFLICT", message: "The latest baseline changed or its bounded history is full. Refresh and review before a new capture." });
  const current = await currentSnapshot(tx, input.projectId, input.requirementId, true);
  if (!current) throw unavailable();
  if (current.fingerprint !== input.currentFingerprint) throw new TRPCError({ code: "CONFLICT", message: "Requirement wording or direct links changed after the preview. Refresh and review them; no replacement baseline was captured." });
  const counter = await tx.projectRequirementBaselineState.update({ where: { projectId: input.projectId }, data: { nextNumber: { increment: 1 } } });
  const baseline = await tx.requirementBaseline.create({ data: { projectId: input.projectId, requirementId: input.requirementId,
    number: counter.nextNumber, displayId: `${access.caseKey || "REQ"}-B${String(counter.nextNumber).padStart(5, "0")}`,
    version: (latest?.version ?? 0) + 1, snapshot: current.snapshot as Prisma.InputJsonValue, fingerprint: current.fingerprint,
    rationale: input.rationale, createdById: access.actorId } });
  const receipt = requirementBaselineReceipt.parse({ requestId: input.requestId, baselineId: baseline.id, displayId: baseline.displayId, version: baseline.version });
  await tx.requirementBaselineWrite.create({ data: { projectId: input.projectId, actorId: access.actorId,
    requestId: input.requestId, requestHash, receipt: receipt as Prisma.InputJsonValue } });
  return { ...receipt, requirementId: baseline.requirementId, capturedFingerprint: baseline.fingerprint, acknowledgementKey: requirementBaselineAcknowledgementKey(input) };
}
