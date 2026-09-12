import { timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@vaettir/db";
import { decryptToken } from "./tokenEncryption.js";

/**
 * P9-01: Jira integration - "link Requirements to Jira issues
 * bidirectionally, sync status." Same pull-direction + link-and-validate
 * scope as P9-02's Linear integration (pushing Vaettir's own state back
 * out, and the later Jira Forge app panel, are the ticket's own
 * explicitly-later "then"), but two real differences from Jira Cloud's own
 * model, both confirmed against Atlassian's own developer docs
 * (developer.atlassian.com, directly fetchable):
 *
 * - Auth is Basic (base64 "email:apiToken"), not a bearer token - Jira
 *   Cloud's REST API v3 has no personal-API-key-as-bearer mode the way
 *   Linear does.
 * - Jira Cloud has no built-in signed-webhook mechanism for a plain REST-
 *   API integration (that requires a full Connect/Forge app with its own
 *   JWT-based auth, real separate work). The realistic real-time path is a
 *   customer's own Jira Automation rule ("Send web request" with a custom
 *   header), carrying a plain shared secret Vaettir tells them to set - not
 *   a computed signature - checked the same way this codebase's GitLab
 *   webhook already verifies a plain shared token
 *   (services/gitlabApi.ts's verifyGitlabToken).
 *
 * No Jira Cloud site or API token exists in this environment to exercise
 * these calls against a real server.
 */

export class JiraApiError extends Error {}
export class JiraNotConfiguredError extends JiraApiError {}

export interface JiraConnection {
  baseUrl: string; // e.g. https://acme.atlassian.net
  email: string;
  apiToken: string;
}

export interface JiraIssueSummary {
  key: string;
  summary: string;
  statusName: string;
}

interface JiraIssueResponse {
  key: string;
  fields?: { summary?: string; status?: { name?: string } };
}

export async function fetchJiraIssue(conn: JiraConnection, issueKey: string): Promise<JiraIssueSummary> {
  const url = new URL(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, conn.baseUrl);
  url.searchParams.set("fields", "summary,status");
  const basicAuth = Buffer.from(`${conn.email}:${conn.apiToken}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(url.toString(), { headers: { Authorization: `Basic ${basicAuth}`, Accept: "application/json" } });
  } catch (err) {
    throw new JiraApiError(`Could not reach Jira: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    throw new JiraApiError(
      response.status === 401 || response.status === 403
        ? "Jira rejected the email/API token combination (401/403) - check the token hasn't been revoked."
        : response.status === 404
          ? `Jira issue "${issueKey}" was not found (or this account can't see it).`
          : `Jira API request failed with HTTP ${response.status}.`,
    );
  }
  const body = (await response.json()) as JiraIssueResponse;
  if (!body.fields?.summary || !body.fields.status?.name) {
    throw new JiraApiError(`Jira returned an unexpected response for "${issueKey}" - missing summary or status.`);
  }
  return { key: body.key, summary: body.fields.summary, statusName: body.fields.status.name };
}

export async function getOrgJiraConnection(prisma: PrismaClient, organizationId: string): Promise<JiraConnection> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      jiraBaseUrl: true,
      jiraEmail: true,
      jiraEncryptedApiToken: true,
      jiraApiTokenIv: true,
      jiraApiTokenAuthTag: true,
    },
  });
  if (!org.jiraBaseUrl || !org.jiraEmail || !org.jiraEncryptedApiToken || !org.jiraApiTokenIv || !org.jiraApiTokenAuthTag) {
    throw new JiraNotConfiguredError("This organization has not connected Jira yet.");
  }
  const apiToken = decryptToken({ ciphertext: org.jiraEncryptedApiToken, iv: org.jiraApiTokenIv, authTag: org.jiraApiTokenAuthTag });
  return { baseUrl: org.jiraBaseUrl, email: org.jiraEmail, apiToken };
}

// Plain shared-secret compare (see the file comment on why this isn't an
// HMAC signature) - same length-check-then-timingSafeEqual shape every
// other secret comparison in this codebase already uses.
export function verifyJiraWebhookSecret(headerValue: string | undefined, secret: string): boolean {
  if (!headerValue || !secret) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(headerValue);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// The exact JSON body a customer's Jira Automation "Send web request"
// action should send - documented here so the org settings UI and the
// webhook handler can never disagree about the expected shape.
export interface JiraWebhookPayload {
  issueKey?: string;
  status?: string;
}
