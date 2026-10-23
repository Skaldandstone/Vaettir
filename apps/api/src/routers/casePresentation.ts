import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import { casePresentationGetInput, casePresentationConfigureInput, casePresentationStateOutput, casePresentationWriteOutput, getCasePresentation, configureCasePresentation } from "../services/casePresentation.js";
export const casePresentationRouter = router({
  get: protectedProcedure.input(casePresentationGetInput).output(casePresentationStateOutput).query(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId);
    return getCasePresentation(ctx.prisma, ctx.user.id, input, { clerkActorId: ctx.user.clerkUserId });
  }),
  configure: protectedProcedure.input(casePresentationConfigureInput).output(casePresentationWriteOutput).mutation(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId, "ADMIN");
    return configureCasePresentation(ctx.prisma, ctx.user.id, input, { clerkActorId: ctx.user.clerkUserId });
  }),
});
