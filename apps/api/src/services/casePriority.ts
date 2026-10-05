import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { z } from "zod";
import { lockCaseFieldProject } from "./caseFields.js";
import { lockCurrentCaseFieldActor, type CaseFieldReadAuthorization } from "./caseFieldReadScope.js";
import { testCaseContentRevision } from "./testCaseContentRevision.js";
import { snapshotTestCaseVersion } from "./testCaseVersion.js";
import { sharedLibraryStepSchema } from "./sharedStepHistorySchema.js";

export const casePriorityInput = z.object({
  projectId: z.string().min(1).max(200), caseId: z.string().min(1).max(200),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  expectedCaseRevision: z.string().regex(/^[a-f0-9]{64}$/),
  requestId: z.string().uuid(),
  originalOrganizationId: z.string().min(1).max(200), expectedClerkActorId: z.string().min(1).max(200),
}).strict();

export async function setCasePriority(db: PrismaClient, userId: string, input: z.input<typeof casePriorityInput>, authorized: CaseFieldReadAuthorization) {
  const parsed = casePriorityInput.parse(input);
  const requestHash = createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
  return db.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '8000ms'`);
    await lockCaseFieldProject(tx, userId, parsed.projectId);
    await lockCurrentCaseFieldActor(tx, userId, authorized);
    const project = await tx.project.findUniqueOrThrow({ where: { id: parsed.projectId }, select: { organizationId: true } });
    if (project.organizationId !== parsed.originalOrganizationId || authorized.clerkActorId !== parsed.expectedClerkActorId) throw new TRPCError({ code: "FORBIDDEN", message: "Restore the original signed-in account and workspace before retrying this priority decision." });
    // The project lock serializes receipt lookup + write. A lost response can
    // retry the exact request without creating another priority/version change.
    const receipt = await tx.auditLog.findFirst({ where: {
      projectId: parsed.projectId, actorId: userId, entityType: "TestCasePriority", entityId: parsed.caseId,
      metadata: { path: ["requestId"], equals: parsed.requestId },
    }, select: { metadata: true } });
    if (receipt) {
      const saved = z.object({ requestHash: z.string(), to: casePriorityInput.shape.priority }).safeParse(receipt.metadata);
      if (!saved.success || saved.data.requestHash !== requestHash) throw new TRPCError({ code: "CONFLICT", message: "This priority request already has different content. Retry the original decision." });
      return { priority: saved.data.to, replayed: true, requestId: parsed.requestId };
    }
    const [size] = await tx.$queryRaw<Array<{ bytes: number; steps: number }>>`
      SELECT (octet_length(concat(c.title,c.background,c.given::text,c."when"::text,c."then"::text,c.tags::text,c."verificationProfile"::text))
        + coalesce((SELECT sum(octet_length(concat(s.action,s."expectedActionOrData",s."expectedResult",s."expectedResponse",s."mediaAttachmentIds"::text))) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id),0)
        + coalesce((SELECT octet_length(g.steps::text) FROM "SharedStepGroup" g WHERE g.id=c."sharedStepGroupId"),0))::int AS bytes,
        (SELECT count(*)::int FROM "TestCaseStep" s WHERE s."testCaseId"=c.id) AS steps
      FROM "TestCase" c WHERE c.id=${parsed.caseId} AND c."projectId"=${parsed.projectId} FOR UPDATE`;
    if (!size) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found in this project." });
    if (size.bytes > 524288 || size.steps > 500) throw new TRPCError({ code: "BAD_REQUEST", message: "This case exceeds the bounded metadata-change limit. Nothing changed." });
    const current = await tx.testCase.findFirstOrThrow({ where: { id: parsed.caseId, projectId: parsed.projectId }, include: { steps: { orderBy: { order: "asc" } }, sharedStepGroup: true } });
    if (testCaseContentRevision(current) !== parsed.expectedCaseRevision) throw new TRPCError({ code: "CONFLICT", message: "This case changed since it was opened. Refresh before setting priority." });
    if (current.archived) throw new TRPCError({ code: "BAD_REQUEST", message: "Restore the archived case before changing its priority." });
    if (current.sharedStepGroup && current.sharedStepGroup.projectId !== parsed.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "The shared procedure must belong to this project." });
    const frozenSteps = current.sharedStepGroup ? z.array(sharedLibraryStepSchema).max(500).parse(current.sharedStepGroup.steps).map(step => ({ ...step, expectedActionOrData: step.expectedActionOrData ?? null, expectedResult: step.expectedResult ?? null, expectedResponse: step.expectedResponse ?? null, mediaAttachmentIds: step.mediaAttachmentIds ?? [] })) : current.steps;
    if (current.sharedStepGroup && !frozenSteps.every((step, index) => step.order === index)) throw new TRPCError({ code: "BAD_REQUEST", message: "Review the shared procedure order before changing metadata. Nothing changed." });
    const changed = await tx.testCase.update({ where: { id: current.id }, data: { priority: parsed.priority, updatedById: userId } });
    await tx.auditLog.create({ data: {
      organizationId: project.organizationId, projectId: parsed.projectId, actorId: userId,
      entityType: "TestCasePriority", entityId: current.id, action: "UPDATE", summary: `Set case priority ${parsed.priority}`,
      metadata: { mode: "MANUAL", from: current.priority, to: parsed.priority, requestId: parsed.requestId, requestHash },
    } });
    await snapshotTestCaseVersion(tx, { testCaseId: current.id, title: changed.title, background: changed.background, given: changed.given, when: changed.when, then: changed.then, steps: frozenSteps, tags: changed.tags, priority: changed.priority, testType: changed.testType, actorId: userId });
    return { priority: changed.priority, replayed: false, requestId: parsed.requestId };
  }, { timeout: 10000, maxWait: 5000 });
}
