import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { assertIdentityAcceptancePermit, assertNoGeneratedPrismaEnvironment, identityAcceptanceRequestAllowed, loadIdentityAcceptanceApplication, validateIdentityAcceptanceEnvironment, type IdentityAcceptancePermit } from "./identityAcceptancePreflight.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function fixture() {
  const env = {
    NODE_ENV: "development", API_PORT: "4208", WEB_APP_URL: "http://localhost:3208", CORS_ALLOWED_ORIGINS: "http://localhost:3208",
    DATABASE_URL: "postgresql://vaettir_identity_fixture:synthetic@127.0.0.1:54828/vaettir_identity_acceptance_20261022",
    CLERK_SECRET_KEY: "sk_test_syntheticNeverSentToProvider",
    CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("synthetic.clerk.accounts.dev$").toString("base64")}`,
  };
  const manifest = { version: 1 as const, reviewReference: "synthetic unit fixture, not authorization", applicationId: "app_synthetic", developmentInstanceId: "ins_synthetic", issuer: "https://synthetic.clerk.accounts.dev", secretKeySha256: hash(env.CLERK_SECRET_KEY), publishableKeySha256: hash(env.CLERK_PUBLISHABLE_KEY) };
  return { env, manifest };
}

describe("isolated identity pre-import validation (no provider or database)", () => {
  it("loads once only after validation, with a bound permit", async () => {
    const { env, manifest } = fixture();
    const load = vi.fn(async () => ({ synthetic: true }));
    const result = await loadIdentityAcceptanceApplication(env, manifest, load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.application).toEqual({ synthetic: true });
    expect(() => assertIdentityAcceptancePermit(result.permit, env)).not.toThrow();
    expect(() => assertIdentityAcceptancePermit({} as IdentityAcceptancePermit, env)).toThrow();
  });
  it.each(["DB_SECRET_ID", "AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_ENDPOINT_URL", "HTTP_PROXY", "HTTPS_PROXY", "NODE_OPTIONS", "NODE_PATH", "DOTENV_CONFIG_PATH", "SENTRY_DSN", "SENTRY_DEBUG", "STAFF_ADMIN_TOKEN", "FULL_ACCESS_EMAIL_ALLOWLIST", "VAETTIR_WORKSPACE_DOMAINS_ENABLED", "CLERK_API_URL", "API_HOST", "OPENAI_API_KEY", "STRIPE_SECRET_KEY", "HOME", "USERPROFILE"])("rejects inherited %s before importing anything", async key => {
    const { env, manifest } = fixture();
    const load = vi.fn();
    await expect(loadIdentityAcceptanceApplication({ ...env, [key]: "synthetic-sensitive-value" }, manifest, load)).rejects.toThrow("preflight rejected");
    expect(load).not.toHaveBeenCalled();
  });
  it.each([
    { NODE_ENV: "production" }, { API_PORT: "4000" }, { WEB_APP_URL: "https://vaettir.app" }, { CORS_ALLOWED_ORIGINS: "*" },
    { CLERK_SECRET_KEY: "sk_live_fake" }, { CLERK_SECRET_KEY: "sk_test_unpinned" }, { CLERK_PUBLISHABLE_KEY: "pk_live_fake" },
    { DATABASE_URL: "postgresql://owner:fake@production.invalid:5432/customer" },
    { DATABASE_URL: "postgresql://vaettir_identity_fixture:fake@127.0.0.1:54828/other" },
    { DATABASE_URL: "postgresql://vaettir_identity_fixture:fake@127.0.0.1:54828/vaettir_identity_acceptance_20261022?host=remote.invalid" },
  ])("rejects wrong endpoint/key/mode before loading %#", async change => {
    const { env, manifest } = fixture();
    const load = vi.fn();
    await expect(loadIdentityAcceptanceApplication({ ...env, ...change }, manifest, load)).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
  });
  it("rejects mismatched issuer, incomplete pins and unknown manifest fields", () => {
    const { env, manifest } = fixture();
    for (const change of [{ issuer: "https://other.clerk.accounts.dev" }, { secretKeySha256: "" }, { reviewReference: "" }, { unexpected: "field" }]) {
      expect(() => validateIdentityAcceptanceEnvironment(env, { ...manifest, ...change })).toThrow();
    }
  });
  it("rejects environment mutation during module loading and before later use", async () => {
    const { env, manifest } = fixture();
    const permit = validateIdentityAcceptanceEnvironment(env, manifest);
    env.API_PORT = "5000";
    expect(() => assertIdentityAcceptancePermit(permit, env)).toThrow();
    env.API_PORT = "4208";
    await expect(loadIdentityAcceptanceApplication(env, manifest, async () => { env.NODE_ENV = "production"; })).rejects.toThrow();
  });
  it("does not reveal secret values in validation errors", () => {
    const { env, manifest } = fixture();
    try { validateIdentityAcceptanceEnvironment({ ...env, SENTRY_DSN: "sensitive-synthetic" }, manifest); }
    catch (error) { expect(String(error)).not.toMatch(/sensitive-synthetic|syntheticNeverSent|postgresql:/); }
  });
  it("refuses generated env-file loading or unknown generation formats before Prisma import", () => {
    expect(() => assertNoGeneratedPrismaEnvironment('"relativeEnvPaths": {"rootEnvPath":null}')).not.toThrow();
    for (const source of ['"relativeEnvPaths": {"rootEnvPath":"../../.env"}', '"relativeEnvPaths": {"schemaEnvPath":".env"}', '"relativeEnvPaths": {"other":null}', 'unknown', '"relativeEnvPaths": {} "relativeEnvPaths": {}']) {
      expect(() => assertNoGeneratedPrismaEnvironment(source)).toThrow();
    }
  });
  it("permits only exact local host/origin and rejects forwarding/tenant claims", () => {
    const headers = { host: "127.0.0.1:4208", origin: "http://localhost:3208" };
    expect(identityAcceptanceRequestAllowed(headers)).toBe(true);
    expect(identityAcceptanceRequestAllowed({ host: headers.host })).toBe(true);
    for (const extra of [{ host: "0.0.0.0:4208" }, { host: "tenant.vaettir.app" }, { origin: "http://localhost:3000" }, { origin: "null" }, { forwarded: "host=other" }, { "x-forwarded-host": "other" }, { "x-vaettir-host": "app.vaettir.app" }]) {
      expect(identityAcceptanceRequestAllowed({ ...headers, ...extra })).toBe(false);
    }
  });
});
