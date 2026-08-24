import Fastify from "fastify";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./router.js";
import { createContext } from "./trpc.js";
import { startReverseEngineerJobPoller } from "./jobs/reverseEngineerWorker.js";

const server = Fastify({ logger: true });

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
    server.log.info(`test-case-intelligence API listening on :${port}`);
    startReverseEngineerJobPoller();
  })
  .catch((err) => {
    server.log.error(err);
    process.exit(1);
  });
