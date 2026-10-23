import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import {
  caseQueryExportInput,
  approvedCaseQueryExportInput,
} from "../services/caseQueryExportSchema.js";
import {
  withCaseQueryExportAccess,
  reviewCaseQueryExport,
  confirmCaseQueryExport,
} from "../services/caseQueryExport.js";
export function createCaseQueryExportRouter(
  env: NodeJS.ProcessEnv = process.env,
) {
  return router({
    review: protectedProcedure
      .input(caseQueryExportInput)
      .query(async ({ ctx, input }) => {
        const { project } = await requireProjectAccess(
          ctx,
          input.projectId,
          "VIEWER",
        );
        return withCaseQueryExportAccess(
          ctx.prisma,
          ctx.user.id,
          input.projectId,
          project.organizationId,
          (tx) =>
            reviewCaseQueryExport(
              tx,
              input,
              ctx.user.id,
              project.organizationId,
              env,
            ),
        );
      }),
    confirm: protectedProcedure
      .input(approvedCaseQueryExportInput)
      .mutation(async ({ ctx, input }) => {
        const { project } = await requireProjectAccess(
          ctx,
          input.projectId,
          "VIEWER",
        );
        if (input.organizationId !== project.organizationId)
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Original organization changed; review the query export again.",
          });
        return withCaseQueryExportAccess(
          ctx.prisma,
          ctx.user.id,
          input.projectId,
          project.organizationId,
          (tx) =>
            confirmCaseQueryExport(
              tx,
              input,
              ctx.user.id,
              project.organizationId,
              env,
            ),
        );
      }),
  });
}
export const caseQueryExportRouter = createCaseQueryExportRouter();
