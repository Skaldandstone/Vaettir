import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { z } from "zod";
import { captureAiUsage, smartCaseSchema, suggestCaseOrganization, suggestImportColumns, type SmartCase, type SmartCaseSuggestion } from "@vaettir/ai-agent";
import { lockCaseFieldProject } from "./caseFields.js";
import { lockCurrentCaseFieldActor } from "./caseFieldReadScope.js";
import { readFolders } from "./caseFolders.js";
import { folderAncestors, folderPathSchema } from "./caseFolderSchema.js";
import { testCaseContentRevision } from "./testCaseContentRevision.js";
import { snapshotTestCaseVersion } from "./testCaseVersion.js";
import { splitCsvRows } from "./csvFieldMapping.js";

export const suggestionScopeSchema = z.object({ projectId: z.string().min(1).max(200), originalOrganizationId: z.string().min(1).max(200), expectedClerkActorId: z.string().min(1).max(200) });
type Scope = z.infer<typeof suggestionScopeSchema>;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const refuse = (message: string): never => { throw new TRPCError({ code: "CONFLICT", message }); };
const caseInclude = { steps: { orderBy: { order: "asc" as const } }, sharedStepGroup: true, source: { select: { filePath: true } } };
type Preview = { scope: string; expires: number; treeHash: string; suggestions: SmartCaseSuggestion[]; cases: Array<{ id: string; revision: string; updatedAt: number; effectivePath: string | null }> };
const previews = new Map<string, Preview>();
const requests = new Map<string, { digest: string; expires: number; work: Promise<unknown> }>();
const starts = new Map<string, number[]>();
let active = 0;
const scopeKey = (actor: string, scope: Scope) => JSON.stringify([actor, scope.projectId, scope.originalOrganizationId, scope.expectedClerkActorId]);
async function readSuggestionTree(tx: Prisma.TransactionClient, projectId: string) {
  const state = await tx.caseFolderState.findUnique({ where: { projectId } });
  // Explicit folder records keep the ordinary folder editor's strict contract.
  // Older imported labels are read-only context, never silently normalized into
  // writable folder records. The original labels participate in stale checks.
  const explicit = readFolders(state?.folders ?? []);
  const [oversized] = await tx.$queryRaw<Array<{ invalid: boolean }>>`SELECT EXISTS(SELECT 1 FROM "TestCase" c LEFT JOIN "TestCaseSource" s ON s."testCaseId"=c.id WHERE c."projectId"=${projectId} AND (octet_length(coalesce(nullif(c."suitePath",''),s."filePath"))>960 OR octet_length(s."filePath")>4096)) AS invalid`;
  if (oversized?.invalid) throw new TRPCError({ code: "BAD_REQUEST", message: "A legacy suite or source path exceeds the bounded hierarchy view. No labels were truncated." });
  const locations = await tx.$queryRaw<Array<{ path: string }>>`SELECT DISTINCT coalesce(nullif(c."suitePath",''),s."filePath") AS path FROM "TestCase" c LEFT JOIN "TestCaseSource" s ON s."testCaseId"=c.id WHERE c."projectId"=${projectId} AND coalesce(nullif(c."suitePath",''),s."filePath") IS NOT NULL ORDER BY path LIMIT 501`;
  if (locations.length > 500) throw new TRPCError({ code: "BAD_REQUEST", message: "Project exceeds the 500-suite review bound. No labels were hidden." });
  const paths = new Set<string>(), legacyPaths = new Set<string>();
  for (const path of [...explicit.map(f => f.path), ...locations.map(r => r.path)]) {
    if (folderPathSchema.safeParse(path).success) for (const parent of folderAncestors(path)) paths.add(parent);
    else legacyPaths.add(path);
  }
  if (paths.size + legacyPaths.size > 500) throw new TRPCError({ code: "BAD_REQUEST", message: "Hierarchy exceeds the 500-suite review bound. No branches were hidden." });
  return { explicit, paths: [...paths].sort(), legacyPaths: [...legacyPaths].sort(), revision: state?.revision ?? 0 };
}
export function smartSuggestionsEnabled(projectId: string, value = process.env.VAETTIR_SMART_SUGGESTIONS_PROJECTS) {
  if (value === "*") return true;
  try { const ids: unknown = JSON.parse(value ?? "[]"); return Array.isArray(ids) && ids.every(id => typeof id === "string") && ids.includes(projectId); }
  catch { return false; }
}
function requireEnabled(projectId: string) {
  if (!smartSuggestionsEnabled(projectId)) throw new TRPCError({ code: "FORBIDDEN", message: "Smart suggestions are not enabled for this project yet. Existing manual imports remain available." });
}
export async function smartSuggestionConfiguration(db: PrismaClient, actor: string, clerk: string | null | undefined, scope: Scope) {
  return authorized(db, actor, clerk, scope, async tx => ({ enabled: smartSuggestionsEnabled(scope.projectId), ...await analysisPermission(tx, actor, scope) }));
}
async function analysisPermission(tx: Prisma.TransactionClient, actor: string, scope: Scope) {
  const member = await tx.membership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: scope.originalOrganizationId, userId: actor } }, select: { role: true } });
  const policy = await tx.aiDisclosurePolicy.findUnique({ where: { projectId: scope.projectId }, select: { organizationId: true, classification: true, version: true } });
  const customerAdmin = member.role === "OWNER" || member.role === "ADMIN";
  const classified = policy?.organizationId === scope.originalOrganizationId && ["SYNTHETIC", "CUSTOMER_PROPRIETARY"].includes(policy.classification);
  return { canAnalyze: customerAdmin && Boolean(classified), policyVersion: policy?.version ?? 0,
    reason: !customerAdmin ? "A full-seat Owner or Admin must approve sending project content for AI analysis."
      : !classified ? "Review the project's classification in AI sharing first. Unclassified and regulated projects cannot use this analysis. A classification label does not scan or redact the content." : null };
}
async function authorizeAnalysis(db: PrismaClient, actor: string, clerk: string | null | undefined, scope: Scope & { expectedPolicyVersion: number }) {
  requireEnabled(scope.projectId);
  return authorized(db, actor, clerk, scope, async tx => {
    const permission = await analysisPermission(tx, actor, scope);
    if (!permission.canAnalyze) throw new TRPCError({ code: "FORBIDDEN", message: permission.reason! });
    if (permission.policyVersion !== scope.expectedPolicyVersion) throw new TRPCError({ code: "CONFLICT", message: "Project classification changed. Reload and approve a new analysis of the current source." });
    return permission;
  });
}
async function authorized<T>(db: PrismaClient, actor: string, clerk: string | null | undefined, scope: Scope, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  if (!clerk || clerk !== scope.expectedClerkActorId) throw new TRPCError({ code: "FORBIDDEN", message: "Restore the original signed-in account before continuing this review." });
  for (let attempt = 0; ; attempt++) { try { return await db.$transaction(async tx => {
    await lockCaseFieldProject(tx, actor, scope.projectId);
    await lockCurrentCaseFieldActor(tx, actor, { clerkActorId: clerk });
    const project = await tx.project.findUniqueOrThrow({ where: { id: scope.projectId }, select: { organizationId: true } });
    if (project.organizationId !== scope.originalOrganizationId) throw new TRPCError({ code: "FORBIDDEN", message: "The original workspace changed. Nothing was applied." });
    return work(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 }); }
  catch (error) {
    // Only a documented, rolled-back serialization failure is retried. Unknown
    // transport outcomes keep their exact request for receipt reconciliation.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt >= 2) throw error;
  } }
}
function once<T>(scope: string, requestId: string, input: unknown, run: () => Promise<T>): Promise<T> {
  const now = Date.now();
  for (const [k, p] of previews) if (p.expires < now) previews.delete(k);
  for (const [k, p] of requests) if (p.expires < now) requests.delete(k);
  for (const [k, times] of starts) if (times.every(t => t < now - 3600_000)) starts.delete(k);
  const key = scope + requestId, digest = hash(input), previous = requests.get(key);
  if (previous) {
    if (previous.digest !== digest) return Promise.reject(new TRPCError({ code: "CONFLICT", message: "This analysis request belongs to a different source. Review a new request." }));
    return previous.work as Promise<T>;
  }
  const recent = (starts.get(scope) ?? []).filter(t => t > now - 3600_000);
  if (active >= 2 || recent.length >= 200 || requests.size >= 512 || previews.size >= 256)
    return Promise.reject(new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Suggestion review is busy. Keep your preview and retry later." }));
  starts.set(scope, [...recent, now]); active++;
  const work = run().finally(() => { active--; });
  requests.set(key, { digest, work, expires: now + 30 * 60_000 });
  return work;
}
export const suggestionSelectionSchema = z.array(z.object({ id: z.string().min(1).max(500), suitePath: z.boolean(), priority: z.boolean(), testType: z.boolean() }).strict()).min(1).max(200)
  .refine(rows => new Set(rows.map(r => r.id)).size === rows.length && rows.every(r => r.suitePath || r.priority || r.testType), "Select distinct cases and at least one change per case.");

export async function smartMapping(db: PrismaClient, actor: string, clerk: string | null | undefined, input: Scope & { expectedPolicyVersion: number; requestId: string; csvText: string; approved: true }, signal?: AbortSignal) {
  requireEnabled(input.projectId);
  await authorizeAnalysis(db, actor, clerk, input);
  const cells = splitCsvRows(input.csvText), headers = (cells[0] ?? []).map(h => h.trim()), rows = cells.slice(1, 26);
  if (!headers.length || headers.length > 100 || headers.some(h => !h) || new Set(headers).size !== headers.length)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Use unique, non-empty column names before requesting suggestions." });
  return once(scopeKey(actor, input), input.requestId, { headers, rows, policyVersion: input.expectedPolicyVersion }, async () => {
    await authorizeAnalysis(db, actor, clerk, input);
    const { result } = await captureAiUsage(() => suggestImportColumns(headers, rows, signal));
    await authorizeAnalysis(db, actor, clerk, input);
    return { mappings: result };
  });
}

export async function smartRecommendations(db: PrismaClient, actor: string, clerk: string | null | undefined,
  input: Scope & { expectedPolicyVersion: number; requestId: string; approved: true; caseIds?: string[]; cases?: SmartCase[] }, signal?: AbortSignal) {
  requireEnabled(input.projectId);
  await authorizeAnalysis(db, actor, clerk, input);
  const captured = await authorized(db, actor, clerk, input, async tx => {
    const tree = await readSuggestionTree(tx, input.projectId);
    if (input.caseIds) for (const id of input.caseIds) {
      const [size] = await tx.$queryRaw<Array<{ bytes: bigint; steps: bigint; shared: boolean }>>`
        SELECT (octet_length(row_to_json(c)::text) + coalesce((SELECT sum(octet_length(row_to_json(s)::text)) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id),0))::bigint AS bytes,
          (SELECT count(*) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id)::bigint AS steps,
          (c."sharedStepGroupId" IS NOT NULL) AS shared FROM "TestCase" c WHERE c.id=${id} AND c."projectId"=${input.projectId} AND c.archived=false`;
      if (!size) throw new TRPCError({ code: "FORBIDDEN", message: "Every selected case must be active in the original project." });
      if (size.shared || size.bytes > 90_000n || size.steps > 500n) throw new TRPCError({ code: "BAD_REQUEST", message: "A case needs a shared-library or oversized-procedure review. No partial definition was analyzed." });
    }
    const stored = input.caseIds ? await tx.testCase.findMany({ where: { id: { in: input.caseIds }, projectId: input.projectId, archived: false }, include: caseInclude, orderBy: { id: "asc" } }) : [];
    if (input.caseIds && stored.length !== input.caseIds.length) throw new TRPCError({ code: "FORBIDDEN", message: "Every selected case must be active in the original project." });
    if (stored.some(c => c.sharedStepGroupId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Shared-step cases need their library review; select cases with self-contained procedures." });
    const cases = input.caseIds ? stored.map(c => ({ id: c.id, title: c.title, given: c.given,
      when: [...c.when, ...c.steps.map(s => s.action)], then: [...c.then, ...c.steps.flatMap(s => [s.expectedResult, s.expectedResponse, s.expectedActionOrData].filter((v): v is string => v !== null))],
      tags: c.tags, background: c.background ?? undefined, suitePath: c.suitePath || c.source?.filePath || undefined, priority: c.priority, testType: c.testType })) : input.cases!;
    return { tree, stored, cases: z.array(smartCaseSchema).min(1).max(20).parse(cases) };
  });
  const key = scopeKey(actor, input);
  return once(key, input.requestId, { ...captured, policyVersion: input.expectedPolicyVersion }, async () => {
    await authorizeAnalysis(db, actor, clerk, input);
    const { result } = await captureAiUsage(() => suggestCaseOrganization(captured.cases, captured.tree.paths, signal));
    for (const r of result) if (r.suitePath !== null) folderPathSchema.parse(r.suitePath);
    await authorizeAnalysis(db, actor, clerk, input);
    const reviewId = randomUUID();
    previews.set(reviewId, { scope: key, expires: Date.now() + 30 * 60_000, treeHash: hash(captured.tree), suggestions: result,
      cases: captured.stored.map(c => ({ id: c.id, revision: testCaseContentRevision(c), updatedAt: c.updatedAt.getTime(), effectivePath: c.suitePath || c.source?.filePath || null })) });
    return { reviewId, suggestions: result, knownSuites: captured.tree.paths, legacySuitePaths: captured.tree.legacyPaths, before: captured.cases.map(c => ({ id: c.id, title: c.title, suitePath: c.suitePath ?? null, priority: c.priority ?? null, testType: c.testType ?? null })) };
  });
}

export async function applySmartRecommendations(db: PrismaClient, actor: string, clerk: string | null | undefined,
  input: Scope & { requestId: string; reviewIds: string[]; approved: true; selections: z.infer<typeof suggestionSelectionSchema> }) {
  requireEnabled(input.projectId);
  const inputHash = hash(input), key = scopeKey(actor, input);
  return authorized(db, actor, clerk, input, async tx => {
    const prior = await tx.auditLog.findFirst({ where: { projectId: input.projectId, actorId: actor, entityType: "SmartCaseSuggestionReceipt", entityId: input.requestId } });
    if (prior) {
      const receipt = z.object({ inputHash: z.string(), changed: z.number() }).parse(prior.metadata);
      if (receipt.inputHash !== inputHash) return refuse("This save request belongs to different reviewed changes.");
      return { changed: receipt.changed, replayed: true };
    }
    const selectedReviews = input.reviewIds.map(id => previews.get(id));
    if (selectedReviews.some(p => !p || p.scope !== key || p.expires < Date.now() || !p.cases.length)) return refuse("This organization review expired. Generate and review new suggestions; nothing was applied.");
    const preview = { cases: selectedReviews.flatMap(p => p!.cases), suggestions: selectedReviews.flatMap(p => p!.suggestions) };
    if (new Set(preview.cases.map(c => c.id)).size !== preview.cases.length) return refuse("Review batches must contain distinct cases.");
    const tree = await readSuggestionTree(tx, input.projectId);
    if (selectedReviews.some(p => hash(tree) !== p!.treeHash)) return refuse("Suite structure changed. Review current placement before applying suggestions.");
    const folders = new Map(tree.explicit.map(f => [f.path, f]));
    const paths = new Set(tree.paths), changes = [];
    // Validate the complete selection before any case writes. Project lock also
    // serializes exact retry receipt creation and cooperating case/folder edits.
    for (const selection of input.selections) {
      const before = preview.cases.find(c => c.id === selection.id), suggestion = preview.suggestions.find(s => s.id === selection.id);
      if (!before || !suggestion) return refuse("A selected case was not in this review.");
      // The same source bound is checked before materializing the current head.
      const [size] = await tx.$queryRaw<Array<{ bytes: bigint; shared: boolean }>>`SELECT (octet_length(row_to_json(c)::text) + coalesce((SELECT sum(octet_length(row_to_json(s)::text)) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id),0))::bigint AS bytes, (c."sharedStepGroupId" IS NOT NULL) AS shared FROM "TestCase" c WHERE c.id=${before.id} AND c."projectId"=${input.projectId}`;
      if (!size || size.shared || size.bytes > 90_000n) return refuse("A selected definition changed or exceeds the review bound. Nothing was applied.");
      const current = await tx.testCase.findFirst({ where: { id: before.id, projectId: input.projectId, archived: false }, include: caseInclude });
      if (!current || testCaseContentRevision(current) !== before.revision || current.updatedAt.getTime() !== before.updatedAt || (current.suitePath || current.source?.filePath || null) !== before.effectivePath) return refuse("A selected case changed after analysis. Review fresh suggestions; no newer edits were replaced.");
      const data: { suitePath?: string; priority?: NonNullable<SmartCaseSuggestion["priority"]>; testType?: NonNullable<SmartCaseSuggestion["testType"]>; updatedById: string } = { updatedById: actor };
      if (selection.suitePath) { if (suggestion.suitePath === null) return refuse("No suite was recommended for this case."); data.suitePath = suggestion.suitePath; }
      if (selection.priority) { if (suggestion.priority === null) return refuse("No priority was recommended for this case."); data.priority = suggestion.priority; }
      if (selection.testType) { if (suggestion.testType === null) return refuse("No type was recommended for this case."); data.testType = suggestion.testType; }
      if ((!selection.suitePath || data.suitePath === current.suitePath) && (!selection.priority || data.priority === current.priority) && (!selection.testType || data.testType === current.testType)) continue;
      if (data.suitePath) for (const path of folderAncestors(data.suitePath)) {
        paths.add(path);
        if (!folders.has(path)) folders.set(path, { id: `folder_${hash([input.projectId, path])}`, path });
      }
      changes.push({ current, data, reason: suggestion.reason });
    }
    if (paths.size + tree.legacyPaths.length > 500) return refuse("These suggestions exceed the 500-folder limit. Choose fewer new suites.");
    for (const { current, data, reason } of changes) {
      const changed = await tx.testCase.update({ where: { id: current.id }, data });
      await snapshotTestCaseVersion(tx, { ...changed, testCaseId: changed.id, steps: current.steps, actorId: actor });
      await tx.auditLog.create({ data: { organizationId: input.originalOrganizationId, projectId: input.projectId, actorId: actor, entityType: "TestCase", entityId: current.id, action: "UPDATE", summary: "Applied reviewed organization suggestions", metadata: { before: { suitePath: current.suitePath, priority: current.priority, testType: current.testType }, after: data, reason, reviewIds: input.reviewIds } } });
      if (data.priority && data.priority !== current.priority) await tx.auditLog.create({ data: { organizationId: input.originalOrganizationId, projectId: input.projectId, actorId: actor, entityType: "TestCasePriority", entityId: current.id, action: "UPDATE", summary: "Accepted suggested execution priority", metadata: { mode: "MANUAL", from: current.priority, to: data.priority, rationale: reason } } });
    }
    if (folders.size !== tree.explicit.length) await tx.caseFolderState.upsert({ where: { projectId: input.projectId }, create: { projectId: input.projectId, revision: 1, folders: [...folders.values()] }, update: { revision: { increment: 1 }, folders: [...folders.values()] } });
    await tx.auditLog.create({ data: { organizationId: input.originalOrganizationId, projectId: input.projectId, actorId: actor, entityType: "SmartCaseSuggestionReceipt", entityId: input.requestId, action: "UPDATE", summary: `Applied suggestions to ${changes.length} cases`, metadata: { inputHash, changed: changes.length, reviewIds: input.reviewIds } } });
    return { changed: changes.length, replayed: false };
  });
}
