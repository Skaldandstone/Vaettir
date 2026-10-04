import { Prisma } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import type { ManualRetestReadScopeInput, ManualRetestObservedScope } from "./manualRetestScopeSchema.js";

/** Identity-only discovery precedes locks; all private source/receipt work follows locked recheck.
 * Org -> membership -> write advisory -> project -> user matches other current-scope writers. */
export async function lockManualRetestAccess(tx: Prisma.TransactionClient, actorId: string,
  input: ManualRetestReadScopeInput, editor: boolean, authenticatedClerkActorId?: string, write = false): Promise<ManualRetestObservedScope> {
  await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '8000ms'`);
  const found = await tx.project.findUnique({ where: { id: input.projectId }, select: { organizationId: true } });
  if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "Current retest project is unavailable." });
  const organizationId = input.expectedScope?.organizationId ?? found.organizationId;
  if (input.expectedScope && (input.expectedScope.projectId !== input.projectId || organizationId !== found.organizationId))
    throw new TRPCError({ code: "FORBIDDEN", message: "This exact retest request belongs to another original project or organization. It was not rebound." });
  const organizations = await tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`SELECT "suspendedAt" FROM "Organization" WHERE id=${organizationId} FOR SHARE`;
  const members = await tx.$queryRaw<Array<{ role: string; seatType: string }>>`SELECT role::text AS role,"seatType"::text AS "seatType" FROM "Membership" WHERE "organizationId"=${organizationId} AND "userId"=${actorId} FOR SHARE`;
  if (write) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.projectId}))::text`;
  const projects = await tx.$queryRaw<Array<{ organizationId: string }>>(Prisma.sql`SELECT "organizationId" FROM "Project" WHERE id=${input.projectId} ${write ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`}`);
  const actors = await tx.$queryRaw<Array<{ clerkUserId: string }>>`SELECT "clerkUserId" FROM "User" WHERE id=${actorId} FOR SHARE`;
  const actor = actors[0], member = members[0];
  if (!organizations[0] || organizations[0].suspendedAt || !member || projects[0]?.organizationId !== organizationId ||
    !["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(member.role) || !["FULL", "READ_ONLY"].includes(member.seatType) ||
    (editor && (member.seatType !== "FULL" || !["OWNER", "ADMIN", "EDITOR"].includes(member.role))) || !actor ||
    (authenticatedClerkActorId && actor.clerkUserId !== authenticatedClerkActorId) ||
    (input.expectedScope && actor.clerkUserId !== input.expectedScope.clerkActorId))
    throw new TRPCError({ code: "FORBIDDEN", message: editor ? "A current full editor in the originally reviewed actor and organization is required." : "Current original-organization and signed-in actor access is required for retest links." });
  return { projectId: input.projectId, organizationId, actorId, clerkActorId: actor.clerkUserId };
}
