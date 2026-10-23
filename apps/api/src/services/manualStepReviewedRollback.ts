import { Prisma } from "@vaettir/db";

const TOTAL_BUDGET_MS = 20000;
/** Only engine-identified, failed-transaction rollback qualifies. A business,
 * transport, unique-key or lookalike error is not proof that retry is safe. */
export function isReviewedStepRollback(cause: unknown): boolean {
  return (
    cause instanceof Prisma.PrismaClientKnownRequestError &&
    (cause.code === "P2034" ||
      (cause.code === "P2010" && cause.meta?.code === "40001"))
  );
}

/** Applied only to the schema-parsed, newly copied request and captured actor;
 * never freezes a caller's original draft or modifies raw text/array order. */
export function freezeReviewedStepValue<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeReviewedStepValue(child);
    Object.freeze(value);
  }
  return value;
}

export type ReviewedStepTransactionBudget = Readonly<{
  timeout: number;
  maxWait: number;
}>;
/** At most two NEW transactions, with the same captured request/actor closure.
 * Queue allowance plus transaction allowance share a monotonic 20s budget.
 * Exhaustion rethrows the actual rollback, NOT a semantic CAS conflict or a
 * claim that an earlier attempt with this UUID was never accepted elsewhere.
 * Do not race a live transaction against a timer: it could still commit. */
export async function withReviewedStepRollback<T>(
  execute: (budget: ReviewedStepTransactionBudget) => Promise<T>,
  now: () => number = () => performance.now(),
): Promise<T> {
  const started = now();
  let previous: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = now();
    const remaining = Math.floor(TOTAL_BUDGET_MS - (current - started));
    if (
      !Number.isFinite(started) ||
      !Number.isFinite(current) ||
      current < started ||
      remaining < 2
    ) {
      if (attempt > 0) throw previous;
      throw Error(
        "Reviewed step transaction budget is unavailable; no transaction was started.",
      );
    }
    const maxWait = Math.min(5000, Math.max(1, Math.floor(remaining / 4)));
    const budget = Object.freeze({ maxWait, timeout: remaining - maxWait });
    try {
      return await execute(budget);
    } catch (cause) {
      if (attempt === 1 || !isReviewedStepRollback(cause)) throw cause;
      previous = cause;
    }
  }
  // Loop always returns or throws; no third transaction can be reached.
  throw previous;
}
