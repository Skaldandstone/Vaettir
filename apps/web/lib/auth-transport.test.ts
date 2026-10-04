import { describe, expect, it } from "vitest";
import {
  scopedSessionHeaders,
  type AuthTransportSession,
} from "./auth-transport";

const scope = { userId: "synthetic-user-a", sessionId: "synthetic-session-a" };
const session = (
  getToken: () => Promise<string | null>,
): AuthTransportSession => ({
  id: scope.sessionId,
  user: { id: scope.userId },
  getToken,
});
describe("original authenticated transport scope", () => {
  it("dispatches only the original matching session token", async () => {
    const original = session(async () => "synthetic-token");
    expect(await scopedSessionHeaders(scope, () => original)).toEqual({
      authorization: "Bearer synthetic-token",
    });
  });
  it("refuses absent, changed user and changed session before token lookup", async () => {
    let lookups = 0;
    const original = session(async () => {
      lookups++;
      return "synthetic-token";
    });
    for (const current of [
      null,
      { ...original, id: "other-session" },
      { ...original, user: { id: "other-user" } },
    ]) {
      await expect(scopedSessionHeaders(scope, () => current)).rejects.toThrow(
        "Authentication changed",
      );
    }
    await expect(scopedSessionHeaders(null, () => original)).rejects.toThrow(
      "Authentication changed",
    );
    expect(lookups).toBe(0);
  });
  it("refuses an account switch while awaiting a token", async () => {
    let active: AuthTransportSession;
    const original = session(async () => {
      active = { ...original, id: "other-session", user: { id: "other-user" } };
      return "synthetic-token";
    });
    active = original;
    await expect(scopedSessionHeaders(scope, () => active)).rejects.toThrow(
      "original authenticated session",
    );
  });
  it("refuses sign-out during token lookup and null tokens", async () => {
    let active: AuthTransportSession | null;
    active = session(async () => {
      active = null;
      return "synthetic-token";
    });
    await expect(scopedSessionHeaders(scope, () => active)).rejects.toThrow();
    active = session(async () => null);
    await expect(scopedSessionHeaders(scope, () => active)).rejects.toThrow();
  });
  it("propagates token lookup failures without anonymous fallback", async () => {
    const original = session(async () => {
      throw new Error("synthetic token refusal");
    });
    await expect(scopedSessionHeaders(scope, () => original)).rejects.toThrow(
      "synthetic token refusal",
    );
  });
});
