import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { requirementCoverageListInput, requirementCoverageCasesInput, requirementCoverageEvidenceInput } from "../services/requirementCoverageSchema.js";
import { withRequirementCoverageAccess, requirementCoverageList, requirementCoverageCases, requirementCoverageEvidence } from "../services/requirementCoverage.js";
import { requirementCoverageExportInput, requirementCoverageExportOutput } from "../services/requirementCoverageExportSchema.js";
import { requirementCoverageExport } from "../services/requirementCoverageExport.js";
export const requirementCoverageRouter = router({
  list: protectedProcedure.input(requirementCoverageListInput).query(async ({ ctx, input }) => {
    const { project } = await requireProjectAccess(ctx, input.projectId);
    return withRequirementCoverageAccess(ctx.prisma, input, ctx.user.id, project.organizationId,
      async (tx, scope) => ({ ...(await requirementCoverageList(tx, scope.organizationId, input)), ...scope }), ctx.user.clerkUserId);
  }),
  cases: protectedProcedure.input(requirementCoverageCasesInput).query(async ({ ctx, input }) => {
    const { project } = await requireProjectAccess(ctx, input.projectId);
    return withRequirementCoverageAccess(ctx.prisma, input, ctx.user.id, project.organizationId,
      async (tx, scope) => ({ ...(await requirementCoverageCases(tx, scope.organizationId, input)), ...scope }), ctx.user.clerkUserId);
  }),
  evidence: protectedProcedure.input(requirementCoverageEvidenceInput).query(async ({ ctx, input }) => {
    const { project } = await requireProjectAccess(ctx, input.projectId);
    return withRequirementCoverageAccess(ctx.prisma, input, ctx.user.id, project.organizationId,
      async (tx, scope) => ({ ...(await requirementCoverageEvidence(tx, scope.organizationId, input)), ...scope }), ctx.user.clerkUserId);
  }),
  exportMatrix: protectedProcedure.input(requirementCoverageExportInput).output(requirementCoverageExportOutput).query(async ({ ctx, input }) => {
    const { project } = await requireProjectAccess(ctx, input.projectId);
    return withRequirementCoverageAccess(ctx.prisma, input, ctx.user.id, project.organizationId,
      (tx, scope) => requirementCoverageExport(tx, scope, input), ctx.user.clerkUserId);
  }),
});
