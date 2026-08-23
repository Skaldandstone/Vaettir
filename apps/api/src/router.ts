import { router } from "./trpc.js";
import { testCasesRouter } from "./routers/testCases.js";
import { testPlansRouter } from "./routers/testPlans.js";
import { agentRouter } from "./routers/agent.js";

export const appRouter = router({
  testCases: testCasesRouter,
  testPlans: testPlansRouter,
  agent: agentRouter,
});

export type AppRouter = typeof appRouter;
