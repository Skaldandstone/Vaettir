import { TRPCError } from "@trpc/server";
import { z } from "@vaettir/core/dist/validation.js";
import { type PrismaClient } from "@vaettir/db";
import { requireProjectAccess, type Context } from "../trpc.js";
import { lockedProcessingEditor } from "./repositoryProcessingApproval.js";
import { forgeConnectionDigest, forgeConnectionToken, readForgeConnectionRequest } from "./forgeConnectionRequest.js";
import { forgeSharingEntityType, forgeSharingKey, latestForgeSharing } from "./atlassianQualitySharing.js";

type Actor = Context & { user: NonNullable<Context["user"]> };
export const forgeConnectionOptionsInput = z.object({
  requestToken: forgeConnectionToken,
  expectedClerkActorId: z.string().min(1).max(200),
  organizationId: z.string().min(1).max(120).optional(),
  search: z.string().max(100).default(""),
}).strict();
export const forgeProjectConnectionInput = z.object({
  requestToken: forgeConnectionToken,
  expectedClerkActorId: z.string().min(1).max(200),
  organizationId: z.string().min(1).max(120),
  projectId: z.string().min(1).max(120),
  approveConnection: z.literal(true),
}).strict();

async function human(ctx: Actor, expected: string) {
  if (!ctx.authenticatedClerkSubject || expected !== ctx.authenticatedClerkSubject)
    throw new TRPCError({ code: "FORBIDDEN", message: "Restore the signed-in account that opened this connection." });
  const user = await ctx.prisma.user.findUnique({ where: { id: ctx.user.id }, include: { memberships: true } });
  if (!user || user.clerkUserId !== ctx.authenticatedClerkSubject) throw new TRPCError({ code: "FORBIDDEN" });
  // This fresh database read must retain the trusted ingress scope. A human
  // can administer several customers, but a customer host exposes only itself.
  return ctx.workspaceOrganizationId
    ? { ...user, memberships: user.memberships.filter(m => m.organizationId === ctx.workspaceOrganizationId) }
    : user;
}
function request(token: string) {
  try { return readForgeConnectionRequest(token); }
  catch { throw new TRPCError({ code: "BAD_REQUEST", message: "This project connection request expired or changed. Return to Jira or Confluence and start the connection again." }); }
}
async function access(ctx: Actor, value: z.infer<typeof forgeProjectConnectionInput>) {
  const user = await human(ctx, value.expectedClerkActorId);
  const scope = await requireProjectAccess({ ...ctx, user }, value.projectId, "ADMIN");
  if (scope.project.organizationId !== value.organizationId || scope.membership.seatType !== "FULL")
    throw new TRPCError({ code: "FORBIDDEN" });
}

/** Only names/IDs in the current human's live administrator workspaces. No
 * case, report, repository, architecture or credential content is read here. */
export async function forgeConnectionOptions(ctx: Actor, value: z.infer<typeof forgeConnectionOptionsInput>) {
  const user = await human(ctx, value.expectedClerkActorId), pending = request(value.requestToken);
  const ids = user.memberships.filter(m => ["OWNER", "ADMIN"].includes(m.role) && m.seatType === "FULL").map(m => m.organizationId);
  if (value.organizationId && !ids.includes(value.organizationId)) throw new TRPCError({ code: "FORBIDDEN" });
  const organizations = await ctx.prisma.organization.findMany({ where: { id: { in: ids }, suspendedAt: null }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  const selected = organizations.filter(o => !value.organizationId || o.id === value.organizationId).map(o => o.id);
  const rows = await ctx.prisma.project.findMany({ where: { organizationId: { in: selected }, ...(value.search ? { name: { contains: value.search, mode: "insensitive" as const } } : {}) },
    select: { id: true, name: true, organizationId: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 101 });
  return { actorClerkUserId: ctx.authenticatedClerkSubject!, requestDigest: forgeConnectionDigest(value.requestToken),
    binding: pending.binding, targetLabel: pending.targetLabel, expiresAt: new Date(pending.expiresAt).toISOString(),
    organizations, projects: rows.slice(0, 100), catalogLimited: rows.length > 100 };
}

/** An encrypted handoff is destination provenance, NOT user authorization.
 * A fresh human administrator explicitly selects/approves exactly one project.
 * The nonce is consumed atomically in the existing durable audit ledger. */
export async function connectForgeProject(ctx: Actor, value: z.infer<typeof forgeProjectConnectionInput>) {
  const pending = request(value.requestToken);
  await access(ctx, value);
  const digest = forgeConnectionDigest(value.requestToken), nonce = forgeConnectionDigest(pending.nonce);
  const receiptId = "forge-connect-consumed-" + nonce, key = forgeSharingKey(pending.connectionId);
  return ctx.prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${ctx.user.id} FOR SHARE`;
    await lockedProcessingEditor(tx, value.organizationId, ctx.user.id, value.projectId);
    await access({ ...ctx, prisma: tx as unknown as PrismaClient }, value);
    // Prevent simultaneous or replayed consumption in another tenant/project.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${receiptId}))::text`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
    const receipt = await tx.auditLog.findUnique({ where: { id: receiptId } });
    const rows = await tx.auditLog.findMany({ where: { entityType: forgeSharingEntityType, entityId: key }, take: 501 });
    if (rows.length > 500 || rows.some(row => row.organizationId !== value.organizationId || row.projectId !== value.projectId))
      throw new TRPCError({ code: "CONFLICT" });
    if (receipt) {
      const stored = z.object({ requestDigest: z.literal(digest), connectionId: z.literal(pending.connectionId) }).safeParse(receipt.metadata);
      if (!stored.success || receipt.organizationId !== value.organizationId || receipt.projectId !== value.projectId || receipt.actorId !== ctx.user.id)
        throw new TRPCError({ code: "CONFLICT", message: "This request was already used for a different project or account. Start a new connection from Jira or Confluence." });
      const current = latestForgeSharing(rows);
      if (!current) throw new TRPCError({ code: "CONFLICT" });
      return { organizationId: value.organizationId, projectId: value.projectId, actorClerkUserId: ctx.authenticatedClerkSubject!, requestDigest: digest, connectionKey: key, state: current.state };
    }
    if (rows.length) throw new TRPCError({ code: "CONFLICT" });
    await tx.auditLog.create({ data: {
      id: "forge-connect-approved-" + nonce, organizationId: value.organizationId, projectId: value.projectId, actorId: ctx.user.id,
      entityType: forgeSharingEntityType, entityId: key, action: "CREATE",
      summary: "Connected one authenticated Atlassian project/space to approved project quality summaries and explicitly ticket-linked verification; source and architecture excluded",
      metadata: { connectionId: pending.connectionId, version: 1, state: "APPROVED", binding: pending.binding,
        shareApprovedProjectQuality: true, shareTicketTests: pending.binding.product === "jira", snapshotIds: [], releaseLinks: [], closureSnapshotIds: [] },
    } });
    await tx.auditLog.create({ data: {
      id: receiptId, organizationId: value.organizationId, projectId: value.projectId, actorId: ctx.user.id,
      entityType: "ForgeConnectionRequest", entityId: nonce, action: "CREATE", summary: "Consumed authenticated project connection request once",
      metadata: { requestDigest: digest, connectionId: pending.connectionId },
    } });
    return { organizationId: value.organizationId, projectId: value.projectId, actorClerkUserId: ctx.authenticatedClerkSubject!, requestDigest: digest, connectionKey: key, state: "APPROVED" as const };
  }, { timeout: 15000, isolationLevel: "ReadCommitted" });
}
