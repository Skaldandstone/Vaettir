import { z } from "zod";
import { caseExecutionHistoryPageSchema } from "@vaettir/core";
import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import { listCaseExecutionHistory } from "../services/caseExecutionHistory.js";

export const caseExecutionHistoryRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1).max(200),
          testCaseId: z.string().min(1).max(200),
          limit: z.number().int().min(1).max(25).default(10),
          before: z
            .object({ runId: z.string().min(1).max(200) })
            .strict()
            .optional(),
        })
        .strict(),
    )
    .output(caseExecutionHistoryPageSchema)
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return listCaseExecutionHistory(ctx.prisma, ctx.user.id, input);
    }),
});
