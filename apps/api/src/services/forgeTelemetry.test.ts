import { expect, it } from "vitest";
import { withoutForgeCredentials } from "./forgeTelemetry.js";
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
