import type { FastifyInstance } from "fastify";

export function isAiDisclosureRequest(url: string) {
  try {
    url = decodeURIComponent(url.split("?")[0] ?? "");
  } catch {
    return true;
  }
  return url.includes("/integrations/ai/") || url.includes("aiDisclosure.");
}

export function registerAiDisclosureResponsePrivacy(server: FastifyInstance) {
  server.addHook("onSend", async (request, reply, payload) => {
    if (isAiDisclosureRequest(request.url)) {
      reply.header("Cache-Control", "no-store");
      reply.header("Pragma", "no-cache");
    }
    return payload;
  });
}

/** Dedicated credential requests must not be duplicated into error telemetry,
 * including query parameters, headers, body, cookies, or nearby breadcrumbs. */
export function redactAiDisclosureEvent<
  T extends { request?: { url?: string }; breadcrumbs?: unknown[] },
>(event: T): T {
  const url = event.request?.url ?? "";
  if (!isAiDisclosureRequest(url)) return event;
  return {
    ...event,
    request: { url: "/api/integrations/ai/[redacted]" },
    breadcrumbs: [],
  };
}
