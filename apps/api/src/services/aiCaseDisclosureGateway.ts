import { createHash } from "node:crypto";
import { AI_CASE_SCOPE, aiCaseSnapshot } from "./aiCaseDisclosure.js";
import { AI_READ_TOKEN, AI_READ_PROJECT_ID, AiDisclosureDenied, permitted, type AiReadStore, type AiReadDecision } from "./aiDisclosureGateway.js";

export async function readAiApprovedCases(store: AiReadStore, token: string, projectId: string, now?: Date) {
  if (!AI_READ_TOKEN.test(token) || !AI_READ_PROJECT_ID.test(projectId) || (now !== undefined && !Number.isFinite(now.getTime())))
    throw new AiDisclosureDenied();
  const result = await store.transaction(async tx => {
    const grant = await tx.resolveGrant(createHash("sha256").update(token).digest("hex"));
    if (!grant) return null;
    const audit = (decision: AiReadDecision) => tx.audit({ decision, reason: decision === "ALLOW" ? "APPROVED" : "POLICY_DENIED", grantId: grant.id, organizationId: grant.organizationId, projectId: grant.projectId, principalId: grant.principalId, recipient: "codex", policyVersion: 1 });
    const allowed = () => store.deploymentAllows(grant.organizationId, grant.projectId) && permitted(grant, projectId, now ?? new Date(), AI_CASE_SCOPE);
    if (!allowed() || !tx.readApprovedCases) { await audit("DENY"); return null; }
    const parsed = aiCaseSnapshot.safeParse(await tx.readApprovedCases(grant.organizationId, grant.projectId, grant.id));
    if (!parsed.success || !allowed() || parsed.data.organizationId !== grant.organizationId || parsed.data.projectId !== projectId || parsed.data.classificationVersion !== grant.classificationVersion) {
      await audit("DENY"); return null;
    }
    // Commit the durable audit before content is released. Audit failure throws
    // and rolls back; no response or content cache survives a denied read.
    await audit("ALLOW");
    return { policyVersion: 1 as const, disclosure: AI_CASE_SCOPE, snapshot: parsed.data };
  });
  if (!result) throw new AiDisclosureDenied();
  return result;
}
