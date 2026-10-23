import type { ErrorEvent } from "@sentry/node";

/** Short-lived Forge access tokens and the signed FIT must never be included
 * in error-report request headers, including mixed-case SDK representations. */
export function withoutForgeCredentials(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([key]) =>
        ![
          "authorization",
          "cookie",
          "x-forge-oauth-user",
          "x-forge-oauth-system",
        ].includes(key.toLowerCase()),
    ),
  );
}

export function withoutForgeConnectionData(event: ErrorEvent) {
  if (/atlassianQuality\.(?:connectionOptions|connectProject)|\/integrations\/atlassian\/connect/.test(event.request?.url ?? "")) {
    const method = event.request?.method;
    event.request = method ? { method } : {};
    delete event.user;
    delete event.breadcrumbs;
    delete event.extra;
  }
  return event;
}
