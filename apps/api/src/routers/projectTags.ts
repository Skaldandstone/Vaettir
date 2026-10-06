import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import { readProjectTagPage } from "../services/projectTags.js";
import {
  projectTagPageInput,
  projectTagPageOutput,
} from "../services/projectTagsSchema.js";

// Read-only foundation. Central mounting is owned by the root coordinator.
export const projectTagsRouter = router({
  page: protectedProcedure
    .input(projectTagPageInput)
    .output(projectTagPageOutput)
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return readProjectTagPage(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
});
