import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import { casePriorityInput, setCasePriority } from "../services/casePriority.js";
export const casePriorityRouter = router({
  set: protectedProcedure.input(casePriorityInput).mutation(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId, "EDITOR");
    return setCasePriority(ctx.prisma, ctx.user.id, input, { clerkActorId: ctx.user.clerkUserId });
  }),
});
