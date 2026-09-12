import "./instrument.js";
import * as Sentry from "@sentry/node";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { createContext } from "./trpc.js";
import { startReverseEngineerJobPoller, POLL_INTERVAL_MS as REVERSE_ENGINEER_POLL_MS } from "./jobs/reverseEngineerWorker.js";
import { startReadinessDigestScheduler, CHECK_INTERVAL_MS as DIGEST_CHECK_MS } from "./jobs/readinessDigestScheduler.js";
import { startAiCreditGrantScheduler, CHECK_INTERVAL_MS as CREDIT_GRANT_CHECK_MS } from "./jobs/aiCreditGrantScheduler.js";
import { startReadinessChangeScheduler, CHECK_INTERVAL_MS as READINESS_CHANGE_CHECK_MS } from "./jobs/readinessChangeScheduler.js";
import { verifyWebhookSignature } from "./services/githubApp.js";
import { handlePullRequestWebhook, type GithubPullRequestPayload } from "./services/githubWebhook.js";
import { verifyGitlabToken } from "./services/gitlabApi.js";
import { handleMergeRequestWebhook, type GitlabMergeRequestPayload } from "./services/gitlabWebhook.js";
import { getHeartbeatStatuses } from "./services/heartbeat.js";
import { getStripeRuntime } from "./services/stripeConfig.js";
import { handleStripeWebhookEvent } from "./services/stripeBilling.js";
import { exchangeGooglePlayCode } from "./services/productionSignalOAuth.js";
import { encryptToken } from "./services/tokenEncryption.js";

// P10-07: expected poller intervals, keyed by the same names each poller
// calls recordHeartbeat with - the one place server.ts needs to know
// about all four, so /health/detailed can flag one that's gone quiet.
const EXPECTED_POLLER_INTERVALS = {
  reverseEngineerWorker: REVERSE_ENGINEER_POLL_MS,
  readinessDigestScheduler: DIGEST_CHECK_MS,
  aiCreditGrantScheduler: CREDIT_GRANT_CHECK_MS,
  readinessChangeScheduler: READINESS_CHANGE_CHECK_MS,
};

// Deliberately separate from the plain `/health` liveness probe the ALB/
// ECS health check uses (never touch that one's contract - a transient DB
// blip cycling the whole task on every health-check poll would be worse
// than serving degraded for a moment). This is for an external uptime
// monitor to point at instead: real DB connectivity plus whether each
// in-process job poller has ticked recently. Always 200 with a body
// reporting `healthy: false` rather than ever 5xx-ing on its own
// dependency check - an uptime monitor should alert on the JSON payload,
// not misread "the detailed check itself broke" as "the whole API is down."
async function detailedHealthHandler() {
  let dbOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }
  const pollers = getHeartbeatStatuses(EXPECTED_POLLER_INTERVALS);
  const healthy = dbOk && pollers.every((p) => !p.stale);
  return { healthy, db: { ok: dbOk }, pollers };
}

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

// P6-07: GitLab's project webhooks don't sign the body at all - they send
// one static shared-secret token in a plain header (X-Gitlab-Token),
// checked as a direct string compare (see gitlabApi.ts's verifyGitlabToken)
// rather than an HMAC over exact raw bytes, so there's no need for the raw-
// body content-type parser registerGithubWebhookRoute above needs.
async function registerGitlabWebhookRoute(instance: FastifyInstance) {
  instance.post("/webhooks/gitlab", async (req, reply) => {
    const secret = process.env.GITLAB_WEBHOOK_SECRET ?? "";
    const token = req.headers["x-gitlab-token"] as string | undefined;
    if (!verifyGitlabToken(token, secret)) {
      return reply.code(401).send({ error: "invalid token" });
    }

    const payload = req.body as GitlabMergeRequestPayload;
    if (payload.object_kind !== "merge_request") {
      return reply.send({ handled: false, reason: `ignored object_kind: ${payload.object_kind}` });
    }

    const result = await handleMergeRequestWebhook(prisma, payload);
    return reply.send(result);
  });
}

// P12-05: same raw-body-preserving pattern as registerGithubWebhookRoute --
// stripe.webhooks.constructEvent needs the exact bytes Stripe signed, which
// Fastify's default JSON parser would re-serialize and break. A no-op route
// (200, handled: false) when billing isn't configured on this deployment at
// all, rather than 404/500 -- Stripe's own webhook-delivery retry/alerting
// shouldn't be confused by a deployment that simply never enabled billing.
async function registerStripeWebhookRoute(instance: FastifyInstance) {
  instance.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  instance.post("/webhooks/stripe", async (req, reply) => {
    const runtime = getStripeRuntime();
    if (!runtime) return reply.send({ handled: false, reason: "billing not configured" });

    const signature = req.headers["stripe-signature"] as string | undefined;
    if (!signature) return reply.code(400).send({ error: "missing stripe-signature header" });

    let event;
    try {
      event = runtime.stripe.webhooks.constructEvent(req.body as Buffer, signature, runtime.webhookSecret);
    } catch (err) {
      return reply.code(400).send({ error: `invalid signature: ${err instanceof Error ? err.message : String(err)}` });
    }

    const result = await handleStripeWebhookEvent(prisma, event);
    return reply.send(result);
  });
}

// SSE-180: the one genuinely new kind of route in this codebase - a
// browser-facing OAuth redirect target, not a tRPC mutation and not a
// server-to-server webhook. GOOGLE_PLAY only; Apple has no equivalent
// redirect flow (see productionSignalOAuth.ts's file comment). The
// connection row is looked up purely by its one-time `state` value (the
// CSRF guard every OAuth flow needs) rather than requiring an authenticated
// session on this route - Google's redirect back to our own domain isn't
// guaranteed to carry the original browser's Clerk session cookie, and
// possession of the exact state value this server generated and handed out
// moments earlier during startGooglePlayConnect is the actual security
// boundary here. Always responds 200 (even on failure) with enough
// information to show the customer what happened, redirecting into the web
// app when WEB_APP_URL is configured for this deployment.
async function registerProductionSignalOAuthRoute(instance: FastifyInstance) {
  instance.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/oauth/production-signals/google-play/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;
      const webAppUrl = process.env.WEB_APP_URL;

      function finish(projectId: string | null, status: "connected" | "error", message?: string) {
        if (webAppUrl && projectId) {
          const target = new URL(`/projects/${projectId}/production-signals`, webAppUrl);
          target.searchParams.set("googlePlay", status);
          if (message) target.searchParams.set("message", message);
          return reply.redirect(target.toString());
        }
        return reply.send({ status, message });
      }

      if (error) return finish(null, "error", error);
      if (!code || !state) return reply.code(400).send({ error: "missing code or state" });

      const connection = await prisma.productionSignalConnection.findUnique({ where: { oauthState: state } });
      if (!connection || connection.provider !== "GOOGLE_PLAY") {
        return reply.code(400).send({ error: "unknown or expired connection state" });
      }

      try {
        const tokens = await exchangeGooglePlayCode(code);
        const encrypted = encryptToken(JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }));
        await prisma.productionSignalConnection.update({
          where: { id: connection.id },
          data: {
            status: "CONNECTED",
            encryptedCredentials: encrypted.ciphertext,
            credentialsIv: encrypted.iv,
            credentialsAuthTag: encrypted.authTag,
            scope: tokens.scope,
            oauthState: null, // one-time use - never valid again after this callback
            connectedAt: new Date(),
            lastSyncError: null,
          },
        });
        return finish(connection.projectId, "connected");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await prisma.productionSignalConnection.update({
          where: { id: connection.id },
          data: { status: "ERROR", oauthState: null, lastSyncError: message },
        });
        return finish(connection.projectId, "error", message);
      }
    },
  );
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

// P10-05: catches anything thrown by a raw (non-tRPC) route handler, e.g.
// the GitHub webhook route below - tRPC procedure errors are reported
// separately via trpcOptions.onError, since Fastify's error handler never
// sees those (the tRPC adapter catches them itself).
server.setErrorHandler((error: FastifyError, request, reply) => {
  Sentry.captureException(error);
  request.log.error(error);
  reply.status(error.statusCode ?? 500).send({ error: error.message });
});

// Only INTERNAL_SERVER_ERROR is an actual bug worth alerting on - expected
// client errors (UNAUTHORIZED/FORBIDDEN/BAD_REQUEST/NOT_FOUND/etc, thrown
// deliberately throughout every router as normal control flow) would
// otherwise flood Sentry with noise that isn't a real incident.
function reportUnexpectedTrpcError({ error }: { error: { code: string; cause?: unknown } }) {
  if (error.code === "INTERNAL_SERVER_ERROR") {
    Sentry.captureException(error.cause ?? error);
  }
}

await server.register(cors, { origin: true });

// P10-04: coarse per-IP flood protection at the HTTP layer, distinct from
// (and a layer below) the AI reverse-engineering endpoint's existing
// per-org business-logic limits (P2-09's 200 jobs/hour, P12-10's credit
// metering) - this guards the whole server against raw request-flooding,
// not just AI-call cost. Generous enough for a real browser session:
// tRPC's httpBatchLink can fire several batched requests in quick
// succession as a page mounts several queries at once.
await server.register(rateLimit, { max: 300, timeWindow: "1 minute" });

await server.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: {
    router: appRouter,
    createContext,
    onError: reportUnexpectedTrpcError,
  },
});

server.get("/health", { config: { rateLimit: false } }, async () => ({ ok: true }));
server.get("/health/detailed", { config: { rateLimit: false } }, async () => detailedHealthHandler());
await server.register(registerGithubWebhookRoute);
await server.register(registerGitlabWebhookRoute);
await server.register(registerStripeWebhookRoute);
await server.register(registerProductionSignalOAuthRoute);

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
      trpcOptions: { router: appRouter, createContext, onError: reportUnexpectedTrpcError },
    });
    instance.get("/health", { config: { rateLimit: false } }, async () => ({ ok: true }));
    instance.get("/health/detailed", { config: { rateLimit: false } }, async () => detailedHealthHandler());
    await instance.register(registerGithubWebhookRoute);
    await instance.register(registerGitlabWebhookRoute);
    await instance.register(registerStripeWebhookRoute);
    await instance.register(registerProductionSignalOAuthRoute);
  },
  { prefix: "/api" },
);

const port = Number(process.env.API_PORT ?? 4000);
server
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    server.log.info(`vaettir API listening on :${port}`);
    startReverseEngineerJobPoller();
    startReadinessDigestScheduler();
    startAiCreditGrantScheduler();
    startReadinessChangeScheduler();
  })
  .catch((err) => {
    server.log.error(err);
    process.exit(1);
  });
