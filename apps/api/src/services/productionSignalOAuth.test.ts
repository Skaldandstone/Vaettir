import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import {
  getGooglePlayOAuthConfig,
  buildGooglePlayAuthorizeUrl,
  exchangeGooglePlayCode,
  refreshGooglePlayAccessToken,
  buildAppStoreConnectJwt,
  validateAppleAppStoreCredentials,
  ProductionSignalOAuthNotConfiguredError,
} from "./productionSignalOAuth.js";

const GOOGLE_ENV = {
  GOOGLE_PLAY_OAUTH_CLIENT_ID: "client-123.apps.googleusercontent.com",
  GOOGLE_PLAY_OAUTH_CLIENT_SECRET: "shh",
  GOOGLE_PLAY_OAUTH_REDIRECT_URI: "https://app.vaettir.example/oauth/production-signals/GOOGLE_PLAY/callback",
};

describe("getGooglePlayOAuthConfig", () => {
  it("returns null when nothing is set", () => {
    expect(getGooglePlayOAuthConfig({})).toBeNull();
  });

  it("throws when only some of the three vars are set", () => {
    expect(() => getGooglePlayOAuthConfig({ GOOGLE_PLAY_OAUTH_CLIENT_ID: "x" })).toThrow(/must all be set together/);
  });

  it("returns the config when all three are set", () => {
    expect(getGooglePlayOAuthConfig(GOOGLE_ENV)).toEqual({
      clientId: GOOGLE_ENV.GOOGLE_PLAY_OAUTH_CLIENT_ID,
      clientSecret: GOOGLE_ENV.GOOGLE_PLAY_OAUTH_CLIENT_SECRET,
      redirectUri: GOOGLE_ENV.GOOGLE_PLAY_OAUTH_REDIRECT_URI,
    });
  });
});

describe("buildGooglePlayAuthorizeUrl", () => {
  it("throws ProductionSignalOAuthNotConfiguredError when unconfigured", () => {
    expect(() => buildGooglePlayAuthorizeUrl("state123", {})).toThrow(ProductionSignalOAuthNotConfiguredError);
  });

  it("builds a real Google authorize URL with the state param and offline/consent flags", () => {
    const url = new URL(buildGooglePlayAuthorizeUrl("state123", GOOGLE_ENV));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(GOOGLE_ENV.GOOGLE_PLAY_OAUTH_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(GOOGLE_ENV.GOOGLE_PLAY_OAUTH_REDIRECT_URI);
    expect(url.searchParams.get("state")).toBe("state123");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/androidpublisher");
  });
});

describe("exchangeGooglePlayCode / refreshGooglePlayAccessToken", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("throws when unconfigured, without making a network call", async () => {
    await expect(exchangeGooglePlayCode("code", {})).rejects.toThrow(ProductionSignalOAuthNotConfiguredError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("parses a successful token exchange response", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "at", refresh_token: "rt", scope: "androidpublisher", expires_in: 3600 }),
    } as Response);
    const tokens = await exchangeGooglePlayCode("real-code", GOOGLE_ENV);
    expect(tokens).toEqual({ accessToken: "at", refreshToken: "rt", scope: "androidpublisher", expiresInSeconds: 3600 });
  });

  it("throws a clear error when Google returns no refresh token", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "at", scope: "androidpublisher", expires_in: 3600 }),
    } as Response);
    await expect(exchangeGooglePlayCode("real-code", GOOGLE_ENV)).rejects.toThrow(/did not return a refresh token/);
  });

  it("surfaces Google's own error on a failed exchange", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant", error_description: "Code was already redeemed." }),
    } as Response);
    await expect(exchangeGooglePlayCode("stale-code", GOOGLE_ENV)).rejects.toThrow(/invalid_grant/);
  });

  it("refreshes an access token without requiring a new refresh token back", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "new-at", scope: "androidpublisher", expires_in: 3600 }),
    } as Response);
    const result = await refreshGooglePlayAccessToken("rt", GOOGLE_ENV);
    expect(result).toEqual({ accessToken: "new-at", expiresInSeconds: 3600 });
  });
});

describe("Apple App Store Connect JWT (ES256)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const creds = { issuerId: "11111111-2222-3333-4444-555555555555", keyId: "ABCD1234", privateKeyPem };

  it("mints a JWT whose signature actually verifies against the matching public key", () => {
    const jwt = buildAppStoreConnectJwt(creds);
    const [headerB64, payloadB64, sigB64] = jwt.split(".");
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = Buffer.from(sigB64 as string, "base64url");

    const verified = cryptoVerify(
      "SHA256",
      Buffer.from(signingInput),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      signature,
    );
    expect(verified).toBe(true);

    const header = JSON.parse(Buffer.from(headerB64 as string, "base64url").toString());
    expect(header).toEqual({ alg: "ES256", kid: creds.keyId, typ: "JWT" });
    const payload = JSON.parse(Buffer.from(payloadB64 as string, "base64url").toString());
    expect(payload.iss).toBe(creds.issuerId);
    expect(payload.aud).toBe("appstoreconnect-v1");
    expect(payload.exp - payload.iat).toBe(20 * 60);
  });

  it("validateAppleAppStoreCredentials accepts a real EC key without throwing", () => {
    expect(() => validateAppleAppStoreCredentials(creds)).not.toThrow();
  });

  it("validateAppleAppStoreCredentials rejects an RSA key with a clear error", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rsaPem = rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => validateAppleAppStoreCredentials({ ...creds, privateKeyPem: rsaPem })).toThrow(/EC \(P-256\)/);
  });
});
