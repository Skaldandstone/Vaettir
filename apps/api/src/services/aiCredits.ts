import type { PrismaClient } from "@vaettir/db";

// Flat per-operation costs rather than exact token metering: none of the
// ai-agent package's functions currently return token usage from the
// Anthropic response, and plumbing that through every call site is a
// larger follow-up (see PRICING.md). Each cost below is a conservative
// (roughly 2x headroom over a single-shot estimate, to absorb retries and
// longer-than-typical inputs) credits-per-call figure, sized so 1 credit
// ~= $0.01 of underlying Claude API spend -- see PRICING.md for the actual
// token/cost math behind each number.
export const AI_OPERATION_COSTS = {
  reverseEngineerTestFile: 6,
  inferCustomFrameworkHeuristic: 3,
  recommendTestPlansForDiff: 8,
  assessTestCaseRisk: 2,
  generateQaStrategyDraft: 10,
  classifyTestFailure: 7,
  generateTestCasesFromRequirement: 8,
  extractRequirementsFromMarkdown: 4,
} as const;

export type AiOperation = keyof typeof AI_OPERATION_COSTS;

export class InsufficientAiCreditsError extends Error {
  constructor(
    public readonly operation: string,
    public readonly required: number,
    public readonly balance: number,
  ) {
    super(`Insufficient AI credits for "${operation}": needs ${required}, org has ${balance}.`);
    this.name = "InsufficientAiCreditsError";
  }
}

// Balance is the sum of the org's ledger, not a stored counter -- see the
// schema comment on AiCreditTransaction for why (auditability, matches the
// AuditLog pattern already used elsewhere in this codebase).
export async function getAiCreditBalance(prisma: PrismaClient, organizationId: string): Promise<number> {
  const result = await prisma.aiCreditTransaction.aggregate({
    where: { organizationId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

// Checks balance and records the CONSUMPTION transaction atomically enough
// for this scale (an aggregate read + a create, not wrapped in a DB
// transaction) -- a race between two simultaneous AI calls on the same org
// could theoretically both pass the check and slightly overdraw the
// balance. Acceptable for now: the cost of a rare few-credit overdraw is
// far lower than the complexity of serializing every AI call per org.
// Throws InsufficientAiCreditsError (not a generic Error) so callers can
// surface a specific, actionable message rather than a generic failure.
export async function chargeAiCredits(
  prisma: PrismaClient,
  organizationId: string,
  operation: AiOperation,
  description?: string,
): Promise<void> {
  const cost = AI_OPERATION_COSTS[operation];
  const balance = await getAiCreditBalance(prisma, organizationId);
  if (balance < cost) {
    throw new InsufficientAiCreditsError(operation, cost, balance);
  }
  await prisma.aiCreditTransaction.create({
    data: { organizationId, type: "CONSUMPTION", amount: -cost, operation, description },
  });
}

// Monthly grant, idempotent per calendar month: checks for a GRANT
// transaction already recorded this UTC month before creating one, so
// re-running this (e.g. from a scheduler tick, or a manual admin trigger)
// never double-grants. 0-credit tiers still record a $0 grant transaction
// (skipped below since a 0-amount ledger row is pure noise) -- Free tier
// orgs simply have no GRANT rows and a correspondingly-usable balance of 0
// plus whatever they've bought via TOPUP.
export async function grantMonthlyCreditsIfNeeded(prisma: PrismaClient, organizationId: string): Promise<void> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    include: { planTier: { select: { key: true, includedAiCreditsPerMonth: true } } },
  });
  if (org.planTier.includedAiCreditsPerMonth <= 0) return;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const alreadyGranted = await prisma.aiCreditTransaction.findFirst({
    where: { organizationId, type: "GRANT", createdAt: { gte: monthStart } },
  });
  if (alreadyGranted) return;

  await prisma.aiCreditTransaction.create({
    data: {
      organizationId,
      type: "GRANT",
      amount: org.planTier.includedAiCreditsPerMonth,
      description: `Monthly grant, ${org.planTier.key} tier`,
    },
  });
}
