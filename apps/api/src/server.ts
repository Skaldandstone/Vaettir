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
