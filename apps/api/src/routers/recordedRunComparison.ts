import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import {
  recordedRunListInput,
  recordedRunListOutput,
  recordedRunComparisonInput,
  recordedRunComparisonOutput,
} from "../services/recordedRunComparisonSchema.js";
import {
  withRecordedRunAccess,
  listRecordedRuns,
  compareRecordedRuns,
} from "../services/recordedRunComparison.js";
export const recordedRunComparisonRouter = router({
  runs: protectedProcedure
    .input(recordedRunListInput)
    .output(recordedRunListOutput)
    .query(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(
        ctx,
        input.projectId,
        "VIEWER",
      );
      return withRecordedRunAccess(
        ctx.prisma,
        ctx.user.id,
        input.projectId,
        project.organizationId,
        (tx) => listRecordedRuns(tx, input),
        { originalOrganizationId: input.originalOrganizationId, expectedClerkActorId: input.expectedClerkActorId, verifiedClerkActorId: ctx.user.clerkUserId },
      );
    }),
  compare: protectedProcedure
    .input(recordedRunComparisonInput)
    .output(recordedRunComparisonOutput)
    .query(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(
        ctx,
        input.projectId,
        "VIEWER",
      );
      return withRecordedRunAccess(
        ctx.prisma,
        ctx.user.id,
        input.projectId,
        project.organizationId,
        (tx) =>
          compareRecordedRuns(tx, input, ctx.user.id, project.organizationId),
        { originalOrganizationId: input.originalOrganizationId, expectedClerkActorId: input.expectedClerkActorId, verifiedClerkActorId: ctx.user.clerkUserId },
      );
    }),
});
