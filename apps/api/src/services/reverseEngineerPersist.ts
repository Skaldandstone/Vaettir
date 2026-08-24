import type { PrismaClient } from "@tci/db";
import type { ReverseEngineerResult } from "@tci/core";

// Shared by the synchronous agent.reverseEngineerFile mutation and the
// background job worker (jobs/reverseEngineerWorker.ts) so both paths
// create identical TestCase records -- same fields, same PENDING_REVIEW
// gate (see P8-06) -- instead of drifting apart.
export async function persistReverseEngineerResult(
  prisma: PrismaClient,
  args: { projectId: string; filePath: string; result: ReverseEngineerResult },
) {
  return Promise.all(
    args.result.testCases.map((tc) =>
      prisma.testCase.create({
        data: {
          projectId: args.projectId,
          title: tc.title,
          background: tc.background ?? undefined,
          given: tc.given,
          when: tc.when,
          then: tc.then,
          tags: tc.tags,
          testType: tc.testType as never,
          origin: "AI_REVERSE_ENGINEERED",
          confidence: tc.confidence,
          reviewStatus: "PENDING_REVIEW",
          source: {
            create: {
              filePath: args.filePath,
              functionName: tc.sourceFunctionName ?? undefined,
              framework: args.result.detectedFramework,
              frameworkFamily: args.result.detectedFrameworkFamily as never,
            },
          },
        },
        include: { source: true },
      }),
    ),
  );
}
