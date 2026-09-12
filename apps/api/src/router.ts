import { router } from "./trpc.js";
import { testCasesRouter } from "./routers/testCases.js";
import { testPlansRouter } from "./routers/testPlans.js";
import { agentRouter } from "./routers/agent.js";
import { organizationRouter } from "./routers/organization.js";
import { projectRouter } from "./routers/project.js";
import { requirementsRouter } from "./routers/requirements.js";
import { riskAnalysisRouter } from "./routers/riskAnalysis.js";
import { releasesRouter } from "./routers/releases.js";
import { searchRouter } from "./routers/search.js";
import { apiKeysRouter } from "./routers/apiKeys.js";
import { complianceRouter } from "./routers/compliance.js";
import { auditLogRouter } from "./routers/auditLog.js";
import { testRunsRouter } from "./routers/testRuns.js";
import { coverageRouter } from "./routers/coverage.js";
import { healingSuggestionsRouter } from "./routers/healingSuggestions.js";
import { adminRouter } from "./routers/admin.js";
import { webhooksRouter } from "./routers/webhooks.js";
import { manualExecutionRouter } from "./routers/manualExecution.js";
import { sharedStepGroupsRouter } from "./routers/sharedStepGroups.js";
import { testCaseAttachmentsRouter } from "./routers/testCaseAttachments.js";
import { exploratorySessionsRouter } from "./routers/exploratorySessions.js";
import { testCaseDatasetsRouter } from "./routers/testCaseDatasets.js";
import { importJobsRouter } from "./routers/importJobs.js";
import { staffRouter } from "./routers/staff.js";
import { userRouter } from "./routers/user.js";
import { betaRouter } from "./routers/beta.js";
import { liveAppGenerationRouter } from "./routers/liveAppGeneration.js";
import { productionSignalsRouter } from "./routers/productionSignals.js";

export const appRouter = router({
  beta: betaRouter,
  testCases: testCasesRouter,
  testPlans: testPlansRouter,
  agent: agentRouter,
  organization: organizationRouter,
  project: projectRouter,
  requirements: requirementsRouter,
  riskAnalysis: riskAnalysisRouter,
  releases: releasesRouter,
  search: searchRouter,
  apiKeys: apiKeysRouter,
  compliance: complianceRouter,
  auditLog: auditLogRouter,
  testRuns: testRunsRouter,
  coverage: coverageRouter,
  healingSuggestions: healingSuggestionsRouter,
  admin: adminRouter,
  webhooks: webhooksRouter,
  manualExecution: manualExecutionRouter,
  sharedStepGroups: sharedStepGroupsRouter,
  testCaseAttachments: testCaseAttachmentsRouter,
  exploratorySessions: exploratorySessionsRouter,
  testCaseDatasets: testCaseDatasetsRouter,
  importJobs: importJobsRouter,
  staff: staffRouter,
  user: userRouter,
  liveAppGeneration: liveAppGenerationRouter,
  productionSignals: productionSignalsRouter,
});

export type AppRouter = typeof appRouter;
