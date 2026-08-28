import * as Sentry from "@sentry/nextjs";

// P10-05: browser-side counterpart to instrumentation.ts. Next.js loads
// this automatically before any client code runs (no next.config wiring
// needed). Inert when the DSN isn't set at build time.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
