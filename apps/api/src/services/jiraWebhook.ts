import type { PrismaClient } from "@vaettir/db";
import type { JiraWebhookPayload } from "./jiraApi.js";

/**
 * P9-01: routed per-org via the URL itself (/webhooks/jira/:organizationId
 * in server.ts), same reasoning as P9-02's Linear webhook - each org
 * configures its own Jira Automation rule pointed at its own URL, and
 * there's nothing in the customer-defined payload that identifies which
 * Vaettir org it belongs to on its own.
 */

export interface JiraWebhookResult {
  handled: boolean;
  reason?: string;
  requirementId?: string;
}

export async function handleJiraWebhook(
  prisma: PrismaClient,
  organizationId: string,
  payload: JiraWebhookPayload,
): Promise<JiraWebhookResult> {
  if (!payload.issueKey) {
    return { handled: false, reason: "payload has no issueKey" };
  }
  if (!payload.status) {
    return { handled: false, reason: "payload has no status" };
  }

  const requirement = await prisma.requirement.findFirst({
    where: { jiraIssueKey: payload.issueKey, project: { organizationId } },
  });
  if (!requirement) {
    return { handled: false, reason: `no requirement in this org is linked to Jira issue ${payload.issueKey}` };
  }

  await prisma.requirement.update({
    where: { id: requirement.id },
    data: { jiraStatusName: payload.status, jiraSyncedAt: new Date() },
  });

  return { handled: true, requirementId: requirement.id };
}
