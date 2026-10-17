import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { forgeQualityBinding } from "./atlassianQualitySharing.js";
import { productJson, type ForgeIdentity } from "./forgeInvocation.js";

const purpose = "vaettir/forge-project-connection/v1";
export const forgeConnectionLifetimeMs = 15 * 60 * 1000;
export const forgeConnectionToken = z.string().min(80).max(4096).regex(/^[A-Za-z0-9_-]+$/);
const payload = z.object({
  purpose: z.literal(purpose),
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
  connectionId: z.string().uuid(),
  binding: forgeQualityBinding,
  targetLabel: z.string().min(1).max(300),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
}).strict();

function key(env: NodeJS.ProcessEnv) {
  const master = Buffer.from(env.PRODUCTION_SIGNAL_ENCRYPTION_KEY ?? "", "base64");
  if (master.length !== 32) throw new Error("Project connection handoff is not configured.");
  // A purpose-specific key and authenticated domain separate this from stored
  // provider credentials. No provider or Clerk bearer token enters the handoff.
  return createHmac("sha256", master).update(purpose).digest();
}

export function readForgeConnectionRequest(token: string, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  const bytes = Buffer.from(forgeConnectionToken.parse(token), "base64url");
  if (bytes.toString("base64url") !== token || bytes.length < 29) throw new Error("Invalid project connection request.");
  const decipher = createDecipheriv("aes-256-gcm", key(env), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const value = payload.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")));
  if (value.issuedAt > now || value.expiresAt <= now || value.expiresAt - value.issuedAt !== forgeConnectionLifetimeMs ||
      value.binding.appId !== env.VAETTIR_FORGE_APP_ID || value.binding.environmentId !== env.VAETTIR_FORGE_ENVIRONMENT_ID)
    throw new Error("Project connection request expired or its application changed.");
  return value;
}

export function issueForgeConnectionRequest(identity: ForgeIdentity, targetLabel: string, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  const { appId, installationId, environmentId, cloudId, siteOrigin, product, targetId } = identity;
  const value = payload.parse({ purpose, nonce: randomBytes(32).toString("hex"), connectionId: randomUUID(),
    binding: { appId, installationId, environmentId, cloudId, siteOrigin, product, targetId }, targetLabel,
    issuedAt: now, expiresAt: now + forgeConnectionLifetimeMs });
  if (appId !== env.VAETTIR_FORGE_APP_ID || environmentId !== env.VAETTIR_FORGE_ENVIRONMENT_ID)
    throw new Error("Project connection application mismatch.");
  const origin = new URL(env.WEB_APP_URL || "https://vaettir.skaldandstone.com");
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.port || origin.search || origin.hash || origin.pathname !== "/")
    throw new Error("Trusted Vaettir web origin is required.");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(env), iv);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const requestToken = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  const url = new URL("/integrations/atlassian/connect", origin);
  url.searchParams.set("request", requestToken);
  return { connectionUrl: url.href, expiresAt: new Date(value.expiresAt).toISOString(), targetLabel, product };
}

export const forgeConnectionDigest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function readForgeConnectionTarget(identity: ForgeIdentity, userToken: string, transport: typeof fetch = fetch) {
  if (identity.product === "confluence") return `Confluence space ${identity.targetId}`;
  const project = z.object({ id: z.literal(identity.targetId), key: z.string().min(1).max(100), name: z.string().min(1).max(200) }).parse(
    await productJson(`${identity.apiBaseUrl}/rest/api/3/project/${identity.targetId}`, userToken, transport),
  );
  return `${project.name} (${project.key})`;
}
