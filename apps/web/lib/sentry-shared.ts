// Shared Sentry options for the browser, Node and edge runtimes.
//
// Vaettir's web app is production infrastructure for org membership and
// workspace data, so the default SDK behaviour is narrowed before anything
// leaves the process: no request bodies, headers or cookies, no user
// identity, no breadcrumbs and no performance tracing. An error report
// carries the exception, the stack and the route - enough to fix a bug,
// nothing that says whose request it was.
import type { ErrorEvent } from "@sentry/nextjs";

/** Strip anything that could identify a person from an outgoing event. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  delete event.breadcrumbs;
  if (event.request) {
    // The full URL may carry an identifying slug or token in the path. The
    // method plus the route on the transaction is enough to find the
    // failing handler.
    const { method } = event.request;
    event.request = method ? { method } : {};
  }
  // Sentry.captureRequestError (wired through onRequestError in
  // instrumentation.ts) separately records the concrete request path under
  // contexts.nextjs.request_path, so the segment scrubbed from the URL
  // above would otherwise leave through this side door. Drop it and keep
  // router_path, the parametrised route, which is enough to find the
  // failing handler.
  const nextjs = event.contexts?.nextjs;
  if (nextjs) {
    delete nextjs.request_path;
  }
  return event;
}

/** Options every runtime shares; each runtime supplies its own dsn/environment. */
export const sharedSentryOptions = {
  sendDefaultPii: false,
  tracesSampleRate: 0,
  // Never keep breadcrumbs: console lines, fetch URLs and navigation
  // history are all channels for a name or an email to ride along.
  maxBreadcrumbs: 0,
  beforeBreadcrumb: () => null,
  beforeSend: scrubEvent,
  // Sentry's own debug output stays off even when a DSN is present.
  debug: false,
} as const;
