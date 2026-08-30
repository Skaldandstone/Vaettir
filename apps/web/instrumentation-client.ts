import { redactTelemetryEvent } from "@vaettir/core";
import * as Sentry from "@sentry/nextjs";

// P10-05: browser-side counterpart to instrumentation.ts. Next.js loads
// this automatically before any client code runs (no next.config wiring
// needed). Inert when the DSN isn't set at build time.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.NEXT_PUBLIC_RELEASE_COMMIT ? `vaettir@${process.env.NEXT_PUBLIC_RELEASE_COMMIT}` : undefined,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeBreadcrumb: () => null,
    beforeSend: redactTelemetryEvent,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
