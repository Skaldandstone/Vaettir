import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import { reviewReadInput, reviewAccessOutput, reviewCountOutput, reviewPageInput, reviewPageOutput, reviewPreviewInput, reviewPreviewOutput, reviewDecisionInput, reviewDecisionOutput } from "../services/caseReviewSchema.js";
import { readCaseReviewAccess, countCaseReviewQueue, pageCaseReviewQueue, previewCaseReview, decideCaseReview } from "../services/caseReview.js";
export const caseReviewRouter = router({
  access: protectedProcedure.input(reviewReadInput).output(reviewAccessOutput).query(async ({ ctx,input }) => { await requireProjectAccess(ctx,input.projectId); return readCaseReviewAccess(ctx.prisma,ctx.user.id,input,{ clerkActorId: ctx.user.clerkUserId }); }),
  count: protectedProcedure.input(reviewReadInput).output(reviewCountOutput).query(async ({ ctx,input }) => { await requireProjectAccess(ctx,input.projectId); return countCaseReviewQueue(ctx.prisma,ctx.user.id,input,{ clerkActorId: ctx.user.clerkUserId }); }),
  page: protectedProcedure.input(reviewPageInput).output(reviewPageOutput).query(async ({ ctx,input }) => { await requireProjectAccess(ctx,input.projectId); return pageCaseReviewQueue(ctx.prisma,ctx.user.id,input,{ clerkActorId: ctx.user.clerkUserId }); }),
  preview: protectedProcedure.input(reviewPreviewInput).output(reviewPreviewOutput).query(async ({ ctx,input }) => { await requireProjectAccess(ctx,input.projectId); return previewCaseReview(ctx.prisma,ctx.user.id,input,{ clerkActorId: ctx.user.clerkUserId }); }),
  decide: protectedProcedure.input(reviewDecisionInput).output(reviewDecisionOutput).mutation(async ({ ctx,input }) => { await requireProjectAccess(ctx,input.projectId,"EDITOR"); return decideCaseReview(ctx.prisma,ctx.user.id,input,{ clerkActorId: ctx.user.clerkUserId }); }),
});
