import { createSign, createPrivateKey } from "node:crypto";
import { randomBytes } from "node:crypto";

/**
 * SSE-180: the two providers need genuinely different flows, not one
 * generic "OAuth" abstraction papering over the difference:
 *
 * - GOOGLE_PLAY: real OAuth 2.0 authorization-code flow against Google's
 *   endpoints (Play Console access is a normal Google Cloud OAuth client
 *   with the androidpublisher scope) - redirect, callback, refresh token.
 * - APPLE_APP_STORE: App Store Connect has no per-user OAuth login for
 *   third-party API access at all. Access is an API key (Issuer ID + Key ID
 *   + an ES256 private key) the account holder generates themselves in App
 *   Store Connect's own UI and enters directly - there is no redirect/
 *   callback for this provider. What Vaettir does with it is mint a
 *   short-lived signed JWT per request, the same shape this codebase's own
 *   GitHub App integration already uses (services/githubApp.ts's
 *   createAppJwt), just ES256 instead of RS256 and against Apple's
 *   documented claim set (https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests).
 *
 * Same "inert until configured, throws loudly on real misconfiguration"
 * posture as stripeConfig.ts - unconfigured returns null so a caller can
 * treat the provider as simply unavailable; a value that IS set but
 * doesn't parse/sign correctly throws.
 */

export class ProductionSignalOAuthNotConfiguredError extends Error {}

function base64url(input: Buffer | string): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// ---------------------------------------------------------------------------
// GOOGLE_PLAY: real OAuth 2.0 authorization-code flow
// ---------------------------------------------------------------------------

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

export interface GooglePlayOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getGooglePlayOAuthConfig(env: NodeJS.ProcessEnv = process.env): GooglePlayOAuthConfig | null {
  const clientId = env.GOOGLE_PLAY_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_PLAY_OAUTH_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_PLAY_OAUTH_REDIRECT_URI;
  if (!clientId && !clientSecret && !redirectUri) return null;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "GOOGLE_PLAY_OAUTH_CLIENT_ID, GOOGLE_PLAY_OAUTH_CLIENT_SECRET, and GOOGLE_PLAY_OAUTH_REDIRECT_URI must all be set together.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function buildGooglePlayAuthorizeUrl(state: string, env: NodeJS.ProcessEnv = process.env): string {
  const config = getGooglePlayOAuthConfig(env);
  if (!config) throw new ProductionSignalOAuthNotConfiguredError("Google Play OAuth is not configured.");
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_PLAY_SCOPE,
    access_type: "offline", // required to get a refresh token back
    prompt: "consent", // forces a refresh token even on a re-connect
    state,
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

export interface GooglePlayTokens {
  accessToken: string;
  refreshToken: string | null; // null on a token-refresh call, always present on the initial exchange
  scope: string;
  expiresInSeconds: number;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  scope: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

export async function exchangeGooglePlayCode(code: string, env: NodeJS.ProcessEnv = process.env): Promise<GooglePlayTokens> {
  const config = getGooglePlayOAuthConfig(env);
  if (!config) throw new ProductionSignalOAuthNotConfiguredError("Google Play OAuth is not configured.");

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code,
    }),
  });
  const body = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !body.access_token) {
    throw new Error(`Google token exchange failed: ${body.error ?? response.status} ${body.error_description ?? ""}`.trim());
  }
  if (!body.refresh_token) {
    throw new Error("Google did not return a refresh token - the connect flow needs access_type=offline and prompt=consent.");
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token, scope: body.scope, expiresInSeconds: body.expires_in };
}

export async function refreshGooglePlayAccessToken(
  refreshToken: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const config = getGooglePlayOAuthConfig(env);
  if (!config) throw new ProductionSignalOAuthNotConfiguredError("Google Play OAuth is not configured.");

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const body = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !body.access_token) {
    throw new Error(`Google token refresh failed: ${body.error ?? response.status} ${body.error_description ?? ""}`.trim());
  }
  return { accessToken: body.access_token, expiresInSeconds: body.expires_in };
}

// ---------------------------------------------------------------------------
// APPLE_APP_STORE: customer-supplied API key, JWT minted per request
// ---------------------------------------------------------------------------

const APPLE_JWT_MAX_LIFETIME_SECONDS = 20 * 60; // Apple rejects anything longer-lived than 20 minutes

// Node's createSign for an EC key produces a DER-encoded signature by
// default; JWS/JOSE (what every JWT library and Apple's own verifier
// expects) wants the raw, fixed-length r||s concatenation instead. This is
// a well-known, easy-to-get-wrong gap between Node's crypto primitives and
// the JWT spec - get it wrong and every request silently fails signature
// verification with no useful error. P-256 (the curve App Store Connect
// API keys use) has a 32-byte r and a 32-byte s.
function derEcdsaSignatureToJose(der: Buffer, componentLengthBytes: number): Buffer {
  // Minimal SEQUENCE(INTEGER r, INTEGER s) parser - sufficient for the one
  // shape node:crypto actually emits, not a general ASN.1 parser.
  let offset = 2; // skip SEQUENCE tag + length byte
  function readInteger(): Buffer {
    if (der[offset] !== 0x02) throw new Error("Malformed ECDSA DER signature (expected INTEGER).");
    offset += 1;
    let len = der[offset] as number;
    offset += 1;
    let bytes = der.subarray(offset, offset + len);
    offset += len;
    // DER left-pads a positive integer with 0x00 when the high bit would
    // otherwise read as negative - strip it back to the natural length.
    while (bytes.length > componentLengthBytes && bytes[0] === 0x00) bytes = bytes.subarray(1);
    if (bytes.length < componentLengthBytes) {
      bytes = Buffer.concat([Buffer.alloc(componentLengthBytes - bytes.length, 0), bytes]);
    }
    return Buffer.from(bytes);
  }
  const r = readInteger();
  const s = readInteger();
  return Buffer.concat([r, s]);
}

export interface AppleAppStoreCredentials {
  issuerId: string;
  keyId: string;
  privateKeyPem: string;
}

/** Throws if the private key isn't a valid EC (P-256) key - the one thing worth validating before storing it encrypted. */
export function validateAppleAppStoreCredentials(creds: AppleAppStoreCredentials): void {
  const key = createPrivateKey(creds.privateKeyPem);
  if (key.asymmetricKeyType !== "ec") {
    throw new Error("App Store Connect API keys are EC (P-256) keys - this private key is not an EC key.");
  }
  // Signs a throwaway payload purely to prove the key actually works end to
  // end (parses, signs, produces a well-formed signature) before it's ever
  // stored - catches a corrupted paste immediately instead of at first real
  // use, days later.
  buildAppStoreConnectJwt(creds);
}

export function buildAppStoreConnectJwt(creds: AppleAppStoreCredentials): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: creds.keyId, typ: "JWT" };
  const payload = {
    iss: creds.issuerId,
    iat: now,
    exp: now + APPLE_JWT_MAX_LIFETIME_SECONDS,
    aud: "appstoreconnect-v1",
  };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const derSignature = createSign("SHA256").update(signingInput).sign(creds.privateKeyPem);
  const joseSignature = derEcdsaSignatureToJose(derSignature, 32);
  return `${signingInput}.${base64url(joseSignature)}`;
}

export function generateOAuthState(): string {
  return randomBytes(24).toString("base64url");
}
