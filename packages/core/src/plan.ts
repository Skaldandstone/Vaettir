// Seat-based plan enforcement. Pure functions over plain data (no Prisma
// import here -- callers pass the PlanTier row and current counts) so this
// stays testable and usable from both the API and any future billing job.

export interface PlanTierLimits {
  key: string;
  minFullSeats: number;
  maxFullSeats: number | null; // null = unlimited
  includedReadOnlySeats: number;
  maxReadOnlySeats: number | null; // null = unlimited
}

export interface SeatCounts {
  fullSeats: number;
  readOnlySeats: number;
}

export type SeatType = "FULL" | "READ_ONLY";

export interface SeatCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Can this org add one more seat of the given type on its current plan tier?
 * Read-only seats on the Free tier are always rejected outright (Free
 * includes zero read-only seats, by design -- not just "zero remaining").
 */
export function canAddSeat(tier: PlanTierLimits, current: SeatCounts, seatType: SeatType): SeatCheckResult {
  if (seatType === "READ_ONLY") {
    if (tier.maxReadOnlySeats === 0) {
      return { allowed: false, reason: `${tier.key} plan does not include read-only seats` };
    }
    if (tier.maxReadOnlySeats !== null && current.readOnlySeats >= tier.maxReadOnlySeats) {
      return { allowed: false, reason: `read-only seat limit (${tier.maxReadOnlySeats}) reached for ${tier.key} plan` };
    }
    return { allowed: true };
  }

  if (tier.maxFullSeats !== null && current.fullSeats >= tier.maxFullSeats) {
    return { allowed: false, reason: `full seat limit (${tier.maxFullSeats}) reached for ${tier.key} plan` };
  }
  return { allowed: true };
}

/**
 * Given a target full-seat count, which tier (by key) is the minimum one
 * that accommodates it? Used to prompt an upgrade before a seat add would
 * otherwise be rejected, and to validate a manually-selected plan against
 * actual usage.
 */
export function minimumTierForSeatCount(tiers: PlanTierLimits[], fullSeatCount: number): PlanTierLimits {
  if (tiers.length === 0) {
    throw new Error("minimumTierForSeatCount requires at least one tier");
  }
  const sorted = [...tiers].sort((a, b) => a.minFullSeats - b.minFullSeats);
  const fit = sorted.find(
    (t) => fullSeatCount >= t.minFullSeats && (t.maxFullSeats === null || fullSeatCount <= t.maxFullSeats),
  );
  // Falls through to the top tier if the count exceeds every bounded tier.
  return fit ?? sorted[sorted.length - 1]!;
}
