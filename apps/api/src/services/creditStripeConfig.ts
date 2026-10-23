import Stripe from "stripe";
import { getStripeRuntime } from "./stripeConfig.js";
import { encryptToken } from "./tokenEncryption.js";

export const CREDIT_STRIPE_API_VERSION = "2026-09-30.endive" as const;
const keyPattern = /^rk_live_[A-Za-z0-9_]+$/;
const accountPattern = /^acct_[A-Za-z0-9]+$/;
const webhookPattern = /^whsec_[A-Za-z0-9]+$/;
export type CreditStripeRuntime = {
  stripe: Stripe;
  webhookSecret: string;
  mode: "sandbox" | "live";
  accountId: string;
};

// Credit-only live configuration is deliberately separate from the original
// sandbox subscription integration. It never enables seat/plan checkout.
export function getCreditStripeRuntime(
  env: NodeJS.ProcessEnv = process.env,
): CreditStripeRuntime | null {
  const key = env.VAETTIR_STRIPE_CREDITS_LIVE_KEY;
  const secret = env.VAETTIR_STRIPE_CREDITS_WEBHOOK_SECRET;
  const account = env.VAETTIR_STRIPE_CREDITS_ACCOUNT_ID;
  if (!key && !secret && !account) {
    const test = getStripeRuntime(env);
    return test ? { ...test, mode: "sandbox", accountId: "sandbox" } : null;
  }
  if (
    env.NODE_ENV !== "production" ||
    !key ||
    !keyPattern.test(key) ||
    !secret ||
    !webhookPattern.test(secret) ||
    !account ||
    !accountPattern.test(account)
  )
    throw new Error(
      "Credit payment configuration is incomplete or does not match this environment.",
    );
  return {
    stripe: new Stripe(key, {
      apiVersion: CREDIT_STRIPE_API_VERSION,
      maxNetworkRetries: 1,
      timeout: 10000,
    }),
    webhookSecret: secret,
    mode: "live",
    accountId: account,
  };
}

export function creditPurchasesEnabled(
  organizationId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  try {
    const runtime = getCreditStripeRuntime(env);
    if (!runtime) return false;
    const origin = new URL(env.VAETTIR_BILLING_RETURN_ORIGIN ?? "");
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.origin !== env.VAETTIR_BILLING_RETURN_ORIGIN
    )
      return false;
    encryptToken("credit-checkout-storage-probe", env);
    if (runtime.mode === "sandbox") return true;
    // Bounded rollout to explicitly selected workspaces; settlement of an
    // already-paid purchase remains enabled even if new sales are disabled.
    return (
      origin.origin === "https://vaettir.skaldandstone.com" &&
      env.VAETTIR_LIVE_CREDIT_PURCHASES_ENABLED === "true" &&
      (env.VAETTIR_LIVE_CREDIT_ORGANIZATIONS ?? "")
        .split(",")
        .map((x) => x.trim())
        .includes(organizationId)
    );
  } catch {
    return false;
  }
}
