import Fastify from "fastify";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./router.js";
import { createContext } from "./trpc.js";
import { startReverseEngineerJobPoller } from "./jobs/reverseEngineerWorker.js";

// tRPC's httpBatchLink joins every query fired in the same tick into one
// path segment of comma-joined procedure names (e.g.
// "project.byId,releases.byId,releases.readiness,..."), which routinely
// exceeds find-my-way's 100-char default per-param length as pages grow
// past a handful of parallel queries.
const server = Fastify({ logger: true, maxParamLength: 5000 });

await server.register(cors, { origin: true });

await server.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: {
    router: appRouter,
    createContext,
  },
});

server.get("/health", async () => ({ ok: true }));

// Mirrored under /api: the ALB/CloudFront path in front of this service
// routes only /api/* here (the same domain also serves apps/web), so
// external traffic needs these same routes reachable with that prefix.
// The unprefixed routes above stay too -- ECS target-group health checks
// hit the task's IP:port directly, bypassing the ALB rule entirely.
await server.register(
  async (instance) => {
    await instance.register(fastifyTRPCPlugin, {
      prefix: "/trpc",
      trpcOptions: { router: appRouter, createContext },
    });
    instance.get("/health", async () => ({ ok: true }));
  },
  { prefix: "/api" },
);

const port = Number(process.env.API_PORT ?? 4000);
server
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    server.log.info(`vaettir API listening on :${port}`);
    startReverseEngineerJobPoller();
  })
  .catch((err) => {
    server.log.error(err);
    process.exit(1);
  });
