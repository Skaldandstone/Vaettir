import * as Sentry from "@sentry/nextjs";

// P10-05: Next's instrumentation hook, called once per runtime (nodejs and
// edge each get their own module instance) before any route code runs.
// Inert when SENTRY_DSN isn't set (local dev, or production before the
// secret is provisioned - see NEEDS_ATTENTION.md).
// Since 2026-09-10 also inert outside production unless explicitly opted
// in: every local dev run with a DSN in .env was reporting into the real
// production Sentry projects tagged environment=development (six of the
// first nine vaettir-api issues were this machine, not prod). Production
// sets NODE_ENV=production and SENTRY_ENVIRONMENT in the ECS task
// definition; a local run can still opt in with SENTRY_DEBUG=1 (the same
// flag used to verify capture end-to-end) or by setting SENTRY_ENVIRONMENT.
export function register() {
  const dsn = process.env.SENTRY_DSN;
  const sentryWanted =
    process.env.NODE_ENV === "production" || Boolean(process.env.SENTRY_ENVIRONMENT) || process.env.SENTRY_DEBUG === "1";
  if (!dsn || !sentryWanted) return;

  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
      tracesSampleRate: 0.1,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
