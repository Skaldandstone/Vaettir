import { describe, it, expect } from "vitest";
import { redactAiDisclosureEvent } from "./aiDisclosureTelemetry.js";
describe("AI disclosure telemetry", () => {
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
