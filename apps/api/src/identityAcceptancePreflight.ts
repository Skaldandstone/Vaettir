import { createHash } from "node:crypto";

/** Operator-reviewed pins, not permission to create/configure a provider. */
export type IdentityAcceptanceManifest = {
  version: 1;
  reviewReference: string;
  applicationId: string;
  developmentInstanceId: string;
  issuer: string;
  secretKeySha256: string;
  publishableKeySha256: string;
};

const systemKeys = ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT", "SYSTEMDRIVE"];
const applicationKeys = ["NODE_ENV", "DATABASE_URL", "API_PORT", "WEB_APP_URL", "CORS_ALLOWED_ORIGINS", "CLERK_SECRET_KEY", "CLERK_PUBLISHABLE_KEY"];
const allowedKeys = new Set([...systemKeys, ...applicationKeys]);
const permits = new WeakMap<object, string>();
declare const permitBrand: unique symbol;
export type IdentityAcceptancePermit = { readonly [permitBrand]: true };
const fingerprint = (env: NodeJS.ProcessEnv) => JSON.stringify(Object.entries(env).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)));
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const fail = (): never => { throw new Error("Identity acceptance preflight rejected configuration."); };

// No database, provider SDK, dotenv, instrumentation or app imports in this file.
// Reject, rather than silently strip, inherited configuration. The operator must
// launch a clean child environment; NODE_OPTIONS loaders are outside this process
// boundary and must also be absent before Node starts.
export function validateIdentityAcceptanceEnvironment(env: NodeJS.ProcessEnv, input: unknown): IdentityAcceptancePermit {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (!allowedKeys.has(key.toUpperCase())) fail();
    if (!systemKeys.includes(key.toUpperCase()) && !applicationKeys.includes(key)) fail();
  }
  if (env.NODE_ENV !== "development" || env.API_PORT !== "4208"
      || env.WEB_APP_URL !== "http://localhost:3208" || env.CORS_ALLOWED_ORIGINS !== "http://localhost:3208") fail();
  let db: URL;
  try { db = new URL(env.DATABASE_URL ?? ""); } catch { return fail(); }
  if (db.protocol !== "postgresql:" || db.hostname !== "127.0.0.1" || db.port !== "54828"
      || db.pathname !== "/vaettir_identity_acceptance_20261022" || db.search || db.hash
      || db.username !== "vaettir_identity_fixture" || !db.password) fail();
  if (!input || typeof input !== "object" || Array.isArray(input)) fail();
  const manifest = input as IdentityAcceptanceManifest;
  const manifestKeys = ["version", "reviewReference", "applicationId", "developmentInstanceId", "issuer", "secretKeySha256", "publishableKeySha256"];
  if (Object.keys(manifest).some(key => !manifestKeys.includes(key))
      || manifest.version !== 1 || typeof manifest.reviewReference !== "string" || !manifest.reviewReference.trim()
      || !/^app_[A-Za-z0-9]+$/.test(manifest.applicationId ?? "")
      || !/^ins_[A-Za-z0-9]+$/.test(manifest.developmentInstanceId ?? "")
      || !/^https:\/\/[a-z0-9-]+\.clerk\.accounts\.dev$/.test(manifest.issuer ?? "")
      || !/^[a-f0-9]{64}$/.test(manifest.secretKeySha256 ?? "")
      || !/^[a-f0-9]{64}$/.test(manifest.publishableKeySha256 ?? "")) fail();
  const secret = env.CLERK_SECRET_KEY ?? "";
  const publishable = env.CLERK_PUBLISHABLE_KEY ?? "";
  if (!/^sk_test_[A-Za-z0-9]+$/.test(secret) || !/^pk_test_[A-Za-z0-9+/=]+$/.test(publishable)
      || digest(secret) !== manifest.secretKeySha256 || digest(publishable) !== manifest.publishableKeySha256) fail();
  const encoded = publishable.slice("pk_test_".length);
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  if (decoded !== `${new URL(manifest.issuer).hostname}$`
      || Buffer.from(decoded).toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) fail();
  // Pins are operator evidence, not online proof of key/instance ownership.
  const permit = Object.freeze({}) as IdentityAcceptancePermit;
  permits.set(permit, fingerprint(env));
  return permit;
}

export function assertIdentityAcceptancePermit(permit: IdentityAcceptancePermit, env: NodeJS.ProcessEnv) {
  if (!permits.has(permit) || permits.get(permit) !== fingerprint(env)) fail();
}

// Inspect generated code as text, never evaluate it. Prisma may otherwise load
// a generation-time .env path even when the child process environment is clean.
// Unknown generator formats fail closed and require a fresh source review.
export function assertNoGeneratedPrismaEnvironment(source: string) {
  const matches = [...source.matchAll(/"relativeEnvPaths"\s*:\s*(\{[^{}]*\})/g)];
  if (matches.length !== 1) fail();
  let paths: Record<string, unknown>;
  try { paths = JSON.parse(matches[0]![1]!); } catch { return fail(); }
  if (Object.entries(paths).some(([key, value]) => !["rootEnvPath", "schemaEnvPath"].includes(key) || value !== null)) fail();
}

export function identityAcceptanceRequestAllowed(headers: Record<string, unknown>) {
  return headers.host === "127.0.0.1:4208"
    && (headers.origin === undefined || headers.origin === "http://localhost:3208")
    && !Object.keys(headers).some(key => /^(forwarded|x-forwarded-|x-vaettir-)/i.test(key));
}

// Loader injection exercises import ordering only, never authentication.
export async function loadIdentityAcceptanceApplication<T>(env: NodeJS.ProcessEnv, manifest: unknown, load: () => Promise<T>) {
  const permit = validateIdentityAcceptanceEnvironment(env, manifest);
  const application = await load();
  assertIdentityAcceptancePermit(permit, env);
  return { application, permit };
}
