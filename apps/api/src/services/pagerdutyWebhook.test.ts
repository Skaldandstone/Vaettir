import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyPagerDutySignature } from "./pagerdutyWebhook.js";

describe("verifyPagerDutySignature", () => {
  const secret = "whsec_test_secret";
  const body = Buffer.from(JSON.stringify({ event: { event_type: "incident.triggered" } }));

  function sign(rawBody: Buffer, key: string): string {
    return `v1=${createHmac("sha256", key).update(rawBody).digest("hex")}`;
  }

  it("accepts a correctly computed v1= signature", () => {
    expect(verifyPagerDutySignature(body, sign(body, secret), secret)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    expect(verifyPagerDutySignature(body, sign(body, "wrong-secret"), secret)).toBe(false);
  });

  it("rejects a signature computed over a different body (tampered payload)", () => {
    const tamperedBody = Buffer.from(JSON.stringify({ event: { event_type: "incident.resolved" } }));
    expect(verifyPagerDutySignature(body, sign(tamperedBody, secret), secret)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyPagerDutySignature(body, undefined, secret)).toBe(false);
  });

  it("rejects a signature missing the v1= prefix", () => {
    const raw = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyPagerDutySignature(body, raw, secret)).toBe(false);
  });
});
