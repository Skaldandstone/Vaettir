import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { deviceCaptureAccessInput, deviceCaptureAccessOutput, deviceCaptureAccessRequestText,
  type DeviceCaptureAccessInput, type DeviceCaptureAccessOutput } from "./deviceCaptureAccessSchema.js";

export type DeviceCaptureAuthentication = Readonly<{ authenticatedClerkSubject: string }>;
const denied = () => new TRPCError({ code: "FORBIDDEN", message: "A currently verified original native account and full editor workspace are required for this read. Retained capture intent was not rebound." });
const unsupported = () => new TRPCError({ code: "PRECONDITION_FAILED", message: "The complete original capture access identity is unsupported. No identity was clipped or substituted." });
export function deviceCaptureAccessRequestKey(input: DeviceCaptureAccessInput) {
  return createHash("sha256").update(deviceCaptureAccessRequestText(input)).digest("hex");
}

/** Read-time authorization only, not source-processing permission, foreground
 * target verification, an operation ticket, receipt or physical-device action.
 * Independently verified transport subject is NOT read from the native User. */
export async function readDeviceCaptureAccess(db: PrismaClient, nativeUserId: string, raw: DeviceCaptureAccessInput,
  authentication: DeviceCaptureAuthentication): Promise<DeviceCaptureAccessOutput> {
  const parsed = deviceCaptureAccessInput.safeParse(raw);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "Supply the exact original capture access pins and fresh read identity, without source or device payloads." });
  const input = parsed.data;
  if (nativeUserId !== input.expectedNativeActorId || !authentication?.authenticatedClerkSubject ||
    authentication.authenticatedClerkSubject !== input.expectedClerkActorId) throw denied();
  return db.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout='8000ms'`);
    // Consistent org -> membership -> project -> user lock order. Scalar CASE
    // admissions precede decoding bounded identities; no private project body.
    const [organization] = await tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`
      SELECT "suspendedAt" FROM "Organization" WHERE id=${input.originalOrganizationId} FOR SHARE`;
    const [member] = await tx.$queryRaw<Array<{ role: string; seatType: string }>>`
      SELECT role::text AS role,"seatType"::text AS "seatType" FROM "Membership"
      WHERE "organizationId"=${input.originalOrganizationId} AND "userId"=${nativeUserId} FOR SHARE`;
    const [project] = await tx.$queryRaw<Array<{ organizationId: string | null }>>`
      SELECT CASE WHEN length("organizationId") BETWEEN 1 AND 200 AND octet_length("organizationId")<=800
        THEN "organizationId" ELSE NULL END AS "organizationId" FROM "Project" WHERE id=${input.projectId} FOR SHARE`;
    const [actor] = await tx.$queryRaw<Array<{ clerkUserId: string | null }>>`
      SELECT CASE WHEN length("clerkUserId") BETWEEN 1 AND 200 AND octet_length("clerkUserId")<=800
        THEN "clerkUserId" ELSE NULL END AS "clerkUserId" FROM "User" WHERE id=${nativeUserId} FOR SHARE`;
    if (!organization || organization.suspendedAt !== null || !member || member.seatType !== "FULL" ||
      !["OWNER", "ADMIN", "EDITOR"].includes(member.role) || project?.organizationId !== input.originalOrganizationId ||
      actor?.clerkUserId !== authentication.authenticatedClerkSubject || actor.clerkUserId !== input.expectedClerkActorId) throw denied();
    const result = deviceCaptureAccessOutput.safeParse({
      readRequestId: input.readRequestId, requestKey: deviceCaptureAccessRequestKey(input),
      scope: { projectId: input.projectId, organizationId: project.organizationId,
        nativeActorId: nativeUserId, clerkActorId: actor.clerkUserId },
      role: member.role, seatType: member.seatType, authorization: "CURRENT_LOCKED_FULL_EDITOR_READ",
      processingPermissionGranted: false, foregroundTargetVerified: false, deviceOperationPerformed: false,
    });
    if (!result.success) throw unsupported();
    return result.data;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000, maxWait: 5000 });
}
