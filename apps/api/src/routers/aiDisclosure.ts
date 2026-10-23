import { protectedProcedure, router } from "../trpc.js";
import {
  aiAdminScope,
  aiClassificationInput,
  aiIssueInput,
  aiGrantChangeInput,
  aiRotateInput,
  readAiSettings,
  classifyAiProject,
  issueAiGrant,
  changeAiGrant,
} from "../services/aiDisclosureAdmin.js";

export const aiDisclosureRouter = router({
  settings: protectedProcedure
    .input(aiAdminScope)
    .query(({ ctx, input }) => readAiSettings(ctx, input)),
  classify: protectedProcedure
    .input(aiClassificationInput)
    .mutation(({ ctx, input }) => classifyAiProject(ctx, input)),
  issue: protectedProcedure
    .input(aiIssueInput)
    .mutation(({ ctx, input }) => issueAiGrant(ctx, input)),
  rotate: protectedProcedure
    .input(aiRotateInput)
    .mutation(({ ctx, input }) => changeAiGrant(ctx, input, true)),
  revoke: protectedProcedure
    .input(aiGrantChangeInput)
    .mutation(({ ctx, input }) => changeAiGrant(ctx, input, false)),
});
