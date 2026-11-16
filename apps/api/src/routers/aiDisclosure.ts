import { protectedProcedure, router } from "../trpc.js";
import { aiCasePreviewInput, aiCaseIssueInput, aiCasePickerInput, listAiCaseChoices, previewAiCases, issueAiCaseGrant } from "../services/aiCaseDisclosureAdmin.js";
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
  caseChoices: protectedProcedure.input(aiCasePickerInput).query(({ ctx, input }) => listAiCaseChoices(ctx, input)),
  previewCases: protectedProcedure.input(aiCasePreviewInput).query(({ ctx, input }) => previewAiCases(ctx, input)),
  issueCases: protectedProcedure.input(aiCaseIssueInput).mutation(({ ctx, input }) => issueAiCaseGrant(ctx, input)),
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
