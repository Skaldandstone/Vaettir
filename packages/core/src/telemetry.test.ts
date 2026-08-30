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
