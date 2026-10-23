import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import { caseFieldPresentationGetInput, caseFieldPresentationConfigureInput, caseFieldPresentationStateOutput, caseFieldPresentationWriteOutput, getCaseFieldPresentation, configureCaseFieldPresentation } from "../services/caseFieldPresentation.js";

/** Standalone route; root coordinator registers it after review. */
export const caseFieldPresentationRouter = router({
  get: protectedProcedure.input(caseFieldPresentationGetInput).output(caseFieldPresentationStateOutput).query(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId);
    return getCaseFieldPresentation(ctx.prisma, ctx.user.id, input, { clerkActorId: ctx.user.clerkUserId });
  }),
  configure: protectedProcedure.input(caseFieldPresentationConfigureInput).output(caseFieldPresentationWriteOutput).mutation(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId, "ADMIN");
    return configureCaseFieldPresentation(ctx.prisma, ctx.user.id, input, { clerkActorId: ctx.user.clerkUserId });
  }),
});
