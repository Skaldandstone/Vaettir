import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { normalizeWorkspaceName, workspaceNameError, workspaceHostname } from "@vaettir/core";
import type { Context } from "../trpc.js";

export function requireDomainSelectionEnabled() {
  if (process.env.VAETTIR_WORKSPACE_DOMAINS_ENABLED !== "1")
    throw new TRPCError({ code: "FORBIDDEN", message: "Workspace address selection is not available yet." });
}
export function validatedWorkspaceName(value: string) {
  const error = workspaceNameError(value);
  if (error) throw new TRPCError({ code: "BAD_REQUEST", message: error });
  return normalizeWorkspaceName(value);
}
// Caller holds the organization lock. Database uniqueness arbitrates all replicas.
export async function claimWorkspaceDomain(
  tx: Prisma.TransactionClient, organizationId: string, userId: string, value: string,
) {
  const name = validatedWorkspaceName(value);
  const prior = await tx.workspaceDomain.findUnique({ where: { organizationId } });
  if (prior) {
    if (prior.name !== name)
      throw new TRPCError({ code: "CONFLICT", message: "Your workspace address has already been confirmed and cannot be changed." });
    return prior;
  }
  return tx.workspaceDomain.create({ data: { name, organizationId, claimedByUserId: userId } });
}
export function domainConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    throw new TRPCError({ code: "CONFLICT", message: "This address is unavailable. Choose another name." });
  throw error;
}
export async function confirmExistingWorkspaceDomain(
  ctx: Context, organizationId: string, value: string,
) {
  requireDomainSelectionEnabled();
  const name = validatedWorkspaceName(value);
  if (!ctx.user || !ctx.authenticatedClerkSubject)
    throw new TRPCError({ code: "UNAUTHORIZED" });
  if (ctx.workspaceOrganizationId && ctx.workspaceOrganizationId !== organizationId)
    throw new TRPCError({ code: "FORBIDDEN" });
  const actor = ctx.user;
  try {
    const claim = await ctx.prisma.$transaction(async tx => {
      const org = await tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`SELECT "suspendedAt" FROM "Organization" WHERE id=${organizationId} FOR UPDATE`;
      const users = await tx.$queryRaw<Array<{ clerkUserId: string }>>`SELECT "clerkUserId" FROM "User" WHERE id=${actor.id} FOR SHARE`;
      const members = await tx.$queryRaw<Array<{ role: string; seatType: string }>>`SELECT role,"seatType" FROM "Membership" WHERE "organizationId"=${organizationId} AND "userId"=${actor.id} FOR SHARE`;
      if (!org[0] || org[0].suspendedAt || users[0]?.clerkUserId !== ctx.authenticatedClerkSubject
          || members[0]?.role !== "OWNER" || members[0]?.seatType !== "FULL")
        throw new TRPCError({ code: "FORBIDDEN", message: "Current workspace owner access is required." });
      return claimWorkspaceDomain(tx, organizationId, actor.id, name);
    });
    return { name: claim.name, hostname: workspaceHostname(claim.name), claimedAt: claim.claimedAt.toISOString() };
  } catch (error) { return domainConflict(error); }
}
export async function workspaceDomainAvailable(db: PrismaClient, value: string) {
  const name = validatedWorkspaceName(value);
  return { name, hostname: workspaceHostname(name), available: !(await db.workspaceDomain.count({ where: { name } })) };
}
