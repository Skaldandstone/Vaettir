import { TRPCError } from "@trpc/server";
import type { Prisma } from "@vaettir/db";
import { lockPublishedIdentityAction, readPublishedIdentityAccess } from "./identityAccessPolicy.js";

/** The optional subject is supplied by verified transport, not by a wire schema,
 * cached native User, receipt, or a browser-selected actor. Legacy callers omit it. */
export type ManualRunActor = { id: string; clerkUserId: string; authenticatedClerkSubject?: string };

/** Caller holds organization -> membership -> project -> User locks. Native
 * editor authority is unchanged; custom authority is exactly runs.execute. */
export async function manualRunPermission(tx: Prisma.TransactionClient, actor: ManualRunActor,
  organizationId: string, projectId: string, member: { role: string; seatType: string }, write: boolean) {
  const native = member.seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(member.role);
  if (native) return true;
  const subject = actor.authenticatedClerkSubject;
  if (member.seatType !== "FULL" || !subject || subject !== actor.clerkUserId) {
    if (write) throw new TRPCError({ code: "FORBIDDEN", message: "Current manual execution permission is required." });
    return false;
  }
  const identity = { userId: actor.id, clerkSubject: subject };
  const access = write
    ? await lockPublishedIdentityAction(tx, identity, organizationId, projectId, "runs.execute")
    : await readPublishedIdentityAccess(tx, identity, organizationId, projectId);
  return access.permissions.includes("runs.execute");
}
