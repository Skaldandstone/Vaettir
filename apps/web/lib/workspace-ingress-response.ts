import * as Sentry from "@sentry/nextjs";
import { WorkspaceIngressError } from "./workspace-auth";

// A refused edge attestation (forged, replayed, stale or mismatched target) is
// a client error, not a middleware crash. Answer with a non-cacheable 400 and
// keep reporting it with the rejection reason so genuine signing regressions
// (like the Next query-normalization mismatch) stay visible. Anything else is
// rethrown unchanged.
export function workspaceIngressRejection(error: unknown, request: { method: string; headers: Headers }): Response {
  if (!(error instanceof WorkspaceIngressError)) throw error;
  const time = Number(request.headers.get("x-vaettir-time"));
  Sentry.withScope(scope => {
    scope.setLevel("warning");
    scope.setTag("workspace_ingress.reason", error.reason);
    scope.setContext("workspace_ingress", {
      reason: error.reason,
      method: request.method,
      host: request.headers.get("x-vaettir-host"),
      hasTarget: request.headers.has("x-vaettir-target"),
      clockSkewMs: Number.isFinite(time) && time > 0 ? Date.now() - time : null,
    });
    Sentry.captureException(error);
  });
  return new Response("Invalid workspace ingress.", { status: 400, headers: { "Cache-Control": "no-store" } });
}
