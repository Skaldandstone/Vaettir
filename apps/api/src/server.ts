import "./validateProductionReleaseIdentity.js";
import "./resolveDatabaseUrl.js";
import "./instrument.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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
import { handleGooglePlayOAuthCallback } from "./services/googlePlayOAuthCallback.js";
import { verifyPagerDutySignature, handlePagerDutyWebhook, type PagerDutyWebhookPayload } from "./services/pagerdutyWebhook.js";
import { verifyLinearSignature, type LinearWebhookPayload } from "./services/linearApi.js";
import { handleLinearWebhook } from "./services/linearWebhook.js";
import { verifyJiraWebhookSecret, type JiraWebhookPayload } from "./services/jiraApi.js";
import { handleJiraWebhook } from "./services/jiraWebhook.js";
import { verifyDatadogWebhookSecret, handleDatadogWebhook, type DatadogWebhookPayload } from "./services/datadogWebhook.js";
import { getReleaseIdentity } from "./releaseIdentity.js";
import { publicHttpErrorMessage } from "./publicErrors.js";
import { createCorsOriginPolicy } from "./corsPolicy.js";

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
  return { healthy, db: { ok: dbOk }, pollers, release: getReleaseIdentity() };
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

// P9-04: same raw-body-preserving pattern as registerGithubWebhookRoute -
// PagerDuty's HMAC signature needs the exact bytes it signed, which
// Fastify's default JSON parser would re-serialize and break. Always 200
// (even when unhandled) - PagerDuty's own webhook delivery retry/alerting
// shouldn't be confused by a deployment that simply hasn't configured this
// service, or by an event type this pass doesn't act on.
async function registerPagerDutyWebhookRoute(instance: FastifyInstance) {
  instance.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  instance.post("/webhooks/pagerduty", async (req, reply) => {
    const secret = process.env.PAGERDUTY_WEBHOOK_SECRET;
    if (!secret) return reply.send({ handled: false, reason: "PagerDuty integration not configured on this deployment" });

    const rawBody = req.body as Buffer;
    const signature = req.headers["x-pagerduty-signature"] as string | undefined;
    if (!verifyPagerDutySignature(rawBody, signature, secret)) {
      return reply.code(401).send({ error: "invalid signature" });
    }

    const payload = JSON.parse(rawBody.toString("utf8")) as PagerDutyWebhookPayload;
    const result = await handlePagerDutyWebhook(prisma, payload);
    return reply.send(result);
  });
}

// P9-02: routed per-org via a path param, not a shared secret+payload-
// match like PagerDuty's route above - Linear's webhook payload carries
// nothing that identifies which Vaettir org it belongs to, and (unlike
// PagerDuty/GitHub/Stripe, where Vaettir has one shared platform-level
// credential) each customer org configures its own Linear webhook, with
// its own signing secret, pointed at its own URL - the same per-org-URL
// shape Organization.slackWebhookUrl already uses. Always 200 even when
// unhandled or the org has no secret configured, matching every other
// webhook route's "don't confuse the provider's retry/alerting" posture.
async function registerLinearWebhookRoute(instance: FastifyInstance) {
  instance.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  instance.post<{ Params: { organizationId: string } }>("/webhooks/linear/:organizationId", async (req, reply) => {
    const org = await prisma.organization.findUnique({
      where: { id: req.params.organizationId },
      select: { id: true, linearWebhookSecret: true },
    });
    if (!org?.linearWebhookSecret) return reply.send({ handled: false, reason: "Linear integration not configured for this organization" });

    const rawBody = req.body as Buffer;
    const signature = req.headers["linear-signature"] as string | undefined;
    if (!verifyLinearSignature(rawBody, signature, org.linearWebhookSecret)) {
      return reply.code(401).send({ error: "invalid signature" });
    }

    const payload = JSON.parse(rawBody.toString("utf8")) as LinearWebhookPayload;
    const result = await handleLinearWebhook(prisma, org.id, payload);
    return reply.send(result);
  });
}

// P9-01: same per-org-URL routing as the Linear webhook route above, but
// checked against a plain shared secret (a custom header value the
// customer's own Jira Automation rule sends) rather than a computed
// signature - Jira Cloud has no equivalent to Linear's/GitHub's/
// PagerDuty's built-in signed webhooks for a plain REST-API integration,
// see jiraApi.ts's file comment. No raw-body content-type parser needed
// here (nothing here computes an HMAC over exact bytes - a plain header
// compare works the same on the parsed body Fastify's default parser
// already produces, matching GitLab's own webhook route).
async function registerJiraWebhookRoute(instance: FastifyInstance) {
  instance.post<{ Params: { organizationId: string }; Body: JiraWebhookPayload }>(
    "/webhooks/jira/:organizationId",
    async (req, reply) => {
      const org = await prisma.organization.findUnique({
        where: { id: req.params.organizationId },
        select: { id: true, jiraWebhookSecret: true },
      });
      if (!org?.jiraWebhookSecret) return reply.send({ handled: false, reason: "Jira integration not configured for this organization" });

      const secretHeader = req.headers["x-vaettir-jira-secret"] as string | undefined;
      if (!verifyJiraWebhookSecret(secretHeader, org.jiraWebhookSecret)) {
        return reply.code(401).send({ error: "invalid or missing X-Vaettir-Jira-Secret header" });
      }

      const result = await handleJiraWebhook(prisma, org.id, req.body);
      return reply.send(result);
    },
  );
}

// P9-04 (Datadog half): same per-org-URL-plus-plain-shared-secret shape as
// the Jira route above, for the same reason - Datadog has no built-in
// request signing for a generic webhook integration, and a monitor's
// customer-chosen project tag is only unique within one org's own choices,
// not platform-wide (unlike PagerDuty's real service id, which gets its
// own single shared route further below).
async function registerDatadogWebhookRoute(instance: FastifyInstance) {
  instance.post<{ Params: { organizationId: string }; Body: DatadogWebhookPayload }>(
    "/webhooks/datadog/:organizationId",
    async (req, reply) => {
      const org = await prisma.organization.findUnique({
        where: { id: req.params.organizationId },
        select: { id: true, datadogWebhookSecret: true },
      });
      if (!org?.datadogWebhookSecret) return reply.send({ handled: false, reason: "Datadog integration not configured for this organization" });

      const secretHeader = req.headers["x-vaettir-datadog-secret"] as string | undefined;
      if (!verifyDatadogWebhookSecret(secretHeader, org.datadogWebhookSecret)) {
        return reply.code(401).send({ error: "invalid or missing X-Vaettir-Datadog-Secret header" });
      }

      const result = await handleDatadogWebhook(prisma, org.id, req.body);
      return reply.send(result);
    },
  );
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

      const result = await handleGooglePlayOAuthCallback(prisma, { code, state, error });
      if (result.httpStatus === 400) return reply.code(400).send({ error: result.message });
      return finish(result.projectId, result.status, result.message);
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
  const statusCode = error.statusCode ?? 500;
  reply.status(statusCode).send({ error: publicHttpErrorMessage(statusCode, error.message) });
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

await server.register(cors, { origin: createCorsOriginPolicy(process.env) });

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

// P9-05: serves the hand-authored OpenAPI spec (docs/openapi.yaml) as a
// plain static file - deliberately not @fastify/static (a new dependency
// and plugin registration for exactly one file is more machinery than
// this needs) and deliberately not the buggy trpc-to-openapi Fastify
// adapter docs/API.md's own "What's still open" section documents in
// detail. Read fresh on every request rather than cached at startup: this
// file changes rarely and a stale spec being served after an edit is a
// worse failure mode than one extra small file read per request.
const OPENAPI_SPEC_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../../docs/openapi.yaml");
server.get("/openapi.yaml", { config: { rateLimit: false } }, async (_req, reply) => {
  try {
    const content = readFileSync(OPENAPI_SPEC_PATH, "utf8");
    return reply.type("application/yaml").send(content);
  } catch {
    return reply.code(404).send({ error: "openapi.yaml not found" });
  }
});
await server.register(registerGithubWebhookRoute);
await server.register(registerGitlabWebhookRoute);
await server.register(registerStripeWebhookRoute);
await server.register(registerProductionSignalOAuthRoute);
await server.register(registerPagerDutyWebhookRoute);
await server.register(registerLinearWebhookRoute);
await server.register(registerJiraWebhookRoute);
await server.register(registerDatadogWebhookRoute);

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
    instance.get("/openapi.yaml", { config: { rateLimit: false } }, async (_req, reply) => {
      try {
        const content = readFileSync(OPENAPI_SPEC_PATH, "utf8");
        return reply.type("application/yaml").send(content);
      } catch {
        return reply.code(404).send({ error: "openapi.yaml not found" });
      }
    });
    await instance.register(registerGithubWebhookRoute);
    await instance.register(registerGitlabWebhookRoute);
    await instance.register(registerStripeWebhookRoute);
    await instance.register(registerProductionSignalOAuthRoute);
    await instance.register(registerPagerDutyWebhookRoute);
    await instance.register(registerLinearWebhookRoute);
    await instance.register(registerJiraWebhookRoute);
    await instance.register(registerDatadogWebhookRoute);
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
