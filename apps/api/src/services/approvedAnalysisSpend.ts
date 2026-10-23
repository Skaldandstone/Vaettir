import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, type PrismaClient } from "@vaettir/db";

/** Only server queue execution constructs this context. It is not an RPC input. */
export interface ApprovedAnalysisSpend {
  organizationId: string;
  caseId: string;
  inputHash: string;
  operation: "assessTestCaseRisk" | "reviewTestDesign";
  maximumCredits: number;
  chargeId?: string;
  validate: (
    tx: Prisma.TransactionClient,
    boundary: "RESERVATION" | "CHARGE",
  ) => Promise<void>;
  recordCharge: (
    tx: Prisma.TransactionClient,
    transactionId: string,
    credits: number,
  ) => Promise<void>;
  /** Returns false for an already reconciled receipt; preserves one refund. */
  recordMeter: (
    tx: Prisma.TransactionClient,
    transactionId: string,
    facts: { actualCredits: number; refund: number; excessNotCharged: number },
  ) => Promise<boolean>;
}
const spending = new AsyncLocalStorage<ApprovedAnalysisSpend>();
export class ApprovedAnalysisSpendRefusal extends Error {
  readonly definitiveNoCharge = true;
  constructor(
    public readonly reason: "CANCELLED" | "ACCESS" | "STALE" | "BUDGET",
    message: string,
  ) {
    super(message);
    this.name = "ApprovedAnalysisSpendRefusal";
  }
}
export const currentApprovedAnalysisSpend = () => spending.getStore();
export function withApprovedAnalysisSpend<T>(
  scope: ApprovedAnalysisSpend,
  work: () => Promise<T>,
) {
  return spending.run(scope, work);
}
export function isDefinitiveAnalysisSpendRefusal(error: unknown) {
  for (let depth = 0; depth < 4 && error instanceof Error; depth++) {
    if (error instanceof ApprovedAnalysisSpendRefusal) return true;
    error = error.cause;
  }
  return false;
}
export async function assertApprovedAnalysisReservation(
  db: PrismaClient,
  caseId: string,
  inputHash: string,
) {
  const scope = spending.getStore();
  if (!scope) return;
  if (scope.caseId !== caseId || scope.inputHash !== inputHash)
    throw new ApprovedAnalysisSpendRefusal(
      "STALE",
      "The approved queue item differs from this analysis input.",
    );
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${scope.organizationId} FOR UPDATE`;
    await scope.validate(tx, "RESERVATION");
  });
}
