import * as Sentry from "@sentry/nextjs";

// P10-05: browser-side counterpart to instrumentation.ts. Next.js loads
// this automatically before any client code runs (no next.config wiring
// needed). Inert when the DSN isn't set at build time.
// Same production/opt-in gate as instrumentation.ts (NODE_ENV is inlined
// at build time, so a `next dev` bundle never reports; a `next build` one
// always does). NEXT_PUBLIC_SENTRY_ENVIRONMENT is the browser-side opt-in.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const sentryWanted = process.env.NODE_ENV === "production" || Boolean(process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT);
if (dsn && sentryWanted) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
