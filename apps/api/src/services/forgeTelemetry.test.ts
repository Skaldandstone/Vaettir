import { expect, it } from "vitest";
import { withoutForgeCredentials, withoutForgeConnectionData } from "./forgeTelemetry.js";
it("removes signed Forge and short-lived product credentials before telemetry without changing the request itself", () => {
  const headers = {
    Authorization: "private-fit",
    "X-Forge-OAuth-User": "private-user",
    "x-forge-oauth-system": "private-system",
    Cookie: "private-session",
    "Content-Type": "application/json",
  };
  expect(withoutForgeCredentials(headers)).toEqual({
    "Content-Type": "application/json",
  });
  expect(headers.Authorization).toBe("private-fit");
});
it("withholds connection handoff data and request context from telemetry, including batched calls", () => {
  const result = withoutForgeConnectionData({ request: { method: "POST", url: "https://api.example.test/trpc/atlassianQuality.connectionOptions,atlassianQuality.connectProject?batch=1", data: { requestToken: "private-handoff" }, headers: { referer: "private-handoff" } }, breadcrumbs: [{ message: "private-handoff" }], extra: { state: "private-handoff" }, user: { id: "private-actor" } });
  expect(result.request).toEqual({ method: "POST" }); expect(JSON.stringify(result)).not.toContain("private-handoff"); expect(result).not.toHaveProperty("user");
});
