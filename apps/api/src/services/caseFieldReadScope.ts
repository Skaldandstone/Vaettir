import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { z } from "zod";

const id = z.string().min(1).max(200);
export const caseFieldReadPinFields = {
  originalOrganizationId: id.optional(),
  expectedClerkActorId: id.optional(),
};
export type CaseFieldReadPins = {
  originalOrganizationId?: string;
  expectedClerkActorId?: string;
};
export function pairedCaseFieldReadPins(
  value: CaseFieldReadPins,
  context: z.RefinementCtx,
) {
  if (
    (value.originalOrganizationId === undefined) !==
    (value.expectedClerkActorId === undefined)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Original organization and Clerk actor read pins must be supplied together.",
    });
  }
}
const pins = z
  .object(caseFieldReadPinFields)
  .strict()
  .superRefine(pairedCaseFieldReadPins);
export const caseFieldReadScopeSchema = z
  .object({
    projectId: id,
    organizationId: id,
    actorId: id,
    actorClerkUserId: id,
  })
  .strict();
export type CaseFieldReadAuthorization = { clerkActorId: string };

/** Acquire after the project lock and before case bodies or receipt lookup.
 * Keep the current native mapping stable for the entire caller transaction. */
export async function lockCurrentCaseFieldActor(
  tx: Prisma.TransactionClient,
  userId: string,
  authorized?: CaseFieldReadAuthorization,
) {
  const [actor] = await tx.$queryRaw<
    Array<{ clerkUserId: string | null }>
  >`
    SELECT CASE WHEN length("clerkUserId") BETWEEN 1 AND 200 THEN "clerkUserId" ELSE NULL END AS "clerkUserId"
    FROM "User" WHERE id=${userId} FOR SHARE`;
  if (
    !actor?.clerkUserId ||
    (authorized !== undefined && actor.clerkUserId !== authorized.clerkActorId)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Current signed-in actor access is required. Retained metadata requests were not rebound.",
    });
  }
  return actor.clerkUserId;
}

/** Caller owns the bounded RR transaction. Inputs pin intent; they never grant
 * access. Router callers supply the independently authenticated Clerk identity;
 * legacy direct callers still resolve the current DB mapping under locks. */
export async function lockCaseFieldReadScope(
  tx: Prisma.TransactionClient,
  userId: string,
  input: CaseFieldReadPins & { projectId: string; caseId?: string },
  authorized?: CaseFieldReadAuthorization,
) {
  const parsed = pins.safeParse({
    originalOrganizationId: input.originalOrganizationId,
    expectedClerkActorId: input.expectedClerkActorId,
  });
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Supply valid original organization and Clerk actor read pins together.",
    });
  }
  await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '8000ms'`);
  const original = await tx.project.findUnique({
    where: { id: input.projectId },
    select: { organizationId: true },
  });
  if (!original)
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
  if (
    input.originalOrganizationId !== undefined &&
    input.originalOrganizationId !== original.organizationId
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "This retained field read belongs to another original organization. Its scope was not rebound.",
    });
  }
  // Match the existing org -> membership -> project -> user read order. Do not
  // reuse the editor-only authoring lock or upgrade a Viewer to a full seat.
  const [organization] = await tx.$queryRaw<
    Array<{ suspendedAt: Date | null }>
  >`SELECT "suspendedAt" FROM "Organization" WHERE id=${original.organizationId} FOR SHARE`;
  const [member] = await tx.$queryRaw<
    Array<{ role: string; seatType: string }>
  >`
    SELECT role::text AS role,"seatType"::text AS "seatType" FROM "Membership"
    WHERE "organizationId"=${original.organizationId} AND "userId"=${userId} FOR SHARE`;
  const [project] = await tx.$queryRaw<
    Array<{ organizationId: string }>
  >`SELECT "organizationId" FROM "Project" WHERE id=${input.projectId} FOR SHARE`;
  const actorClerkUserId = await lockCurrentCaseFieldActor(tx, userId, authorized);
  if (
    !organization ||
    organization.suspendedAt ||
    !member ||
    !["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(
      member.role,
    ) ||
    !["FULL", "READ_ONLY"].includes(member.seatType) ||
    project?.organizationId !== original.organizationId ||
    (input.expectedClerkActorId !== undefined &&
      actorClerkUserId !== input.expectedClerkActorId)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Current original-organization and signed-in actor access is required. Retained field reads were not rebound.",
    });
  }
  if (input.caseId !== undefined) {
    const [testCase] = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "TestCase" WHERE id=${input.caseId} AND "projectId"=${input.projectId} FOR SHARE`;
    if (!testCase)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Case not found in this project.",
      });
  }
  return caseFieldReadScopeSchema.parse({
    projectId: input.projectId,
    organizationId: original.organizationId,
    actorId: userId,
    actorClerkUserId,
  });
}
