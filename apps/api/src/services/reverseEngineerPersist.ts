import { Prisma, type PrismaClient } from "@vaettir/db";
import type { ReverseEngineerResult } from "@vaettir/core";

// Shared by the synchronous agent.reverseEngineerFile mutation, the
// background job worker (jobs/reverseEngineerWorker.ts), and P2-13's
// Gherkin import, so every path that lands AI-shaped content on a TestCase
// creates identical records instead of drifting apart. `origin` controls
// the two things that genuinely differ by source:
//   - AI_REVERSE_ENGINEERED starts PENDING_REVIEW and gets a frozen
//     aiSnapshot to diff against later (P2-06) -- inference needs a human
//     to check it.
//   - IMPORTED (Gherkin) starts APPROVED with no snapshot and no
//     confidence score -- it's a parse of content a human already wrote in
//     BDD form, not an inference, so there's nothing to distrust or diff
//     against (see the schema comment on TestCase.confidence/aiSnapshot).
//
// P2-04: keyed on (projectId, filePath, functionName) against the existing
// TestCaseSource for that slot. An unseen key creates fresh, same as
// before. A key that already has a TestCaseSource gets its TestCase
// updated in place instead of a duplicate -- content changed enough that
// the caller re-ran the source (LLM regeneration or a re-import) -- and
// for the AI path specifically, that reset also drops reviewStatus back to
// PENDING_REVIEW: an AI-regenerated case needs a human to look at it
// again, same as a brand-new one, even if a person had already approved
// the old content. A re-imported Gherkin scenario has no such trust gap,
// so it stays APPROVED.
export async function persistReverseEngineerResult(
  prisma: PrismaClient,
  args: {
    projectId: string;
    filePath: string;
    contentHash: string;
    result: ReverseEngineerResult;
    origin?: "AI_REVERSE_ENGINEERED" | "IMPORTED";
  },
) {
  const origin = args.origin ?? "AI_REVERSE_ENGINEERED";
  const isAi = origin === "AI_REVERSE_ENGINEERED";

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
        confidence: isAi ? tc.confidence : null,
      };
      // Frozen exactly as the AI produced it, never touched by a later
      // human edit -- see the schema comment on TestCase.aiSnapshot. Only
      // meaningful for the AI path; imported content has no "original AI
      // output" to diff against.
      const aiSnapshot = isAi
        ? {
            title: tc.title,
            background: tc.background ?? null,
            given: tc.given,
            when: tc.when,
            then: tc.then,
            tags: tc.tags,
          }
        : null;

      if (existing) {
        return prisma.testCase.update({
          where: { id: existing.testCaseId },
          data: {
            ...testCaseData,
            aiSnapshot: aiSnapshot ?? Prisma.JsonNull,
            ...(isAi ? { reviewStatus: "PENDING_REVIEW", reviewedById: null, reviewedAt: null } : {}),
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
          origin,
          reviewStatus: isAi ? "PENDING_REVIEW" : "APPROVED",
          ...testCaseData,
          aiSnapshot: aiSnapshot ?? Prisma.JsonNull,
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
