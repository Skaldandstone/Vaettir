import { z } from "zod";
import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import { commentAccessInput, commentAccessOutput, readCaseCommentAccess, commentCreateInput, commentListInput, commentOutput, createCaseComment, listCaseComments } from "../services/caseComments.js";
import { caseFieldReadScopeSchema } from "../services/caseFieldReadScope.js";
export const caseCommentsRouter = router({
  access: protectedProcedure.input(commentAccessInput).output(commentAccessOutput)
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return readCaseCommentAccess(ctx.prisma, ctx.user.id, input, { clerkActorId: ctx.user.clerkUserId });
    }),
  list: protectedProcedure.input(commentListInput).output(z.object({ projectId: z.string(), caseId: z.string(), readScope: caseFieldReadScopeSchema, readRequestId: z.string().uuid().optional(), items: z.array(commentOutput).max(50), nextCursor: z.object({ id: z.string().uuid(), createdAt: z.date() }).nullable() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return listCaseComments(ctx.prisma, ctx.user.id, input, { clerkActorId: ctx.user.clerkUserId });
    }),
  create: protectedProcedure.input(commentCreateInput).output(commentOutput.extend({ projectId: z.string(), caseId: z.string(), readScope: caseFieldReadScopeSchema, requestId: z.string().uuid(), requestHash: z.string().regex(/^[a-f0-9]{64}$/) }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return createCaseComment(ctx.prisma, ctx.user.id, input, { clerkActorId: ctx.user.clerkUserId });
    }),
});
