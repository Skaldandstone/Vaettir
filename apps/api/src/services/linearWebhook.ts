import type { PrismaClient } from "@vaettir/db";
import type { LinearWebhookPayload } from "./linearApi.js";

/**
 * P9-02: routed per-org via the URL itself (/webhooks/linear/:organizationId
 * in server.ts), not by matching a field inside the payload - Linear's
 * webhook envelope carries nothing that identifies which Vaettir org it
 * belongs to, and each org configures its own webhook (with its own
 * signing secret) pointing at its own URL, the same per-org-URL shape
 * Organization.slackWebhookUrl already uses.
 */

export interface LinearWebhookResult {
  handled: boolean;
  reason?: string;
  requirementId?: string;
}

export async function handleLinearWebhook(
  prisma: PrismaClient,
  organizationId: string,
  payload: LinearWebhookPayload,
): Promise<LinearWebhookResult> {
  if (payload.type !== "Issue") {
    return { handled: false, reason: `ignored type: ${payload.type ?? "unknown"}` };
  }

  const identifier = payload.data?.identifier;
  if (!identifier) {
    return { handled: false, reason: "payload has no data.identifier" };
  }

  const stateName = payload.data?.state?.name;
  if (!stateName) {
    return { handled: false, reason: "payload has no data.state.name" };
  }

  const requirement = await prisma.requirement.findFirst({
    where: { linearIssueId: identifier, project: { organizationId } },
  });
  if (!requirement) {
    return { handled: false, reason: `no requirement in this org is linked to Linear issue ${identifier}` };
  }

  await prisma.requirement.update({
    where: { id: requirement.id },
    data: { linearStatusName: stateName, linearSyncedAt: new Date() },
  });

  return { handled: true, requirementId: requirement.id };
}
