import { expect, it } from "vitest";
import * as Sentry from "@sentry/node";
import { redactTelemetryEvent } from "@vaettir/core";

it("scrubs a real SDK error envelope before the transport receives it without network access", async () => {
  const envelopes: unknown[] = [];
  const client = new Sentry.NodeClient({
    dsn: "http://public@localhost/1", integrations: [], stackParser: Sentry.defaultStackParser,
    release: `vaettir@${"a".repeat(40)}`, sendDefaultPii: false, tracesSampleRate: 0,
    beforeSend: redactTelemetryEvent, beforeBreadcrumb: () => null,
    transport: () => ({
      send: async (envelope) => { envelopes.push(envelope); return { statusCode: 200 }; },
      flush: async () => true,
    }),
  });
  const scope = new Sentry.Scope();
  scope.setClient(client);
  scope.setUser({ email: "sensitive@example.invalid" });
  scope.setContext("tenant", { source: "sensitive-source" });
  scope.setExtra("password", "sensitive-password");
  scope.setTag("project", "sensitive-project");
  scope.addBreadcrumb({ message: "sensitive-breadcrumb" });
  scope.captureException(new Error("sensitive-error-message"));
  expect(await client.flush(2000)).toBe(true);
  const serialized = JSON.stringify(envelopes);
  expect(envelopes).toHaveLength(1);
  expect(serialized).not.toMatch(/sensitive-|sensitive@example/);
  expect(serialized).toContain("Application error; sensitive details excluded.");
  expect(serialized).toContain(`vaettir@${"a".repeat(40)}`);
  await client.close();
});
