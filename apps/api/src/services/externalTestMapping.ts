import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient } from "@vaettir/db";

export async function lockMappingProject(tx: Prisma.TransactionClient, projectId: string) {
  const projects = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
  if (!projects[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
}

// Caller holds the project lock. Duplicates in another project are valid;
// duplicates inside this project require a human to resolve, never first/last wins.
export async function projectMappings(tx: Prisma.TransactionClient, projectId: string, externalIds: string[]) {
  const sources = await tx.testCaseSource.findMany({
    where: { testCase: { projectId }, externalTestId: { in: externalIds } },
    select: { externalTestId: true, testCaseId: true },
  });
  const mapping = new Map<string, string>();
  for (const source of sources) {
    if (!source.externalTestId) continue;
    if (mapping.has(source.externalTestId)) throw new TRPCError({ code: "CONFLICT", message: "Ambiguous CI test mapping in this project. Resolve duplicate mappings before retrying." });
    mapping.set(source.externalTestId, source.testCaseId);
  }
  return { sources, mapping };
}

export async function validateTriggeringResult(db: Prisma.TransactionClient, projectId: string, testResultId: string) {
  const result = await db.testResult.findFirst({ where: { id: testResultId, testRun: { projectId } } });
  if (!result) throw new TRPCError({ code: "BAD_REQUEST", message: "The triggering result does not belong to this project" });
  if (result.testCaseId && !await db.testCase.findFirst({ where: { id: result.testCaseId, projectId }, select: { id: true } })) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The triggering result has an invalid case reference" });
  }
  if (result.externalTestId) await projectMappings(db, projectId, [result.externalTestId]);
  return result;
}

// The manual router and CI worker must not implement independent check-then-write
// mappings. Both serialize here, including the result association in the same tx.
export async function linkExternalTestResult(db: PrismaClient, input: { projectId: string; testResultId: string; testCaseId: string; jobId?: string }) {
  return db.$transaction(async (tx) => {
    await lockMappingProject(tx, input.projectId);
    const result = await validateTriggeringResult(tx, input.projectId, input.testResultId);
    const testCase = await tx.testCase.findFirst({ where: { id: input.testCaseId, projectId: input.projectId }, include: { source: true } });
    if (!testCase) throw new TRPCError({ code: "BAD_REQUEST", message: "That test case does not belong to this project" });
    if (input.jobId) {
      const job = await tx.reverseEngineerJob.findFirst({ where: { id: input.jobId, projectId: input.projectId, triggeringResultId: result.id } });
      if (!job || !job.resultTestCaseIds.includes(testCase.id) || testCase.source?.filePath !== job.inputRef) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The job, result and generated case do not match" });
      }
    }
    if (result.testCaseId && result.testCaseId !== testCase.id) throw new TRPCError({ code: "CONFLICT", message: "This result is already linked to a different test case" });
    if (result.externalTestId) {
      const { mapping } = await projectMappings(tx, input.projectId, [result.externalTestId]);
      if (mapping.has(result.externalTestId) && mapping.get(result.externalTestId) !== testCase.id) {
        throw new TRPCError({ code: "CONFLICT", message: "This CI test already maps to another case in this project" });
      }
      if (testCase.source) {
        if (testCase.source.externalTestId && testCase.source.externalTestId !== result.externalTestId) {
          throw new TRPCError({ code: "CONFLICT", message: "This case already maps to another CI test" });
        }
        if (!testCase.source.externalTestId) await tx.testCaseSource.update({ where: { id: testCase.source.id }, data: { externalTestId: result.externalTestId } });
      }
    }
    return tx.testResult.update({ where: { id: result.id }, data: { testCaseId: testCase.id }, select: { id: true, testCaseId: true } });
  }, { maxWait: 10000, timeout: 10000 });
}
