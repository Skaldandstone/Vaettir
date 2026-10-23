import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import {
  redactAiDisclosureEvent,
  registerAiDisclosureResponsePrivacy,
} from "./aiDisclosureTelemetry.js";
describe("AI disclosure telemetry", () => {
  it("marks one-time credential RPC replies as non-cacheable", async () => {
    const app = Fastify();
    registerAiDisclosureResponsePrivacy(app);
    app.post("/api/trpc/aiDisclosure.issue", async () => ({
      token: "SYNTHETIC_CREDENTIAL",
    }));
    try {
      const reply = await app.inject({
        method: "POST",
        url: "/api/trpc/aiDisclosure.issue",
      });
      expect(reply.headers["cache-control"]).toBe("no-store");
      expect(reply.headers.pragma).toBe("no-cache");
    } finally {
      await app.close();
    }
  });
  it.each([
    "https://vaettir.example/api/integrations/ai/v1/project-summary?projectId=PRIVATE_QUERY_CANARY",
    "https://vaettir.example/trpc/aiDisclosure.issue",
  ])("strips request content and breadcrumbs for %s", (url) => {
    const event = {
      message: "Fixed error",
      request: {
        url,
        headers: { authorization: "Bearer CREDENTIAL_CANARY" },
        data: "CUSTOMER_CANARY",
        cookies: "PRIVATE_COOKIE",
      },
      breadcrumbs: [{ data: { secret: "BREADCRUMB_CANARY" } }],
    };
    expect(JSON.stringify(redactAiDisclosureEvent(event))).not.toMatch(
      /CANARY|COOKIE|headers|data/,
    );
    expect(event.request.data).toBe("CUSTOMER_CANARY");
  });
  it("leaves unrelated event policy to its existing redaction", () => {
    const event = { request: { url: "https://vaettir.example/health" } };
    expect(redactAiDisclosureEvent(event)).toBe(event);
  });
});
