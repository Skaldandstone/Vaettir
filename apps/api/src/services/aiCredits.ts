import type { PrismaClient, Prisma } from "@vaettir/db";
import { assertActiveOrganization, lockOrganization } from "./organizationLock.js";
import { PRIVATE_BETA_TIER } from "./privateBeta.js";

// Credits are product allowances, not a dollar spending guarantee.
export const AI_OPERATION_COSTS = {
  reverseEngineerTestFile: 6, inferCustomFrameworkHeuristic: 3,
  recommendTestPlansForDiff: 8, assessTestCaseRisk: 2,
  generateQaStrategyDraft: 10, classifyTestFailure: 7,
  generateTestCasesFromRequirement: 8, extractRequirementsFromMarkdown: 4,
  generateReleaseSummary: 6,
} as const;
export type AiOperation = keyof typeof AI_OPERATION_COSTS;

export class InsufficientAiCreditsError extends Error {
  constructor(public readonly operation: string, public readonly required: number, public readonly balance: number) {
    super(`Insufficient AI credits for "${operation}": needs ${required}, org has ${balance}.`);
    this.name = "InsufficientAiCreditsError";
  }
}

export function creditMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function ledgerBalance(db: Prisma.TransactionClient, organizationId: string) {
  const result = await db.aiCreditTransaction.aggregate({ where: { organizationId }, _sum: { amount: true } });
  return result._sum.amount ?? 0;
}

// Caller holds the org row lock. Append expiry and grant; never rewrite history.
// Existing non-beta rollover is deliberately preserved.
async function grantLocked(tx: Prisma.TransactionClient, organizationId: string, now = new Date()) {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, include: { planTier: true } });
  const monthStart = creditMonth(now);
  const grantKey = `grant:${monthStart.toISOString().slice(0, 7)}`;
  const granted = await tx.aiCreditTransaction.findFirst({
    where: { organizationId, type: "GRANT", createdAt: { gte: monthStart } },
  });
  if (granted) return;
  if (org.planTier.key === PRIVATE_BETA_TIER) {
    const carried = await ledgerBalance(tx, organizationId);
    if (carried !== 0) await tx.aiCreditTransaction.create({ data: {
      organizationId, type: "ADJUSTMENT", amount: -carried,
      idempotencyKey: `expiry:${monthStart.toISOString().slice(0, 7)}`,
      description: "Private beta monthly reset: unused allowance does not roll over.",
    } });
  }
  if (org.planTier.includedAiCreditsPerMonth > 0) await tx.aiCreditTransaction.create({ data: {
    organizationId, type: "GRANT", amount: org.planTier.includedAiCreditsPerMonth,
    idempotencyKey: grantKey, description: `Monthly grant, ${org.planTier.key} tier`,
  } });
}

export async function getAiCreditBalance(db: PrismaClient, organizationId: string): Promise<number> {
  await grantMonthlyCreditsIfNeeded(db, organizationId);
  return ledgerBalance(db, organizationId);
}

export async function chargeAiCredits(
  db: PrismaClient, organizationId: string, operation: AiOperation,
  description?: string, idempotencyKey?: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    assertActiveOrganization(await lockOrganization(tx, organizationId));
    if (idempotencyKey) {
      const previous = await tx.aiCreditTransaction.findUnique({
        where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: `charge:${idempotencyKey}` } },
      });
      if (previous) {
        if (previous.operation !== operation) throw new Error("AI charge idempotency key reused for a different operation");
        return;
      }
    }
    await grantLocked(tx, organizationId);
    const balance = await ledgerBalance(tx, organizationId);
    const cost = AI_OPERATION_COSTS[operation];
    if (balance < cost) throw new InsufficientAiCreditsError(operation, cost, balance);
    await tx.aiCreditTransaction.create({ data: {
      organizationId, type: "CONSUMPTION", amount: -cost, operation, description,
      idempotencyKey: idempotencyKey ? `charge:${idempotencyKey}` : undefined,
    } });
  }, { maxWait: 10000, timeout: 10000 });
}

export async function grantMonthlyCreditsIfNeeded(db: PrismaClient, organizationId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const org = await lockOrganization(tx, organizationId);
    if (org.suspendedAt) return;
    await grantLocked(tx, organizationId);
  }, { maxWait: 10000, timeout: 10000 });
}

export async function adjustAiCredits(db: PrismaClient, organizationId: string, amount: number, description: string) {
  return db.$transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    await grantLocked(tx, organizationId);
    const balance = await ledgerBalance(tx, organizationId);
    if (balance + amount < 0) throw new Error("A credit adjustment cannot overdraw the balance");
    await tx.aiCreditTransaction.create({ data: { organizationId, type: "ADJUSTMENT", amount, description } });
    return { balance: balance + amount };
  });
}
