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

export const appRouter = router({
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
});

export type AppRouter = typeof appRouter;
