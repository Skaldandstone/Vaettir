import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import {
  cloneScopeSchema,
  cloneInputSchema,
  previewCaseClone,
  cloneCase,
} from "../services/caseClone.js";
export const caseCloneRouter = router({
  preview: protectedProcedure
    .input(cloneScopeSchema)
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return previewCaseClone(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
  create: protectedProcedure
    .input(cloneInputSchema)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return cloneCase(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
});
