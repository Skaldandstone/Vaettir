import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * SSE-180: this codebase has never stored a per-customer third-party bearer
 * token before (see the schema comment on ProductionSignalConnection) -
 * every existing integration secret (GitHub App key, Stripe key, webhook
 * secrets) lives in an env var, not a DB row. AES-256-GCM here, keyed by a
 * single deploy-level master key (PRODUCTION_SIGNAL_ENCRYPTION_KEY), same
 * "structurally refuses to run unconfigured" posture as stripeConfig.ts's
 * getStripeRuntime - there is no code path that can accidentally store a
 * plaintext token, because encrypt() throws before that's possible.
 */

export class TokenEncryptionNotConfiguredError extends Error {
  constructor() {
    super(
      "PRODUCTION_SIGNAL_ENCRYPTION_KEY is not set - production-signal connections cannot store tokens until it is.",
    );
    this.name = "TokenEncryptionNotConfiguredError";
  }
}

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // NIST-recommended GCM IV length

function getMasterKey(env: NodeJS.ProcessEnv): Buffer {
  const raw = env.PRODUCTION_SIGNAL_ENCRYPTION_KEY;
  if (!raw) throw new TokenEncryptionNotConfiguredError();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("PRODUCTION_SIGNAL_ENCRYPTION_KEY must be 32 bytes, base64-encoded (e.g. `openssl rand -base64 32`).");
  }
  return key;
}

export interface EncryptedToken {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

export function encryptToken(plaintext: string, env: NodeJS.ProcessEnv = process.env): EncryptedToken {
  const key = getMasterKey(env);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptToken(encrypted: EncryptedToken, env: NodeJS.ProcessEnv = process.env): string {
  const key = getMasterKey(env);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
