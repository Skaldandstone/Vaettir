import { redactTelemetryEvent } from "@vaettir/core";
import * as Sentry from "@sentry/nextjs";

// P10-05: Next's instrumentation hook, called once per runtime (nodejs and
// edge each get their own module instance) before any route code runs.
// Inert when SENTRY_DSN isn't set (local dev, or production before the
// secret is provisioned - see NEEDS_ATTENTION.md).
export function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
      tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeBreadcrumb: () => null,
    beforeSend: redactTelemetryEvent,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
