import { protectedProcedure, router } from "../trpc.js";
import {
  placementAccessInput,
  placementAccessOutput,
  placementPreviewInput,
  placementPreviewOutput,
  placementMoveInput,
  placementMoveAck,
} from "../services/casePlacementReviewedSchema.js";
import {
  accessReviewedCasePlacement,
  previewReviewedCasePlacement,
  moveReviewedCasePlacement,
} from "../services/casePlacementReviewed.js";
export const casePlacementReviewedRouter = router({
  access: protectedProcedure
    .input(placementAccessInput)
    .output(placementAccessOutput)
    .query(({ ctx, input }) =>
      accessReviewedCasePlacement(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      }),
    ),
  preview: protectedProcedure
    .input(placementPreviewInput)
    .output(placementPreviewOutput)
    .query(({ ctx, input }) =>
      previewReviewedCasePlacement(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      }),
    ),
  move: protectedProcedure
    .input(placementMoveInput)
    .output(placementMoveAck)
    .mutation(({ ctx, input }) =>
      moveReviewedCasePlacement(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      }),
    ),
});
