import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient, type ImportMappingBatch, type ImportMappingRow } from "@vaettir/db";
import { z } from "@vaettir/core/dist/validation.js";
import { lockCaseFieldProject } from "./caseFields.js";
import { lockCurrentCaseFieldActor } from "./caseFieldReadScope.js";
import { commitImportedTestCasesInTransaction } from "./importCommit.js";
import { mappingCandidateSchema, mappingDigest, type MappingCandidate, type PlannedMappingRow } from "./importMappingPlan.js";

const id = z.string().min(1).max(200);
export const mappingScopeSchema = z.object({ projectId: id, originalOrganizationId: id, expectedClerkActorId: id }).strict();
export const mappingBatchInput = mappingScopeSchema.extend({ batchId: z.string().uuid() });
export const mappingConfirmInput = mappingBatchInput.extend({ requestId: z.string().uuid(), expectedDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const mappingResolveInput = mappingConfirmInput.extend({ rows: z.array(z.object({ id, candidate: mappingCandidateSchema }).strict()).min(1).max(100) }).strict();
type Scope = z.infer<typeof mappingScopeSchema>;
type Actor = { id: string; clerkActorId: string };
const fail = (message: string, code: "CONFLICT" | "FORBIDDEN" | "BAD_REQUEST" = "CONFLICT") => new TRPCError({ code, message });
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const txOptions = { timeout: 120_000 };

async function authorize(tx: Prisma.TransactionClient, actor: Actor, scope: Scope) {
  if (!actor.clerkActorId || actor.clerkActorId !== scope.expectedClerkActorId) throw fail("Restore the original account.", "FORBIDDEN");
  await lockCaseFieldProject(tx, actor.id, scope.projectId);
  await lockCurrentCaseFieldActor(tx, actor.id, { clerkActorId: actor.clerkActorId });
  const project = await tx.project.findUniqueOrThrow({ where: { id: scope.projectId }, select: { organizationId: true } });
  if (project.organizationId !== scope.originalOrganizationId) throw fail("The original workspace changed.", "FORBIDDEN");
}
async function ownedBatch(tx: Prisma.TransactionClient, actor: Actor, input: z.infer<typeof mappingBatchInput>) {
  await authorize(tx, actor, input);
  const batch = await tx.importMappingBatch.findUnique({ where: { id: input.batchId } });
  if (!batch || batch.projectId !== input.projectId || batch.organizationId !== input.originalOrganizationId || batch.actorId !== actor.id || batch.clerkActorId !== actor.clerkActorId)
    throw fail("Mapping queue not available in this account and project.", "FORBIDDEN");
  if (batch.revokedAt) throw fail("Access changed since this import. The original source is retained; this request cannot resume.", "FORBIDDEN");
  return batch;
}
function summary(batch: ImportMappingBatch, rows: ImportMappingRow[]) {
  return { id: batch.id, sourceLabel: batch.sourceLabel, state: batch.state,
    readyCount: rows.filter(r => r.state === "READY").length,
    pendingCount: rows.filter(r => r.state === "MAPPING").length,
    contextCount: rows.filter(r => r.state === "CONTEXT").length,
    historyCount: rows.filter(r => r.state === "HISTORY" || r.hasHistory && r.state !== "IMPORTED").length,
    importedCount: rows.filter(r => r.state === "IMPORTED" || r.state === "HISTORY").length,
    digest: mappingDigest({ id: batch.id, state: batch.state, rows: rows.map(r => ({ id: r.id, state: r.state, candidate: r.candidate, caseId: r.caseId })) }),
  };
}
export async function stageMappingBatch(db: PrismaClient, actor: Actor, scope: Scope,
  input: { requestId: string; sourceLabel: string; sourceDigest: string; rows: PlannedMappingRow[] }) {
  return db.$transaction(async tx => {
    await authorize(tx, actor, scope);
    const requestHash = mappingDigest({ scope: { projectId: scope.projectId, originalOrganizationId: scope.originalOrganizationId, expectedClerkActorId: scope.expectedClerkActorId }, actor, sourceLabel: input.sourceLabel, sourceDigest: input.sourceDigest });
    const prior = await tx.importMappingBatch.findUnique({ where: { id: input.requestId } });
    if (prior) {
      const batch = await ownedBatch(tx, actor, { ...scope, batchId: prior.id });
      if (batch.requestHash !== requestHash || batch.state !== "DRAFT") throw fail("This import request has already changed. Use its recorded result.");
      return summary(batch, await tx.importMappingRow.findMany({ where: { batchId: batch.id }, orderBy: { ordinal: "asc" } }));
    }
    const batch = await tx.importMappingBatch.create({ data: { id: input.requestId, projectId: scope.projectId,
      organizationId: scope.originalOrganizationId, actorId: actor.id, clerkActorId: actor.clerkActorId,
      requestHash, sourceLabel: input.sourceLabel,
      rows: { create: input.rows.map((r, ordinal) => ({ ordinal, sheet: r.sheet, sourceRowNumber: r.rowNumber,
        originalRowNumber: r.originalRowNumber, state: r.status, candidate: json(r.candidate), original: json(r.original),
        reasons: r.reasons, hasHistory: r.hasHistoricalColumns, keyPrefix: r.keyPrefix, externalIdPrefix: r.externalIdPrefix, framework: r.framework,
      })) },
    } });
    return summary(batch, await tx.importMappingRow.findMany({ where: { batchId: batch.id }, orderBy: { ordinal: "asc" } }));
  }, txOptions);
}

const receiptSchema = z.object({ batchId: z.string(), createdCount: z.number(), updatedCount: z.number(), pendingCount: z.number(), historyCount: z.number(), importedCount: z.number() }).strict();
async function applyRows(tx: Prisma.TransactionClient, batch: ImportMappingBatch, rows: ImportMappingRow[], edits = new Map<string, MappingCandidate>()) {
  let createdCount = 0, updatedCount = 0;
  const groups = new Map<string, ImportMappingRow[]>();
  for (const row of rows) groups.set(row.keyPrefix, [...(groups.get(row.keyPrefix) ?? []), row]);
  const allRows = await tx.importMappingRow.findMany({ where: { batchId: batch.id } });
  for (const [keyPrefix, group] of groups) {
    const candidates = group.map(r => {
      const c = edits.get(r.id) ?? mappingCandidateSchema.parse(r.candidate);
      if (!c.title.trim() || r.framework === "google-sheets" && !c.externalId?.trim()) throw fail("Complete titles and required source IDs.", "BAD_REQUEST");
      return { ...c, rowNumber: r.ordinal + 2, externalId: c.externalId ? r.externalIdPrefix + c.externalId.trim() : undefined,
        reviewRequired: Boolean(c.reviewReasons?.length) };
    });
    const keys = candidates.flatMap(r => r.externalId ? [r.externalId] : []);
    if (new Set(keys).size !== keys.length) throw fail("Resolve duplicate source IDs before applying this selection.", "BAD_REQUEST");
    for (const other of allRows.filter(r => r.keyPrefix === keyPrefix && r.state !== "CONTEXT" && !rows.some(selected => selected.id === r.id))) {
      const originalId = z.object({ externalId: z.string().optional() }).safeParse(other.candidate);
      if (originalId.success && originalId.data.externalId && keys.includes(other.externalIdPrefix + originalId.data.externalId))
        throw fail("This source ID belongs to another row in this import. Resolve the duplicate.", "BAD_REQUEST");
    }
    const result = await commitImportedTestCasesInTransaction(tx as unknown as PrismaClient, {
      projectId: batch.projectId, organizationId: batch.organizationId, actorId: batch.actorId, source: "CSV",
      sourceLabel: batch.sourceLabel, rows: candidates, skipped: [], fieldMapping: { mappingQueue: batch.id },
      keyPrefix, framework: group[0]!.framework, captureRows: true,
    });
    createdCount += result.createdCount; updatedCount += result.updatedCount;
    for (const r of group) {
      const accepted = result.rowReceipts?.find(x => x.rowNumber === r.ordinal + 2);
      if (accepted) await tx.importMappingRow.update({ where: { id: r.id }, data: {
        state: r.hasHistory ? "HISTORY" : "IMPORTED", caseId: accepted.caseId, resolvedAt: new Date(),
        candidate: json({ externalId: (edits.get(r.id) ?? mappingCandidateSchema.parse(r.candidate)).externalId }),
        original: r.hasHistory ? json(r.original) : {}, reasons: r.hasHistory ? ["Historical observations are retained for separate pairing; no results were imported."] : [],
      } });
      else await tx.importMappingRow.update({ where: { id: r.id }, data: { state: "MAPPING",
        reasons: [result.skipped.find(x => x.rowNumber === r.ordinal + 2)?.reason ?? "No case receipt was recorded. Review this row."],
      } });
    }
  }
  return { createdCount, updatedCount };
}
export async function confirmMappingBatch(db: PrismaClient, actor: Actor, raw: z.infer<typeof mappingConfirmInput> | z.infer<typeof mappingResolveInput>) {
  const resolution = "rows" in raw ? mappingResolveInput.parse(raw) : null;
  const input = resolution ?? mappingConfirmInput.parse(raw);
  return db.$transaction(async tx => {
    const batch = await ownedBatch(tx, actor, input);
    const hash = mappingDigest(input), prior = await tx.importMappingWrite.findUnique({ where: { id: input.requestId } });
    if (prior) {
      if (prior.batchId !== batch.id || prior.requestHash !== hash) throw fail("The retained request differs. Its receipt was not replaced.");
      return receiptSchema.parse(prior.receipt);
    }
    const rows = await tx.importMappingRow.findMany({ where: { batchId: batch.id }, orderBy: { ordinal: "asc" } });
    if (summary(batch, rows).digest !== input.expectedDigest) throw fail("The queue changed. Refresh the selection.");
    const resolving = resolution !== null;
    if (batch.state !== (resolving ? "CONFIRMED" : "DRAFT")) throw fail("The import state changed. Refresh its recorded result.");
    const edits = new Map<string, MappingCandidate>(resolution ? resolution.rows.map(r => [r.id, r.candidate]) : []);
    const selected = resolving ? rows.filter(r => edits.has(r.id)) : rows.filter(r => r.state === "READY");
    if (resolution && (selected.length !== resolution.rows.length || selected.some(r => r.state !== "MAPPING" && r.state !== "CONTEXT")))
      throw fail("Choose unresolved rows from this queue.");
    const counts = await applyRows(tx, batch, selected, edits);
    await tx.importMappingBatch.update({ where: { id: batch.id }, data: { state: "CONFIRMED", confirmedAt: batch.confirmedAt ?? new Date() } });
    const remaining = await tx.importMappingRow.findMany({ where: { batchId: batch.id }, orderBy: { ordinal: "asc" } });
    const info = summary({ ...batch, state: "CONFIRMED" }, remaining);
    const receipt = { batchId: batch.id, ...counts, pendingCount: info.pendingCount, historyCount: info.historyCount, importedCount: info.importedCount };
    await tx.importMappingWrite.create({ data: { id: input.requestId, batchId: batch.id, requestHash: hash, receipt } });
    return receipt;
  }, txOptions);
}

export async function readMappingQueue(db: PrismaClient, actor: Actor, input: z.infer<typeof mappingBatchInput>) {
  return db.$transaction(async tx => {
    const batch = await ownedBatch(tx, actor, input);
    const rows = await tx.importMappingRow.findMany({ where: { batchId: batch.id }, orderBy: { ordinal: "asc" } });
    return { ...summary(batch, rows), rows: rows.filter(r => ["READY", "MAPPING", "CONTEXT", "HISTORY"].includes(r.state)).map(r => ({
      id: r.id, sheet: r.sheet, originalRowNumber: r.originalRowNumber, state: r.state, reasons: r.reasons,
      candidate: r.state === "HISTORY" ? null : mappingCandidateSchema.parse(r.candidate),
      original: z.object({ headers: z.array(z.string()), cells: z.array(z.string()) }).parse(r.original), caseId: r.caseId,
    })) };
  }, txOptions);
}
export async function listMappingQueues(db: PrismaClient, actor: Actor, scope: Scope) {
  return db.$transaction(async tx => {
    await authorize(tx, actor, scope);
    return tx.importMappingBatch.findMany({ where: { projectId: scope.projectId, organizationId: scope.originalOrganizationId,
      actorId: actor.id, clerkActorId: actor.clerkActorId, revokedAt: null, state: { in: ["DRAFT", "CONFIRMED"] },
      rows: { some: { state: { in: ["READY", "MAPPING", "CONTEXT", "HISTORY"] } } },
    }, select: { id: true, sourceLabel: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 100 });
  }, txOptions);
}

// Cancellation only discards an unconfirmed staging copy; it never undoes cases.
export async function cancelMappingBatch(db: PrismaClient, actor: Actor, input: z.infer<typeof mappingConfirmInput>) {
  return db.$transaction(async tx => {
    const batch = await ownedBatch(tx, actor, input);
    if (batch.state === "CANCELLED") return { cancelled: true };
    const rows = await tx.importMappingRow.findMany({ where: { batchId: batch.id }, orderBy: { ordinal: "asc" } });
    if (batch.state !== "DRAFT" || summary(batch, rows).digest !== input.expectedDigest) throw fail("The import changed. Refresh its recorded result.");
    await tx.importMappingRow.deleteMany({ where: { batchId: batch.id } });
    await tx.importMappingBatch.update({ where: { id: batch.id }, data: { state: "CANCELLED" } });
    return { cancelled: true };
  }, txOptions);
}
