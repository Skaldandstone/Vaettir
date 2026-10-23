// Existing catalog, preserved independently of seat/subscription pricing.
export const CREDIT_TOPUP_PACKS = {
  "500": { credits: 500, priceUsdCents: 1000 },
  "2000": { credits: 2000, priceUsdCents: 3500 },
  "10000": { credits: 10000, priceUsdCents: 15000 },
} as const;
export type CreditTopupPackKey = keyof typeof CREDIT_TOPUP_PACKS;
