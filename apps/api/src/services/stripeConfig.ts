import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import Stripe from "stripe";
import { z } from "zod";

export const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;
export const BILLING_PRODUCT = "vaettir";
const offer = z.object({
  planKey: z.enum(["team", "business", "corp"]),
  priceId: z.string().regex(/^price_[A-Za-z0-9]+$/),
  productId: z.string().regex(/^prod_[A-Za-z0-9]+$/),
  currency: z.string().regex(/^[a-z]{3}$/),
}).strict();
export type BillingOffer = z.infer<typeof offer>;
export interface BillingConfig { environment: string; origin: string; portalConfiguration: string; offers: BillingOffer[] }
export interface BillingRuntime { config: BillingConfig; stripe: Stripe; webhookSecret: string }

// This first slice cannot enable live payments, even by setting a live key.
// Restrict test entitlements to an isolated local DB, never the deployed beta.
export function readBillingConfig(env: NodeJS.ProcessEnv = process.env): BillingConfig | null {
  if (!env.VAETTIR_BILLING_MODE || env.VAETTIR_BILLING_MODE === "disabled") return null;
  if (env.VAETTIR_BILLING_MODE !== "test" || env.NODE_ENV === "production") throw new Error("Billing is test-only and unavailable in production.");
  const db = new URL(env.DATABASE_URL ?? "invalid:");
  if (!["postgres:", "postgresql:"].includes(db.protocol) || !["localhost", "127.0.0.1"].includes(db.hostname)
    || !/^\/vaettir_[a-z0-9_]+_test$/.test(db.pathname) || db.hash
    || [...db.searchParams].some(([k, v]) => !(k === "schema" && v === "public") && !(k === "connection_limit" && /^(?:[1-9]|10)$/.test(v)))) {
    throw new Error("Test billing requires an isolated loopback test database.");
  }
  const environment = z.string().regex(/^test-[a-z0-9-]{1,48}$/).parse(env.VAETTIR_STRIPE_ENVIRONMENT);
  const url = new URL(env.VAETTIR_BILLING_RETURN_ORIGIN ?? "invalid:");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || !["localhost", "127.0.0.1"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol)) throw new Error("Test billing requires a fixed loopback return origin.");
  const offers = z.array(offer).max(3).parse(JSON.parse(env.VAETTIR_STRIPE_OFFERS_JSON ?? "[]"));
  for (const key of ["planKey", "priceId", "productId"] as const) if (new Set(offers.map(o => o[key])).size !== offers.length) throw new Error("Billing offers must have distinct tiers, prices and products.");
  const portalConfiguration = z.string().regex(/^bpc_[A-Za-z0-9]+$/).parse(env.VAETTIR_STRIPE_PORTAL_CONFIGURATION);
  return { environment, origin: url.origin, portalConfiguration, offers };
}

function secretFile(path: string | undefined, pattern: RegExp): string {
  if (!path || !isAbsolute(path)) throw new Error("Billing requires an absolute protected secret-file path.");
  const secret = readFileSync(path, "utf8").trim();
  if (!pattern.test(secret)) throw new Error("Invalid test billing secret.");
  return secret;
}

export function getBillingRuntime(): BillingRuntime | null {
  const config = readBillingConfig();
  if (!config) return null;
  // A deployment must use approved vault-mounted files, not plaintext task env.
  const key = secretFile(process.env.VAETTIR_STRIPE_KEY_FILE, /^(?:rk|sk)_test_[A-Za-z0-9]+$/);
  const webhookSecret = secretFile(process.env.VAETTIR_STRIPE_WEBHOOK_SECRET_FILE, /^whsec_[A-Za-z0-9]+$/);
  return { config, webhookSecret, stripe: new Stripe(key, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 1, timeout: 10_000 }) };
}
