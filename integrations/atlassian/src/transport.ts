import type { invokeRemote } from "@forge/bridge";

export function createQualityTransport(
  invoke: typeof invokeRemote,
  timeoutMs = 30000,
) {
  return async (body: unknown) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = (async () => {
      // Public readiness improves rollout feedback. It is not authorization or
      // an atomic guarantee about a subsequent request during a rolling update.
      const action = (body as { action?: string })?.action;
      if (action === "LIST" || action === "IDENTITY") {
        const health = await invoke({ path: "/api/health/detailed", method: "GET" });
        if (health.status !== 200 || health.body?.capabilities?.forgeQuality !== true)
          throw new Error("Quality Intelligence is waiting for the Vaettir API update. Try again shortly.");
      }
      return invoke({
        path: "/api/integrations/forge/quality",
        method: "POST",
        // The frontend bridge JSON-serializes this object. Let it supply the
        // content type instead of adding a case-variant custom header alongside
        // its own. The backend @forge/api contract is different (string body).
        // https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/invokeRemote/
        body,
      });
    })();
    const response = await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Quality Intelligence did not respond in time. Try again.")), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    if (response.status !== 200 || !response.body)
      throw new Error(
        typeof response.body?.error === "string"
          ? response.body.error
          : "Quality Intelligence is unavailable. Check the approved connection in Vaettir.",
      );
    return response.body;
  };
}
