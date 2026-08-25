import { randomBytes, createHash } from "node:crypto";

const KEY_PREFIX = "vt_";

// SHA-256 of the full key is what's stored/looked-up -- a leaked DB row
// alone can't be used as a working key, matching how session tokens are
// never stored either. The 12-char displayed prefix (raw, not hashed) is
// only for a human to tell two keys apart in a list, never for auth.
export function generateApiKey(): { rawKey: string; hashedKey: string; keyPrefix: string } {
  const rawKey = KEY_PREFIX + randomBytes(24).toString("hex");
  return { rawKey, hashedKey: hashApiKey(rawKey), keyPrefix: rawKey.slice(0, 12) };
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function looksLikeApiKey(token: string): boolean {
  return token.startsWith(KEY_PREFIX);
}
