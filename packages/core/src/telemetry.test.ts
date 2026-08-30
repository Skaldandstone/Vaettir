import { it, expect } from "vitest";
import { redactTelemetryEvent } from "./telemetry.js";

it("drops secrets and tenant text from all non-allowlisted telemetry fields", () => {
  const event = { level: "error", release: "abc123", user: { email: "secret" }, request: { headers: { authorization: "secret" } },
    message: "secret", extra: { prompt: "secret" }, breadcrumbs: [{ message: "secret" }], contexts: { response: "secret" },
    tags: { project: "secret" }, exception: { values: [{ type: "TypeError", value: "secret", stacktrace: { frames: [
      { filename: "/private/tenant/app.ts?token=secret", function: "load", lineno: 42, vars: { password: "secret" }, context_line: "secret" },
    ] } }] } };
  const safe = redactTelemetryEvent(event);
  expect(JSON.stringify(safe)).not.toMatch(/secret|tenant|password|authorization/);
  expect(safe.exception.values[0].stacktrace.frames[0]).toMatchObject({ filename: "app.ts", function: "load", lineno: 42 });
  expect(safe.release).toBe("abc123");
  expect(event.user.email).toBe("secret");
});

it("does not allow payload objects through stack coordinates or crash on malformed envelopes", () => {
  expect(() => redactTelemetryEvent({ exception: { values: "secret" } })).not.toThrow();
  const safe = redactTelemetryEvent({ exception: { values: [null, { type: 42, stacktrace: { frames: [null,
    { lineno: { payload: "secret" }, colno: "secret", in_app: { token: "secret" } },
  ] } }] } });
  expect(JSON.stringify(safe)).not.toContain("secret");
});

it("bounds event size while preserving useful source coordinates", () => {
  const safe = redactTelemetryEvent({ extra: { payload: "secret" }, exception: { values: Array.from({ length: 20 }, () => ({
    type: "TypeError", value: "secret", stacktrace: { frames: Array.from({ length: 100 }, () => ({ filename: "https://private.example/tenant/server.js?token=secret", lineno: 7, colno: 2, in_app: true })) },
  })) } });
  expect(safe.exception.values).toHaveLength(5);
  expect(safe.exception.values[0].stacktrace.frames).toHaveLength(50);
  expect(JSON.stringify(safe)).not.toMatch(/secret|tenant|private.example/);
});
