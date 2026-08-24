import { z } from "zod";
import { reverseEngineerTestFile } from "@tci/ai-agent";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";

export const agentRouter = router({
  // Reverse-engineers a pasted/uploaded test file into BDD test cases and
  // persists them, linked back to their TestCaseSource. Synchronous for now
  // (single-file); repo-scan jobs (ReverseEngineerJob) queue this per-file.
  reverseEngineerFile: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        filePath: z.string(),
        content: z.string().min(1),
        persist: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.persist) {
        await requireProjectAccess(ctx, input.projectId, "EDITOR");
      }
      const result = await reverseEngineerTestFile({
        filePath: input.filePath,
        content: input.content,
      });

      if (!input.persist) return { result, created: [] };

      const created = await Promise.all(
        result.testCases.map((tc) =>
          ctx.prisma.testCase.create({
            data: {
              projectId: input.projectId,
              title: tc.title,
              background: tc.background ?? undefined,
              given: tc.given,
              when: tc.when,
              then: tc.then,
              tags: tc.tags,
              testType: tc.testType as never,
              origin: "AI_REVERSE_ENGINEERED",
              confidence: tc.confidence,
              source: {
                create: {
                  filePath: input.filePath,
                  functionName: tc.sourceFunctionName ?? undefined,
                  framework: result.detectedFramework,
                  frameworkFamily: result.detectedFrameworkFamily as never,
                },
              },
            },
            include: { source: true },
          }),
        ),
      );

      return { result, created };
    }),
});
