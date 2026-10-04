import { protectedProcedure, router } from "../trpc.js";
import {
  caseAuthoringPresetReview,
  caseAuthoringPresetApproval,
  caseAuthoringPresetScope,
  caseAuthoringPresetPrefill,
  caseAuthoringPresetCatalogScope,
} from "../services/caseAuthoringPresetSchema.js";
import {
  listCaseAuthoringPresets,
  getCaseAuthoringPreset,
  previewCaseAuthoringPreset,
  writeCaseAuthoringPreset,
  listCaseAuthoringPresetHistory,
  reviewCaseAuthoringPresetPrefill,
  confirmCaseAuthoringPresetPrefill,
} from "../services/caseAuthoringPresets.js";
export const caseAuthoringPresetsRouter = router({
  list: protectedProcedure
    .input(caseAuthoringPresetCatalogScope)
    .query(({ ctx, input }) =>
      listCaseAuthoringPresets(ctx.prisma, ctx.user.id, input.projectId, input.expectedScope),
    ),
  get: protectedProcedure
    .input(caseAuthoringPresetScope)
    .query(({ ctx, input }) =>
      getCaseAuthoringPreset(ctx.prisma, ctx.user.id, input),
    ),
  preview: protectedProcedure
    .input(caseAuthoringPresetReview)
    .query(({ ctx, input }) =>
      previewCaseAuthoringPreset(ctx.prisma, ctx.user.id, input),
    ),
  write: protectedProcedure
    .input(caseAuthoringPresetApproval)
    .mutation(({ ctx, input }) =>
      writeCaseAuthoringPreset(ctx.prisma, ctx.user.id, input),
    ),
  history: protectedProcedure
    .input(caseAuthoringPresetScope)
    .query(({ ctx, input }) =>
      listCaseAuthoringPresetHistory(ctx.prisma, ctx.user.id, input),
    ),
  reviewPrefill: protectedProcedure
    .input(caseAuthoringPresetScope)
    .query(({ ctx, input }) =>
      reviewCaseAuthoringPresetPrefill(ctx.prisma, ctx.user.id, input),
    ),
  confirmPrefill: protectedProcedure
    .input(caseAuthoringPresetPrefill)
    .mutation(({ ctx, input }) =>
      confirmCaseAuthoringPresetPrefill(ctx.prisma, ctx.user.id, input),
    ),
});
