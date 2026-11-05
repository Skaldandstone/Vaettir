import { TRPCError } from "@trpc/server";
import type { Prisma } from "@vaettir/db";
import { z } from "@vaettir/core/dist/validation.js";
import { lockCaseFieldProject } from "./caseFields.js";
import { lockCurrentCaseFieldActor } from "./caseFieldReadScope.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";

export type CaseCreateRequestScope = {
  projectId: string; requestId: string;
  originalOrganizationId: string; expectedClerkActorId: string;
};
const receiptSchema = z.object({
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  caseId: z.string().min(1).max(200), clerkActorId: z.string().min(1).max(200),
});

/** Caller owns the transaction. Lock the project before the request, so the
 * durable receipt and case commit together, including cross-project ID reuse. */
export async function createCaseWithReceipt<T extends CaseCreateRequestScope>(
  tx: Prisma.TransactionClient, actorId: string, authenticatedClerkSubject: string,
  input: T, create: () => Promise<{ id: string; projectId: string }>,
) {
  await lockCaseFieldProject(tx, actorId, input.projectId);
  const clerkActorId = await lockCurrentCaseFieldActor(tx, actorId, { clerkActorId: authenticatedClerkSubject });
  const project = await tx.project.findUniqueOrThrow({ where: { id: input.projectId }, select: { organizationId: true } });
  if (clerkActorId !== input.expectedClerkActorId || project.organizationId !== input.originalOrganizationId)
    throw new TRPCError({ code: "FORBIDDEN", message: "The original project and signed-in account are required to recover this save." });
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(194267, hashtext(${input.requestId}))::text`;
  const requestHash = qualityProfileHash(input);
  const previous = await tx.auditLog.findFirst({ where: {
    entityType: "TestCaseCreate", entityId: input.requestId,
  }, select: { metadata: true, organizationId: true, projectId: true, actorId: true } });
  let caseId: string;
  if (previous) {
    const receipt = receiptSchema.safeParse(previous.metadata);
    if (!receipt.success || receipt.data.clerkActorId !== clerkActorId || previous.organizationId !== project.organizationId ||
      previous.projectId !== input.projectId || previous.actorId !== actorId)
      throw new TRPCError({ code: "FORBIDDEN", message: "This saved request cannot be rebound to the current account or workspace." });
    if (receipt.data.requestHash !== requestHash)
      throw new TRPCError({ code: "CONFLICT", message: "This request ID was already used for different case content. Recover the original request." });
    caseId = receipt.data.caseId;
    if (!await tx.testCase.findFirst({ where: { id: caseId, projectId: input.projectId }, select: { id: true } }))
      throw new TRPCError({ code: "NOT_FOUND", message: "The originally created case is no longer available. This request will not create it again." });
  } else {
    const created = await create();
    if (created.projectId !== input.projectId)
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The created case did not belong to the original project." });
    caseId = created.id;
    await tx.auditLog.create({ data: {
      organizationId: project.organizationId, projectId: input.projectId, actorId,
      entityType: "TestCaseCreate", entityId: input.requestId, action: "CREATE",
      summary: "Confirmed a case creation request",
      metadata: { requestHash, caseId, clerkActorId },
    } });
  }
  return { id: caseId, projectId: input.projectId, requestId: input.requestId, requestHash,
    originalOrganizationId: project.organizationId, expectedClerkActorId: clerkActorId, replayed: !!previous };
}
