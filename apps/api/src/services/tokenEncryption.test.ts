import { describe, it, expect } from "vitest";
import { encryptToken, decryptToken, TokenEncryptionNotConfiguredError } from "./tokenEncryption.js";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

describe("encryptToken/decryptToken", () => {
  it("throws TokenEncryptionNotConfiguredError when no key is set", () => {
    expect(() => encryptToken("secret", {})).toThrow(TokenEncryptionNotConfiguredError);
  });

  it("rejects a key that isn't 32 bytes", () => {
    expect(() => encryptToken("secret", { PRODUCTION_SIGNAL_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(
      /32 bytes/,
    );
  });

  it("round-trips a real token", () => {
    const env = { PRODUCTION_SIGNAL_ENCRYPTION_KEY: TEST_KEY };
    const encrypted = encryptToken("a-real-oauth-access-token", env);
    expect(decryptToken(encrypted, env)).toBe("a-real-oauth-access-token");
  });

  it("never leaves the plaintext recoverable from the ciphertext string itself", () => {
    const env = { PRODUCTION_SIGNAL_ENCRYPTION_KEY: TEST_KEY };
    const encrypted = encryptToken("super-secret-refresh-token", env);
    expect(encrypted.ciphertext).not.toContain("super-secret-refresh-token");
  });

  it("two encryptions of the same plaintext produce different ciphertext (random IV)", () => {
    const env = { PRODUCTION_SIGNAL_ENCRYPTION_KEY: TEST_KEY };
    const a = encryptToken("same-value", env);
    const b = encryptToken("same-value", env);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it("fails to decrypt with a tampered auth tag (integrity check, not just confidentiality)", () => {
    const env = { PRODUCTION_SIGNAL_ENCRYPTION_KEY: TEST_KEY };
    const encrypted = encryptToken("value", env);
    const tampered = { ...encrypted, authTag: Buffer.alloc(16, 1).toString("base64") };
    expect(() => decryptToken(tampered, env)).toThrow();
  });

  it("fails to decrypt with the wrong key", () => {
    const encrypted = encryptToken("value", { PRODUCTION_SIGNAL_ENCRYPTION_KEY: TEST_KEY });
    const wrongKey = Buffer.alloc(32, 9).toString("base64");
    expect(() => decryptToken(encrypted, { PRODUCTION_SIGNAL_ENCRYPTION_KEY: wrongKey })).toThrow();
  });
});
