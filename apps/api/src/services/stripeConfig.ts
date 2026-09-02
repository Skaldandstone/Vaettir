import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import Stripe from "stripe";
import { z } from "zod";

export const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;
export const BILLING_PRODUCT = "vaettir";
export const HOSTED_TEST_GATE = "vaettir-private-hosted-sandbox-v1";
export const HOSTED_AWS_ACCOUNT = "734702670689";
export const HOSTED_AWS_REGION = "us-east-2";
const approvedAmounts = { team: 3900, business: 5900, corp: 8900 } as const;

const offer = z
  .object({
    planKey: z.enum(["team", "business", "corp"]),
    priceId: z.string().regex(/^price_[A-Za-z0-9]+$/),
    productId: z.string().regex(/^prod_[A-Za-z0-9]+$/),
    currency: z.literal("usd"),
    amountCents: z.number().int().positive(),
  })
  .strict();
export type BillingOffer = z.infer<typeof offer>;

const catalog = z
  .object({
    schemaVersion: z.literal(1),
    product: z.literal(BILLING_PRODUCT),
    deploymentEnvironment: z.literal("aws-development"),
    awsAccountId: z.literal(HOSTED_AWS_ACCOUNT),
    awsRegion: z.literal(HOSTED_AWS_REGION),
    sandbox: z.string().regex(/^vaettir-sandbox-[a-z0-9-]{1,40}$/),
    environment: z.string().regex(/^sandbox-vaettir-[a-z0-9-]{1,36}$/),
    accountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
    databaseName: z.string().regex(/^vaettir_sandbox_[a-z0-9_]{1,40}_test$/),
    returnOrigin: z.string().url(),
    portalConfiguration: z.string().regex(/^bpc_[A-Za-z0-9]+$/),
    offers: z.array(offer).length(3),
  })
  .strict();
type HostedCatalog = z.infer<typeof catalog>;

export interface BillingConfig {
  mode: "test" | "hosted-test";
  environment: string;
  sandbox: string;
  accountId: string;
  origin: string;
  portalConfiguration: string;
  offers: BillingOffer[];
}
export interface BillingRuntime {
  config: BillingConfig;
  stripe: Stripe;
  webhookSecret: string;
  ensureReady: () => Promise<void>;
}

type ProtectedPurpose = "catalog" | "api-key" | "webhook-secret";
export type ProtectedFileReader = (
  path: string | undefined,
  mount: string | undefined,
  purpose: ProtectedPurpose,
) => string;

function validOffers(offers: BillingOffer[], exactCatalog: boolean) {
  if (exactCatalog && offers.length !== 3)
    throw new Error("Hosted billing requires the complete approved catalog.");
  for (const item of offers)
    if (item.amountCents !== approvedAmounts[item.planKey]) {
      throw new Error(
        "Billing amount does not match the approved sandbox catalog.",
      );
    }
  for (const key of ["planKey", "priceId", "productId"] as const) {
    if (new Set(offers.map((item) => item[key])).size !== offers.length)
      throw new Error(
        "Billing offers must have distinct tiers, prices and products.",
      );
  }
  if (exactCatalog && new Set(offers.map((item) => item.planKey)).size !== 3)
    throw new Error("Hosted billing requires Team, Business and Corp offers.");
}

function approvedOrigin(raw: string, hosted: boolean, expected?: string) {
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (hosted
      ? url.protocol !== "https:" ||
        !/^vaettir-[a-z0-9-]+\.skaldandstone\.com$/.test(url.hostname) ||
        !!url.port
      : !["localhost", "127.0.0.1"].includes(url.hostname) ||
        !["http:", "https:"].includes(url.protocol)) ||
    (expected !== undefined && url.origin !== expected)
  )
    throw new Error("Billing requires the exact approved return origin.");
  return url.origin;
}

function assertDatabase(
  raw: string | undefined,
  expectedName: string | RegExp,
  hosted: boolean,
) {
  const db = new URL(raw ?? "invalid:");
  const name = db.pathname.slice(1);
  const allowedQuery = [...db.searchParams].every(
    ([key, value]) =>
      (key === "schema" && value === "public") ||
      (key === "connection_limit" && /^(?:[1-9]|10)$/.test(value)) ||
      (hosted && key === "sslmode" && value === "require"),
  );
  const queryKeys = [...db.searchParams.keys()];
  const uniqueQuery = new Set(queryKeys).size === queryKeys.length;
  const exactHostedQuery =
    !hosted ||
    (db.searchParams.get("schema") === "public" &&
      /^(?:[1-9]|10)$/.test(db.searchParams.get("connection_limit") ?? "") &&
      db.searchParams.get("sslmode") === "require");
  const expected =
    typeof expectedName === "string"
      ? name === expectedName
      : expectedName.test(name);
  if (
    !["postgres:", "postgresql:"].includes(db.protocol) ||
    !expected ||
    !!db.hash ||
    !allowedQuery ||
    !uniqueQuery ||
    !exactHostedQuery ||
    (hosted
      ? ["localhost", "127.0.0.1", "::1"].includes(db.hostname)
      : !["localhost", "127.0.0.1"].includes(db.hostname))
  ) {
    throw new Error("Billing requires its dedicated synthetic test database.");
  }
}

export function readProtectedFile(
  path: string | undefined,
  mount: string | undefined,
  purpose: ProtectedPurpose,
): string {
  if (!path || !mount || !isAbsolute(path) || !isAbsolute(mount))
    throw new Error("Billing requires absolute protected mounted-file paths.");
  const mountPath = realpathSync(mount);
  const filePath = realpathSync(path);
  const rel = relative(mountPath, filePath);
  if (
    !rel ||
    rel.startsWith(".." + sep) ||
    rel === ".." ||
    resolve(mountPath, rel) !== filePath ||
    lstatSync(path).isSymbolicLink() ||
    !statSync(filePath).isFile()
  )
    throw new Error(
      "Billing files must be regular files inside the protected mount.",
    );
  const info = statSync(filePath);
  if (process.platform !== "win32" && (info.mode & 0o037) !== 0)
    throw new Error(
      "Billing mounted files must not be writable by a group or accessible by others.",
    );
  const max = purpose === "catalog" ? 16 * 1024 : 512;
  if (info.size <= 0 || info.size > max)
    throw new Error("Billing mounted file size is invalid.");
  return readFileSync(filePath, "utf8").trim();
}

function localConfig(env: NodeJS.ProcessEnv): BillingConfig {
  if (env.NODE_ENV === "production")
    throw new Error("Local test billing is unavailable in production.");
  assertDatabase(env.DATABASE_URL, /^vaettir_[a-z0-9_]+_test$/, false);
  const environment = z
    .string()
    .regex(/^test-[a-z0-9-]{1,48}$/)
    .parse(env.VAETTIR_STRIPE_ENVIRONMENT);
  const sandbox = z
    .string()
    .regex(/^vaettir-sandbox-[a-z0-9-]{1,40}$/)
    .parse(env.VAETTIR_STRIPE_SANDBOX);
  const accountId = z
    .string()
    .regex(/^acct_[A-Za-z0-9]+$/)
    .parse(env.VAETTIR_STRIPE_ACCOUNT_ID);
  const origin = approvedOrigin(
    env.VAETTIR_BILLING_RETURN_ORIGIN ?? "invalid:",
    false,
  );
  const offers = z
    .array(offer)
    .max(3)
    .parse(JSON.parse(env.VAETTIR_STRIPE_OFFERS_JSON ?? "[]"));
  validOffers(offers, false);
  const portalConfiguration = z
    .string()
    .regex(/^bpc_[A-Za-z0-9]+$/)
    .parse(env.VAETTIR_STRIPE_PORTAL_CONFIGURATION);
  return {
    mode: "test",
    environment,
    sandbox,
    accountId,
    origin,
    portalConfiguration,
    offers,
  };
}

function hostedConfig(
  env: NodeJS.ProcessEnv,
  readFile: ProtectedFileReader,
): BillingConfig {
  if (
    env.VAETTIR_BILLING_HOSTED_TEST_GATE !== HOSTED_TEST_GATE ||
    env.NODE_ENV !== "production" ||
    env.VAETTIR_DEPLOYMENT_ENVIRONMENT !== "aws-development" ||
    env.VAETTIR_AWS_ACCOUNT_ID !== HOSTED_AWS_ACCOUNT ||
    env.AWS_REGION !== HOSTED_AWS_REGION
  )
    throw new Error(
      "Hosted test billing gate or deployment identity is invalid.",
    );
  for (const rawSecret of [
    "STRIPE_SECRET_KEY",
    "STRIPE_API_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]) {
    if (env[rawSecret])
      throw new Error("Hosted test billing accepts mounted secret files only.");
  }
  const parsed: HostedCatalog = catalog.parse(
    JSON.parse(
      readFile(
        env.VAETTIR_STRIPE_CATALOG_FILE,
        env.VAETTIR_BILLING_MOUNT_DIR,
        "catalog",
      ),
    ),
  );
  validOffers(parsed.offers, true);
  assertDatabase(env.DATABASE_URL, parsed.databaseName, true);
  const approved = z.string().min(1).parse(env.VAETTIR_BILLING_APPROVED_ORIGIN);
  const origin = approvedOrigin(parsed.returnOrigin, true, approved);
  return {
    mode: "hosted-test",
    environment: parsed.environment,
    sandbox: parsed.sandbox,
    accountId: parsed.accountId,
    origin,
    portalConfiguration: parsed.portalConfiguration,
    offers: parsed.offers,
  };
}

export function readBillingConfig(
  env: NodeJS.ProcessEnv = process.env,
  readFile: ProtectedFileReader = readProtectedFile,
): BillingConfig | null {
  if (!env.VAETTIR_BILLING_MODE || env.VAETTIR_BILLING_MODE === "disabled")
    return null;
  if (env.VAETTIR_BILLING_MODE === "test") return localConfig(env);
  if (env.VAETTIR_BILLING_MODE === "hosted-test")
    return hostedConfig(env, readFile);
  throw new Error("Live billing mode is unsupported.");
}

export function expectedPrice(
  price: Stripe.Price,
  configured: BillingOffer,
  config: BillingConfig,
) {
  const product = price.product;
  return (
    price.id === configured.priceId &&
    price.active &&
    !price.livemode &&
    price.type === "recurring" &&
    price.recurring?.usage_type === "licensed" &&
    price.recurring.interval === "month" &&
    price.recurring.interval_count === 1 &&
    price.billing_scheme === "per_unit" &&
    !price.transform_quantity &&
    !price.custom_unit_amount &&
    price.unit_amount === configured.amountCents &&
    price.currency === configured.currency &&
    typeof product === "object" &&
    !product.deleted &&
    product.active &&
    !product.livemode &&
    product.id === configured.productId &&
    product.metadata.product === BILLING_PRODUCT &&
    product.metadata.environment === config.environment &&
    product.metadata.sandbox === config.sandbox &&
    product.metadata.planKey === configured.planKey
  );
}

export function expectedPortal(
  portal: Stripe.BillingPortal.Configuration,
  config: BillingConfig,
) {
  return (
    portal.id === config.portalConfiguration &&
    portal.active &&
    !portal.livemode &&
    portal.metadata?.product === BILLING_PRODUCT &&
    portal.metadata.environment === config.environment &&
    portal.metadata.sandbox === config.sandbox &&
    !portal.login_page.enabled &&
    !portal.features.subscription_update.enabled &&
    (!portal.features.subscription_cancel.enabled ||
      portal.features.subscription_cancel.mode === "at_period_end")
  );
}

export async function verifyProvider(runtime: BillingRuntime) {
  const account = await runtime.stripe.accounts.retrieveCurrent();
  if (account.id !== runtime.config.accountId)
    throw new Error(
      "Stripe sandbox account identity does not match the catalog.",
    );
  for (const configured of runtime.config.offers) {
    const price = await runtime.stripe.prices.retrieve(configured.priceId, {
      expand: ["product"],
    });
    if (!expectedPrice(price, configured, runtime.config))
      throw new Error("Stripe product and price catalog verification failed.");
  }
  const portal = await runtime.stripe.billingPortal.configurations.retrieve(
    runtime.config.portalConfiguration,
  );
  if (!expectedPortal(portal, runtime.config))
    throw new Error("Stripe portal catalog verification failed.");
}

export function createBillingRuntime(
  env: NodeJS.ProcessEnv = process.env,
  readFile: ProtectedFileReader = readProtectedFile,
  stripeFactory: (key: string) => Stripe = (key) =>
    new Stripe(key, {
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: 1,
      timeout: 10_000,
    }),
): BillingRuntime | null {
  const config = readBillingConfig(env, readFile);
  if (!config) return null;
  const mount = env.VAETTIR_BILLING_MOUNT_DIR;
  const key = readFile(env.VAETTIR_STRIPE_KEY_FILE, mount, "api-key");
  const allowedKey =
    config.mode === "hosted-test"
      ? /^rk_test_[A-Za-z0-9]+$/
      : /^(?:rk|sk)_test_[A-Za-z0-9]+$/;
  if (!allowedKey.test(key)) throw new Error("Invalid test billing key.");
  const webhookSecret = readFile(
    env.VAETTIR_STRIPE_WEBHOOK_SECRET_FILE,
    mount,
    "webhook-secret",
  );
  if (!/^whsec_[A-Za-z0-9]+$/.test(webhookSecret))
    throw new Error("Invalid test billing webhook secret.");
  const stripe = stripeFactory(key);
  let ready: Promise<void> | null = null;
  const runtime: BillingRuntime = {
    config,
    stripe,
    webhookSecret,
    ensureReady: (): Promise<void> => (ready ??= verifyProvider(runtime)),
  };
  return runtime;
}

let processBillingRuntime: BillingRuntime | null | undefined;

export function getBillingRuntime(): BillingRuntime | null {
  processBillingRuntime ??= createBillingRuntime();
  return processBillingRuntime;
}
