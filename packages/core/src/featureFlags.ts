// P12-07: plan-tier feature-flag plumbing. Data (PlanTier.enabledFeatures),
// not scattered `if (org.planTier.key === "business")` checks wherever a
// gated feature happens to live -- a specific tier can gate a specific
// feature set once those are actually mapped. Nothing calls
// tierHasFeature() to actually gate anything yet; every feature built so
// far is available on every tier. This is the ready-to-fill lookup, not a
// retrofit of existing features.
export function tierHasFeature(tier: { enabledFeatures: string[] }, flag: string): boolean {
  return tier.enabledFeatures.includes(flag);
}
