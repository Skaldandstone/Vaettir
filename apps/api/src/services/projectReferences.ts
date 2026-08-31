import { TRPCError } from "@trpc/server";
import type { Prisma } from "@vaettir/db";

function requireReference(found: unknown) {
  if (!found) throw new TRPCError({ code: "BAD_REQUEST", message: "A referenced record does not belong to this project" });
}

export async function requireCaseReferences(db: Prisma.TransactionClient, projectId: string, refs: { testPlanId?: string | null; sharedStepGroupId?: string | null }) {
  if (refs.testPlanId) requireReference(await db.testPlan.findFirst({ where: { id: refs.testPlanId, projectId }, select: { id: true } }));
  if (refs.sharedStepGroupId) requireReference(await db.sharedStepGroup.findFirst({ where: { id: refs.sharedStepGroupId, projectId }, select: { id: true } }));
}

export async function requireProjectRequirement(db: Prisma.TransactionClient, projectId: string, requirementId?: string | null) {
  if (requirementId) requireReference(await db.requirement.findFirst({ where: { id: requirementId, projectId }, select: { id: true } }));
}

export async function requireEvidenceReferences(db: Prisma.TransactionClient, refs: { projectId: string; testCaseId: string; testResultId?: string }) {
  requireReference(await db.testCase.findFirst({ where: { id: refs.testCaseId, projectId: refs.projectId }, select: { id: true } }));
  if (refs.testResultId) requireReference(await db.testResult.findFirst({
    where: { id: refs.testResultId, testCaseId: refs.testCaseId, testRun: { projectId: refs.projectId } }, select: { id: true },
  }));
}
