import { z } from "zod";
import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import { commentCreateInput, commentListInput, commentOutput, createCaseComment, listCaseComments } from "../services/caseComments.js";
import { caseFieldReadScopeSchema } from "../services/caseFieldReadScope.js";
export const caseCommentsRouter = router({
  list: protectedProcedure.input(commentListInput).output(z.object({ projectId: z.string(), caseId: z.string(), readScope: caseFieldReadScopeSchema, items: z.array(commentOutput).max(50), nextCursor: z.object({ id: z.string().uuid(), createdAt: z.date() }).nullable() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return listCaseComments(ctx.prisma, ctx.user.id, input, { clerkActorId: ctx.user.clerkUserId });
    }),
  create: protectedProcedure.input(commentCreateInput).output(commentOutput.extend({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return createCaseComment(ctx.prisma, ctx.user.id, input, { clerkActorId: ctx.user.clerkUserId });
    }),
});
