import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { createContext } from "./trpc.js";
import { startReverseEngineerJobPoller } from "./jobs/reverseEngineerWorker.js";
import { verifyWebhookSignature } from "./services/githubApp.js";
import { handlePullRequestWebhook, type GithubPullRequestPayload } from "./services/githubWebhook.js";

// P6-01: registered in its own encapsulation context so the raw-body content
// type parser below applies ONLY to this route, not to tRPC's JSON bodies
// elsewhere on the server. Signature verification (verifyWebhookSignature)
// needs the exact raw bytes GitHub sent -- Fastify's default JSON parser
// re-serializes into an object, which can change byte-for-byte content
// (key order, whitespace) and break the HMAC comparison.
async function registerGithubWebhookRoute(instance: FastifyInstance) {
  instance.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  instance.post("/webhooks/github", async (req, reply) => {
    const rawBody = req.body as Buffer;
    const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    if (!verifyWebhookSignature(rawBody, signature, secret)) {
      return reply.code(401).send({ error: "invalid signature" });
    }

    const event = req.headers["x-github-event"] as string | undefined;
    if (event !== "pull_request") {
      return reply.send({ handled: false, reason: `ignored event: ${event ?? "unknown"}` });
    }

    const payload = JSON.parse(rawBody.toString("utf8")) as GithubPullRequestPayload;
    const result = await handlePullRequestWebhook(prisma, payload);
    return reply.send(result);
  });
}

// tRPC's httpBatchLink joins every query fired in the same tick into one
// path segment of comma-joined procedure names (e.g.
// "project.byId,releases.byId,releases.readiness,..."), which routinely
// exceeds find-my-way's 100-char default per-param length as pages grow
// past a handful of parallel queries.
//
// bodyLimit raised from Fastify's 1MB default: P2-11's zip upload sends a
// base64-encoded archive (up to 10MB raw, ~33% larger base64-encoded) as a
// single mutation input, well past the default.
const server = Fastify({ logger: true, maxParamLength: 5000, bodyLimit: 15 * 1024 * 1024 });

await server.register(cors, { origin: true });

await server.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: {
    router: appRouter,
    createContext,
  },
});

server.get("/health", async () => ({ ok: true }));
await server.register(registerGithubWebhookRoute);

// Mirrored under /api: the ALB/CloudFront path in front of this service
// routes only /api/* here (the same domain also serves apps/web), so
// external traffic needs these same routes reachable with that prefix.
// The unprefixed routes above stay too -- ECS target-group health checks
// hit the task's IP:port directly, bypassing the ALB rule entirely.
// GitHub's webhook delivery hits the /api-prefixed path (same ALB rule as
// everything else this App needs to reach); the unprefixed one above stays
// mainly for local testing without going through the ALB.
await server.register(
  async (instance) => {
    await instance.register(fastifyTRPCPlugin, {
      prefix: "/trpc",
      trpcOptions: { router: appRouter, createContext },
    });
    instance.get("/health", async () => ({ ok: true }));
    await instance.register(registerGithubWebhookRoute);
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
