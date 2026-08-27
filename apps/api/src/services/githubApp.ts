import { createHmac, createSign, timingSafeEqual } from "node:crypto";

// P6-01: verifies GitHub's HMAC-SHA256 webhook signature (the
// X-Hub-Signature-256 header, "sha256=<hex>") against the RAW request body
// -- must be the exact bytes GitHub sent, not a re-serialized JSON object,
// since re-serialization can reorder keys or change whitespace and produce
// a different HMAC. timingSafeEqual (not ===) so this doesn't leak timing
// information about how much of the signature matched.
export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(`sha256=${expected}`);
  const actualBuffer = Buffer.from(signatureHeader);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function base64url(input: Buffer | string): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// A GitHub App authenticates as itself (not as any installation) via a
// short-lived RS256-signed JWT -- hand-rolled rather than pulling in a JWT
// library for one use case; the format is fixed and small (header.payload.
// signature, each base64url) and Node's crypto module already has
// everything needed to sign it correctly.
function createAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  // 60s clock-drift buffer on iat (GitHub's own recommendation), capped
  // well under GitHub's 10-minute max exp.
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKeyPem);
  return `${signingInput}.${base64url(signature)}`;
}

// Exchanges the App-level JWT for a short-lived (1hr) token scoped to one
// specific installation -- what's actually needed to call the REST API
// against that installation's repos (posting a PR comment, reading repo
// content). installationId comes from the webhook payload itself.
export async function getInstallationAccessToken(
  appId: string,
  privateKeyPem: string,
  installationId: number,
): Promise<string> {
  const jwt = createAppJwt(appId, privateKeyPem);
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to get installation access token: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { token: string };
  return body.token;
}

// P6-05: posts a PR comment using the installation token -- GitHub's REST
// API treats a PR as an "issue" for the comments endpoint (PRs are issues
// with extra fields), so this hits /issues/{number}/comments, not a
// PR-specific endpoint.
export async function postPrComment(
  installationToken: string,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${installationToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    throw new Error(`Failed to post PR comment: ${res.status} ${await res.text()}`);
  }
}
