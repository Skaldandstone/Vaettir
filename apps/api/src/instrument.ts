import * as Sentry from "@sentry/node";

// P10-05: imported first (before any other module) in server.ts so
// Sentry's instrumentation is active before anything else runs. Inert
// when SENTRY_DSN isn't set (local dev, or production before the secret
// is provisioned - see NEEDS_ATTENTION.md) - Sentry.captureException calls
// elsewhere in the codebase are safe no-ops without an active client.
// Since 2026-09-10 also inert outside production unless explicitly opted
// in: every local dev run with a DSN in .env was reporting into the real
// production Sentry projects tagged environment=development (six of the
// first nine vaettir-api issues were this machine, not prod). Production
// sets NODE_ENV=production and SENTRY_ENVIRONMENT in the ECS task
// definition; a local run can still opt in with SENTRY_DEBUG=1 (the same
// flag used to verify capture end-to-end) or by setting SENTRY_ENVIRONMENT.
const dsn = process.env.SENTRY_DSN;
const sentryWanted =
  process.env.NODE_ENV === "production" || Boolean(process.env.SENTRY_ENVIRONMENT) || process.env.SENTRY_DEBUG === "1";
if (dsn && sentryWanted) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
    debug: process.env.SENTRY_DEBUG === "1",
  });

  process.on("unhandledRejection", (reason) => Sentry.captureException(reason));
  process.on("uncaughtException", (err) => Sentry.captureException(err));
}
