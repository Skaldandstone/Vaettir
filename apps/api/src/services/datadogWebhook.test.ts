import { describe, it, expect } from "vitest";
import { verifyDatadogWebhookSecret } from "./datadogWebhook.js";

describe("verifyDatadogWebhookSecret", () => {
  it("accepts a matching shared secret", () => {
    expect(verifyDatadogWebhookSecret("shh-its-a-secret", "shh-its-a-secret")).toBe(true);
  });

  it("rejects a mismatched secret", () => {
    expect(verifyDatadogWebhookSecret("wrong", "shh-its-a-secret")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyDatadogWebhookSecret(undefined, "shh-its-a-secret")).toBe(false);
  });

  it("rejects when no secret is configured", () => {
    expect(verifyDatadogWebhookSecret("anything", "")).toBe(false);
  });
});
