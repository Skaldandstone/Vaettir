import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import {
  procedureReimportInput,
  procedureReimportApproval,
  procedureReimportPreviewOutput,
  procedureReimportResult,
  previewProcedureReimport,
  approveProcedureReimport,
} from "../services/caseProcedureReimport.js";
export const caseProcedureReimportRouter = router({
  preview: protectedProcedure
    .input(procedureReimportInput)
    .output(procedureReimportPreviewOutput)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return previewProcedureReimport(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
  approve: protectedProcedure
    .input(procedureReimportApproval)
    .output(procedureReimportResult)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return approveProcedureReimport(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
});
