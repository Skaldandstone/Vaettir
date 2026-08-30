import { redactTelemetryEvent } from "@vaettir/core";
import * as Sentry from "@sentry/node";

// P10-05: imported first (before any other module) in server.ts so
// Sentry's instrumentation is active before anything else runs. Inert
// when SENTRY_DSN isn't set (local dev, or production before the secret
// is provisioned - see NEEDS_ATTENTION.md) - Sentry.captureException calls
// elsewhere in the codebase are safe no-ops without an active client.
const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeBreadcrumb: () => null,
    beforeSend: redactTelemetryEvent,
    debug: process.env.SENTRY_DEBUG === "1",
  });

  process.on("unhandledRejection", (reason) => Sentry.captureException(reason));
  process.on("uncaughtException", (err) => Sentry.captureException(err));
}
