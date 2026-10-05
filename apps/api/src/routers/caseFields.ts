import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import {
  caseFieldScope,
  caseFieldStateOutput,
  caseFieldSchemaReview,
  caseFieldSchemaApproval,
  caseFieldValueSave,
  caseFieldImpactOutput,
  caseFieldWriteOutput,
  getCaseFields,
  reviewCaseFieldSchema,
  configureCaseFields,
  saveCaseFields,
} from "../services/caseFields.js";
import {
  fieldHistoryListInput,
  fieldHistoryListOutput,
  fieldHistoryPreviewInput,
  fieldHistoryPreviewOutput,
  fieldHistoryRestoreInput,
  listCaseFieldHistory,
  previewCaseFieldHistory,
  restoreCaseFieldHistory,
} from "../services/caseFieldHistory.js";
export const caseFieldsRouter = router({
  history: protectedProcedure
    .input(fieldHistoryListInput)
    .output(fieldHistoryListOutput)
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return listCaseFieldHistory(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
  previewRestore: protectedProcedure
    .input(fieldHistoryPreviewInput)
    .output(fieldHistoryPreviewOutput)
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return previewCaseFieldHistory(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
  restore: protectedProcedure
    .input(fieldHistoryRestoreInput)
    .output(caseFieldWriteOutput)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return restoreCaseFieldHistory(ctx.prisma, ctx.user.id, input);
    }),
  get: protectedProcedure
    .input(caseFieldScope)
    .output(caseFieldStateOutput)
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return getCaseFields(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
  reviewSchema: protectedProcedure
    .input(caseFieldSchemaReview)
    .output(caseFieldImpactOutput)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "ADMIN");
      return reviewCaseFieldSchema(ctx.prisma, ctx.user.id, input);
    }),
  configure: protectedProcedure
    .input(caseFieldSchemaApproval)
    .output(caseFieldWriteOutput)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "ADMIN");
      return configureCaseFields(ctx.prisma, ctx.user.id, input);
    }),
  save: protectedProcedure
    .input(caseFieldValueSave)
    .output(caseFieldWriteOutput)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return saveCaseFields(ctx.prisma, ctx.user.id, input);
    }),
});
