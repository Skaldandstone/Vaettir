import { router } from "./trpc.js";
import { testCasesRouter } from "./routers/testCases.js";
import { testPlansRouter } from "./routers/testPlans.js";
import { agentRouter } from "./routers/agent.js";
import { organizationRouter } from "./routers/organization.js";
import { projectRouter } from "./routers/project.js";

export const appRouter = router({
  testCases: testCasesRouter,
  testPlans: testPlansRouter,
  agent: agentRouter,
  organization: organizationRouter,
  project: projectRouter,
});

export type AppRouter = typeof appRouter;
