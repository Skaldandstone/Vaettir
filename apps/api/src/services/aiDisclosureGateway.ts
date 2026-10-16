import { createHash } from "node:crypto";

// No human-session or general vt_ API-key fallback. AI credentials resolve
// exclusively in the dedicated grant store, never in the general tRPC context.
export const AI_READ_TOKEN = /^vai_[a-f0-9]{64}$/;
export const AI_READ_PROJECT_ID = /^[a-zA-Z0-9_-]{1,100}$/;
export const AI_READ_POLICY_VERSION = 1;

export type AiReadGrant = {
  id: string;
  organizationId: string;
  projectId: string;
  principalId: string;
  recipient: "codex";
  scope: "aggregate_counts";
  policyVersion: number;
  classificationVersion: number;
  expiresAt: Date;
  revoked: boolean;
  enabled: boolean;
  // Resolved live inside the store transaction, not copied from a JWT.
  organizationActive: boolean;
  principalActive: boolean;
  currentRole: string;
  projectOrganizationId: string;
  projectClassification:
    "SYNTHETIC" | "CUSTOMER_PROPRIETARY" | "REGULATED" | "UNCLASSIFIED";
  projectClassificationVersion: number;
  approvingAdminActive: boolean;
};

export type AiReadCounts = {
  testCases: number;
  testPlans: number;
  testRuns: number;
};
export type AiReadDecision = "ALLOW" | "DENY" | "SUPPRESS";
export type AiReadAudit = {
  decision: AiReadDecision;
  reason: "APPROVED" | "POLICY_DENIED" | "SMALL_COHORT" | "INVALID_COUNTS";
  grantId: string;
  organizationId: string;
  projectId: string;
  principalId: string;
  recipient: "codex";
  policyVersion: number;
};

export interface AiReadTransaction {
  resolveGrant(tokenHash: string): Promise<AiReadGrant | null>;
  // Adapter must count in SQL with BOTH scope predicates, not load test rows.
  countProject(
    organizationId: string,
    projectId: string,
  ): Promise<AiReadCounts>;
  // Await a durable record before releasing any data. Never include content,
  // bearer tokens, raw request bodies, or aggregate values in the audit record.
  audit(event: AiReadAudit): Promise<void>;
}

export interface AiReadStore {
  // Production adapter must serialize grant revocation/classification changes
  // with this read, recheck live membership, and enforce a transaction timeout.
  transaction<T>(work: (tx: AiReadTransaction) => Promise<T>): Promise<T>;
}

export type AiReadSummary = {
  policyVersion: 1;
  disclosure: "aggregate_counts";
  classification: "SYNTHETIC";
  suppressed: boolean;
  counts: AiReadCounts | null;
};

export class AiDisclosureDenied extends Error {
  constructor() {
    super("AI disclosure is not permitted.");
  }
}

function permitted(grant: AiReadGrant, projectId: string, now: Date) {
  return (
    grant.enabled &&
    !grant.revoked &&
    grant.organizationActive &&
    grant.principalActive &&
    grant.currentRole === "VIEWER" &&
    grant.approvingAdminActive &&
    grant.recipient === "codex" &&
    grant.scope === "aggregate_counts" &&
    grant.policyVersion === AI_READ_POLICY_VERSION &&
    grant.projectId === projectId &&
    grant.projectOrganizationId === grant.organizationId &&
    grant.projectClassification === "SYNTHETIC" &&
    Number.isSafeInteger(grant.classificationVersion) &&
    grant.classificationVersion >= 1 &&
    grant.classificationVersion === grant.projectClassificationVersion &&
    Number.isFinite(grant.expiresAt.getTime()) &&
    grant.expiresAt > now
  );
}

export async function readAiProjectSummary(
  store: AiReadStore,
  token: string,
  projectId: string,
  now?: Date,
): Promise<AiReadSummary> {
  if (
    !AI_READ_TOKEN.test(token) ||
    !AI_READ_PROJECT_ID.test(projectId) ||
    (now !== undefined && !Number.isFinite(now.getTime()))
  )
    throw new AiDisclosureDenied();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  // Return a denial sentinel from the transaction so its denial audit commits.
  const result = await store.transaction(async (tx) => {
    const grant = await tx.resolveGrant(tokenHash);
    if (!grant) return null;
    const audit = (decision: AiReadDecision, reason: AiReadAudit["reason"]) =>
      tx.audit({
        decision,
        reason,
        grantId: grant.id,
        organizationId: grant.organizationId,
        projectId: grant.projectId,
        principalId: grant.principalId,
        recipient: "codex",
        policyVersion: AI_READ_POLICY_VERSION,
      });
    if (!permitted(grant, projectId, now ?? new Date())) {
      await audit("DENY", "POLICY_DENIED");
      return null;
    }
    const raw = await tx.countProject(grant.organizationId, grant.projectId);
    // Positive projection: never serialize a repository object or extra fields.
    const counts = {
      testCases: raw.testCases,
      testPlans: raw.testPlans,
      testRuns: raw.testRuns,
    };
    if (!permitted(grant, projectId, now ?? new Date())) {
      await audit("DENY", "POLICY_DENIED");
      return null;
    }
    if (Object.values(counts).some((n) => !Number.isSafeInteger(n) || n < 0)) {
      await audit("DENY", "INVALID_COUNTS");
      return null;
    }
    // Suppress the entire response rather than return a small cell that can
    // be reconstructed by subtracting totals. No caller-defined filters.
    const suppressed = Object.values(counts).some((n) => n > 0 && n < 10);
    await audit(
      suppressed ? "SUPPRESS" : "ALLOW",
      suppressed ? "SMALL_COHORT" : "APPROVED",
    );
    return {
      policyVersion: AI_READ_POLICY_VERSION,
      disclosure: "aggregate_counts" as const,
      classification: "SYNTHETIC" as const,
      suppressed,
      counts: suppressed ? null : counts,
    } satisfies AiReadSummary;
  });
  if (!result) throw new AiDisclosureDenied();
  return result;
}
