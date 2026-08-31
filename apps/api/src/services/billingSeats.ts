import type { PlanTierLimits } from "@vaettir/core";

export function effectiveSeatLimits<T extends PlanTierLimits>(org: { planTier: T; billingFullSeats: number | null }) {
  return { ...org.planTier, maxFullSeats: org.billingFullSeats === null ? org.planTier.maxFullSeats
    : Math.min(org.billingFullSeats, org.planTier.maxFullSeats ?? org.billingFullSeats) };
}
