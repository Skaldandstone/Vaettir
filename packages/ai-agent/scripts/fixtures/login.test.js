import { describe, it, expect } from "vitest";
import { login } from "../src/auth";

describe("login", () => {
  it("returns a session token for valid credentials", async () => {
    const result = await login("user@example.com", "correct-password");
    expect(result.token).toBeDefined();
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it("throws an InvalidCredentialsError for a wrong password", async () => {
    await expect(login("user@example.com", "wrong-password")).rejects.toThrow("InvalidCredentialsError");
  });

  it("locks the account after 5 failed attempts", async () => {
    for (let i = 0; i < 5; i++) {
      await login("user@example.com", "wrong-password").catch(() => {});
    }
    await expect(login("user@example.com", "correct-password")).rejects.toThrow("AccountLockedError");
  });
});
