import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@vaettir/db";

/** Only native event identities or a bounded tuple of relevant scalar payload
 * fields enter this digest. Never retain the raw alert body or credentials.
 * Legacy deliveries without an event identity deduplicate exact normalized
 * payloads; they cannot distinguish two otherwise identical new incidents.
 */
export function productionIncidentKey(provider: "pagerduty" | "datadog", organizationId: string, eventId: unknown, fallback: readonly unknown[]) {
  const nativeId = typeof eventId === "string" && eventId.length > 0 && eventId.length <= 500 ? eventId : null;
  const fields = fallback.map(value => typeof value === "string" ? ["string", createHash("sha256").update(value).digest("hex")] : typeof value === "number" || typeof value === "boolean" ? value : null);
  return createHash("sha256").update(JSON.stringify([provider, organizationId, nativeId ? ["event", nativeId] : ["legacy", fields]])).digest("hex");
}

export async function findProductionIncidentReceipt(prisma: PrismaClient, key: string) {
  return prisma.productionIncidentReceipt.findUnique({ where: { key }, select: { riskFlagId: true } });
}

/** Claim and flag are one transaction. PostgreSQL's unique receipt key chooses
 * exactly one concurrent winner; a lost HTTP response can safely be retried.
 * The receipt has no RiskFlag FK and survives removal of the flag itself.
 */
export async function recordProductionIncident(prisma: PrismaClient, input: {
  key: string; provider: "pagerduty" | "datadog"; organizationId: string; projectId: string;
  releaseId: string; severity: "CRITICAL" | "HIGH" | "MEDIUM"; description: string;
}) {
  const riskFlagId = randomUUID();
  try {
    await prisma.$transaction(async tx => {
      await tx.productionIncidentReceipt.create({ data: { key: input.key, provider: input.provider, organizationId: input.organizationId, projectId: input.projectId, riskFlagId } });
      await tx.riskFlag.create({ data: { id: riskFlagId, releaseId: input.releaseId, severity: input.severity, source: "PRODUCTION_INCIDENT", description: input.description } });
    });
    return { created: true, riskFlagId };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const receipt = await findProductionIncidentReceipt(prisma, input.key);
    if (!receipt) throw error;
    return { created: false, riskFlagId: receipt.riskFlagId };
  }
}
