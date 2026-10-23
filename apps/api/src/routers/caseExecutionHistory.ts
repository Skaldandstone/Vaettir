import { caseExecutionHistoryPageSchema } from "@vaettir/core";
import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import { listCaseExecutionHistory } from "../services/caseExecutionHistory.js";
import { caseExecutionHistoryInputSchema } from "../services/caseExecutionHistoryScopeSchema.js";

export const caseExecutionHistoryRouter = router({
  list: protectedProcedure
    .input(caseExecutionHistoryInputSchema)
    .output(caseExecutionHistoryPageSchema)
    .query(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId);
      return listCaseExecutionHistory(ctx.prisma, ctx.user.id, input, { organizationId: project.organizationId, clerkActorId: ctx.user.clerkUserId });
    }),
});
