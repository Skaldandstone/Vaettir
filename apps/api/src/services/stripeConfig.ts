import Stripe from "stripe";

// P12-05: on direct instruction to wire real Stripe billing in sandbox now
// (proposed pricing in PRICING.md, not yet business-signed-off) rather than
// wait for a full pricing/provider decision. Test mode only, structurally --
// this file refuses to construct a client at all with anything but a
// Stripe test-mode key, and refuses outright when NODE_ENV is production,
// so there is no code path here that can touch a real card or real money.
// A future live-mode pass is a deliberate, separate decision, not a flag
// flip on this file.
export const STRIPE_API_VERSION = "2025-08-27.basil" as const;

const TEST_KEY_PATTERN = /^(?:rk|sk)_test_[A-Za-z0-9]+$/;
const TEST_WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9]+$/;

export interface StripeRuntime {
  stripe: Stripe;
  webhookSecret: string;
}

// Same "inert until configured" contract every other optional integration
// in this codebase already uses (Sentry/P10-05, Slack/P9-03, GitHub/P6-01):
// no env vars set -> null, callers treat billing as simply unavailable
// rather than erroring. A key that IS set but isn't a valid test-mode key,
// or an attempt to use this in a real production deploy, throws loudly --
// that's a misconfiguration worth failing hard on, not degrading quietly.
export function getStripeRuntime(env: NodeJS.ProcessEnv = process.env): StripeRuntime | null {
  const key = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!key && !webhookSecret) return null;

  if (env.NODE_ENV === "production") {
    throw new Error("Stripe billing is test-mode-only in this pass and is refused in production.");
  }
  if (!key || !TEST_KEY_PATTERN.test(key)) {
    throw new Error("STRIPE_SECRET_KEY must be a Stripe test-mode key (sk_test_... or rk_test_...).");
  }
  if (!webhookSecret || !TEST_WEBHOOK_SECRET_PATTERN.test(webhookSecret)) {
    throw new Error("STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret (whsec_...).");
  }

  return {
    stripe: new Stripe(key, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 1, timeout: 10_000 }),
    webhookSecret,
  };
}
