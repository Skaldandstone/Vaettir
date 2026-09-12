import type { PrismaClient } from "@vaettir/db";
import { captureAiUsage } from "@vaettir/ai-agent";

// Flat per-operation costs, charged up front as a pre-authorization: the
// balance has to be checked and something charged before the AI call runs
// (its real cost isn't known yet), so this stays the affordability gate.
// As of this pass (P2-09/P12-12), the flat charge is reconciled to the
// call's REAL metered cost afterward via an ADJUSTMENT transaction (see
// meterAiCall below) -- so what an org's balance actually reflects is real
// usage, not the flat estimate. The conversion rate is a guestimate pending
// a real pricing audit (see PRICING.md's "1 credit ~= $0.01" section and the
// $3/M-input, $15/M-output assumed Claude Sonnet-class rate it documents) -
// intentionally not exact yet, per the explicit go-ahead to wire this now
// and audit the real numbers once usage data has accumulated.
// Each flat cost below is a conservative (roughly 2x headroom over a
// single-shot estimate, to absorb retries and longer-than-typical inputs)
// credits-per-call figure, sized so 1 credit ~= $0.01 of underlying Claude
// API spend -- see PRICING.md for the actual token/cost math behind each
// number. These now function as the pre-charge/affordability floor, not the
// final charge.
export const AI_OPERATION_COSTS = {
  reverseEngineerTestFile: 6,
  inferCustomFrameworkHeuristic: 3,
  recommendTestPlansForDiff: 8,
  assessTestCaseRisk: 2,
  generateQaStrategyDraft: 10,
  classifyTestFailure: 7,
  generateTestCasesFromRequirement: 8,
  extractRequirementsFromMarkdown: 4,
  generateReleaseSummary: 6,
  reviewTestCaseQuality: 12,
  // SSE-181: a genuine temp/guestimate cost, higher than any text-only
  // operation above - this is the only AI_OPERATION_COSTS entry that also
  // pays for real browser/crawl compute (a headless Chromium launch +
  // navigation across up to 5 pages), not just an LLM call. No real cost
  // data exists yet for that crawl compute; revisit once this has real
  // usage, same as every other flat figure here.
  generateTestCasesFromLiveApp: 15,
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
export interface AiCharge {
  transactionId: string;
}

export async function chargeAiCredits(
  prisma: PrismaClient,
  organizationId: string,
  operation: AiOperation,
  description?: string,
): Promise<AiCharge> {
  const cost = AI_OPERATION_COSTS[operation];
  const balance = await getAiCreditBalance(prisma, organizationId);
  if (balance < cost) {
    throw new InsufficientAiCreditsError(operation, cost, balance);
  }
  const tx = await prisma.aiCreditTransaction.create({
    data: { organizationId, type: "CONSUMPTION", amount: -cost, operation, description },
    select: { id: true },
  });
  return { transactionId: tx.id };
}

// Guestimate conversion from real token usage to credits, matching
// PRICING.md's assumed Claude Sonnet-class rate ($3/M input tokens, $15/M
// output tokens) at $0.01/credit. Explicitly a guestimate pending a real
// pricing audit once usage data has accumulated -- not exact per-model
// pricing, and not adjusted per the `model` field actually charged.
const CREDITS_PER_INPUT_TOKEN = 3 / 1_000_000 / 0.01;
const CREDITS_PER_OUTPUT_TOKEN = 15 / 1_000_000 / 0.01;

// Rounds up: undercharging every call by a fraction of a credit compounds
// over volume in the org's favor and ours against; overcharging by at most
// one credit per call does not. Rounded to 6 decimal places before ceiling
// -- 0.0003/0.0015 aren't exactly representable in binary floating point, so
// a "should be exactly 3.0" result can land at 3.0000000000000004 and get
// ceiling'd to 4, silently overcharging by a full credit on otherwise-exact
// inputs. A real, reproducible bug caught while writing this function's own
// tests, not a theoretical one.
function realCostCredits(usage: { inputTokens: number; outputTokens: number }): number {
  const raw = usage.inputTokens * CREDITS_PER_INPUT_TOKEN + usage.outputTokens * CREDITS_PER_OUTPUT_TOKEN;
  return Math.ceil(Math.round(raw * 1_000_000) / 1_000_000);
}

// Runs the AI call that a chargeAiCredits() row pre-authorized, stamps the
// row with what it really cost upstream (tokens, request count, model), and
// reconciles the flat pre-charge to that real cost via a separate
// ADJUSTMENT transaction -- a refund (positive amount) when the real cost
// came in under the flat estimate, an extra deduction (negative amount)
// when it ran over. This is what makes the org's actual balance track real
// usage instead of the flat per-operation guess, per P12-12's own note that
// the flat charge was "recorded only" pending this exact reconciliation.
// Both the stamp and the adjustment are best-effort and happen after the
// result is in hand: a failed usage write or adjustment must never turn a
// successful AI call into a failed request, so both are caught and reported
// rather than thrown. If the AI call itself throws, nothing is stamped or
// adjusted -- the row keeps its flat charge with null usage, which is
// exactly the "charged but failed" signal the pricing review wants to see.
export async function meterAiCall<T>(prisma: PrismaClient, charge: AiCharge, fn: () => Promise<T>): Promise<T> {
  const { result, usage } = await captureAiUsage(fn);
  if (usage.calls > 0) {
    try {
      const row = await prisma.aiCreditTransaction.update({
        where: { id: charge.transactionId },
        data: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          aiCalls: usage.calls,
          model: usage.model,
        },
        select: { organizationId: true, amount: true, operation: true },
      });
      const flatCharge = -row.amount; // row.amount is negative (a CONSUMPTION deduction)
      const realCost = realCostCredits(usage);
      const adjustment = flatCharge - realCost; // positive = refund, negative = extra charge
      if (adjustment !== 0) {
        await prisma.aiCreditTransaction.create({
          data: {
            organizationId: row.organizationId,
            type: "ADJUSTMENT",
            amount: adjustment,
            operation: row.operation,
            description: `Reconciling flat charge (${flatCharge}) to real usage cost (${realCost}) for ${row.operation}`,
          },
        });
      }
    } catch (e) {
      console.error(`[aiCredits] failed to record/reconcile token usage on ${charge.transactionId}:`, e);
    }
  }
  return result;
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
