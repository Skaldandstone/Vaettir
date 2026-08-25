import type { PrismaClient } from "@vaettir/db";
import type { ReverseEngineerResult } from "@vaettir/core";

// Shared by the synchronous agent.reverseEngineerFile mutation and the
// background job worker (jobs/reverseEngineerWorker.ts) so both paths
// create identical TestCase records -- same fields, same PENDING_REVIEW
// gate (see P8-06) -- instead of drifting apart.
//
// P2-04: keyed on (projectId, filePath, functionName) against the existing
// TestCaseSource for that slot. An unseen key creates fresh, same as
// before. A key that already has a TestCaseSource gets its TestCase
// updated in place instead of a duplicate -- content changed enough that
// the caller re-ran the LLM on this file (see repoScan.ts's hash-skip),
// so the update also resets reviewStatus back to PENDING_REVIEW: an
// AI-regenerated case needs a human to look at it again, same as a
// brand-new one, even if a person had already approved the old content.
export async function persistReverseEngineerResult(
  prisma: PrismaClient,
  args: { projectId: string; filePath: string; contentHash: string; result: ReverseEngineerResult },
) {
  const existingSources = await prisma.testCaseSource.findMany({
    where: { testCase: { projectId: args.projectId }, filePath: args.filePath },
    select: { id: true, functionName: true, testCaseId: true },
  });
  const existingByFunctionName = new Map(existingSources.map((s) => [s.functionName, s]));

  return Promise.all(
    args.result.testCases.map((tc) => {
      const existing = existingByFunctionName.get(tc.sourceFunctionName ?? null);

      const testCaseData = {
        title: tc.title,
        background: tc.background ?? undefined,
        given: tc.given,
        when: tc.when,
        then: tc.then,
        tags: tc.tags,
        testType: tc.testType as never,
        confidence: tc.confidence,
      };

      if (existing) {
        return prisma.testCase.update({
          where: { id: existing.testCaseId },
          data: {
            ...testCaseData,
            reviewStatus: "PENDING_REVIEW",
            reviewedById: null,
            reviewedAt: null,
            source: {
              update: {
                contentHash: args.contentHash,
                framework: args.result.detectedFramework,
                frameworkFamily: args.result.detectedFrameworkFamily as never,
                lastSyncedAt: new Date(),
              },
            },
          },
          include: { source: true },
        });
      }

      return prisma.testCase.create({
        data: {
          projectId: args.projectId,
          origin: "AI_REVERSE_ENGINEERED",
          reviewStatus: "PENDING_REVIEW",
          ...testCaseData,
          source: {
            create: {
              filePath: args.filePath,
              functionName: tc.sourceFunctionName ?? undefined,
              framework: args.result.detectedFramework,
              frameworkFamily: args.result.detectedFrameworkFamily as never,
              contentHash: args.contentHash,
              lastSyncedAt: new Date(),
            },
          },
        },
        include: { source: true },
      });
    }),
  );
}
