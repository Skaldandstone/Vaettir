import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@vaettir/db";
import { decryptToken } from "./tokenEncryption.js";

/**
 * P9-02: Linear integration - "link Requirements to Linear issues
 * bidirectionally, sync status." This pass covers the pull direction of
 * that bidirectionality (a Linear issue's status flows into the linked
 * Requirement, via a real-time inbound webhook or a manual re-sync) plus
 * the initial link-and-validate call; pushing Vaettir's own state back out
 * to Linear, and the later "Linear app with a custom panel" phase the
 * ticket itself describes as a "then," are real follow-up work, same
 * "starts as X, grows into Y" scoping P9-01/P9-03 already use.
 *
 * Every endpoint/header/payload detail below is sourced from Linear's own
 * first-party developer docs (linear.app/developers) - fetchable directly,
 * unlike SmartBear's documentation site (which blocks automated fetches).
 * No Linear workspace or API key exists in this environment to exercise
 * these calls against a real server.
 */

export class LinearApiError extends Error {}

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

export interface LinearIssueSummary {
  id: string;
  identifier: string; // e.g. "ENG-123"
  title: string;
  stateName: string;
  url: string;
}

interface LinearIssueQueryResponse {
  data?: { issue: { id: string; identifier: string; title: string; state: { name: string }; url: string } | null };
  errors?: { message: string }[];
}

// Linear's personal API keys are sent as the raw Authorization header value
// - no "Bearer " prefix (that prefix is reserved for OAuth access tokens,
// a different auth mode this pass doesn't use).
export async function fetchLinearIssue(apiKey: string, issueIdentifier: string): Promise<LinearIssueSummary> {
  let response: Response;
  try {
    response = await fetch(LINEAR_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: apiKey },
      body: JSON.stringify({
        query: `query($id: String!) { issue(id: $id) { id identifier title state { name } url } }`,
        variables: { id: issueIdentifier },
      }),
    });
  } catch (err) {
    throw new LinearApiError(`Could not reach Linear: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    throw new LinearApiError(
      response.status === 401
        ? "Linear rejected the API key (401) - check it hasn't been revoked."
        : `Linear API request failed with HTTP ${response.status}.`,
    );
  }
  const body = (await response.json()) as LinearIssueQueryResponse;
  if (body.errors && body.errors.length > 0) {
    throw new LinearApiError(`Linear API error: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (!body.data?.issue) {
    throw new LinearApiError(`Linear issue "${issueIdentifier}" was not found (or this API key can't see it).`);
  }
  const issue = body.data.issue;
  return { id: issue.id, identifier: issue.identifier, title: issue.title, stateName: issue.state.name, url: issue.url };
}

// Linear's Linear-Signature header is a bare hex HMAC-SHA256 of the raw
// body - no "sha256="/"v1=" prefix, unlike GitHub's or PagerDuty's own
// signature formats (each provider genuinely differs here; confirmed
// against Linear's own docs rather than assumed from precedent).
export function verifyLinearSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export class LinearNotConfiguredError extends LinearApiError {}

// Decrypts the org's stored Linear API key, or throws a specific error
// distinguishing "never configured" from a real decryption failure -
// callers (requirements.linkLinearIssue/syncLinearStatus) turn the former
// into a clear "connect Linear first" message rather than a generic one.
export async function getOrgLinearApiKey(prisma: PrismaClient, organizationId: string): Promise<string> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { linearEncryptedApiKey: true, linearApiKeyIv: true, linearApiKeyAuthTag: true },
  });
  if (!org.linearEncryptedApiKey || !org.linearApiKeyIv || !org.linearApiKeyAuthTag) {
    throw new LinearNotConfiguredError("This organization has not connected a Linear API key yet.");
  }
  return decryptToken({ ciphertext: org.linearEncryptedApiKey, iv: org.linearApiKeyIv, authTag: org.linearApiKeyAuthTag });
}

export interface LinearWebhookPayload {
  type?: string;
  action?: string;
  data?: {
    identifier?: string;
    title?: string;
    state?: { name?: string };
    url?: string;
  };
}
