import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Stripe from "stripe";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  HOSTED_AWS_ACCOUNT,
  HOSTED_AWS_REGION,
  HOSTED_TEST_GATE,
  createBillingRuntime,
  readBillingConfig,
  readProtectedFile,
  verifyProvider,
  type BillingRuntime,
  type ProtectedFileReader,
} from "./stripeConfig.js";

const team = {
  planKey: "team",
  priceId: "price_team",
  productId: "prod_team",
  currency: "usd",
  amountCents: 3900,
} as const;
const business = {
  planKey: "business",
  priceId: "price_business",
  productId: "prod_business",
  currency: "usd",
  amountCents: 5900,
} as const;
const corp = {
  planKey: "corp",
  priceId: "price_corp",
  productId: "prod_corp",
  currency: "usd",
  amountCents: 8900,
} as const;
const restrictedTestKey = ["rk", "test", "fixtureOnly"].join("_");
const webhookFixture = ["whsec", "fixtureOnly"].join("_");
const forbiddenLiveKey = ["rk", "live", "forbidden"].join("_");
const hostedCatalog = () => ({
  schemaVersion: 1,
  product: "vaettir",
  deploymentEnvironment: "aws-development",
  awsAccountId: HOSTED_AWS_ACCOUNT,
  awsRegion: HOSTED_AWS_REGION,
  sandbox: "vaettir-sandbox-private-validation",
  environment: "sandbox-vaettir-private-validation",
  accountId: "acct_vaettirSandbox",
  databaseName: "vaettir_sandbox_private_validation_test",
  returnOrigin: "https://vaettir-sandbox.skaldandstone.com",
  portalConfiguration: "bpc_vaettirSandbox",
  offers: [team, business, corp],
});
const local = () => ({
  NODE_ENV: "test",
  VAETTIR_BILLING_MODE: "test",
  DATABASE_URL:
    "postgresql://tester@127.0.0.1:55439/vaettir_billing_test?connection_limit=5",
  VAETTIR_STRIPE_ENVIRONMENT: "test-isolated",
  VAETTIR_STRIPE_SANDBOX: "vaettir-sandbox-fixture",
  VAETTIR_STRIPE_ACCOUNT_ID: "acct_fixture",
  VAETTIR_BILLING_RETURN_ORIGIN: "http://localhost:3000",
  VAETTIR_STRIPE_PORTAL_CONFIGURATION: "bpc_example",
  VAETTIR_STRIPE_OFFERS_JSON: JSON.stringify([team]),
});
const hosted = () => ({
  NODE_ENV: "production",
  VAETTIR_BILLING_MODE: "hosted-test",
  VAETTIR_BILLING_HOSTED_TEST_GATE: HOSTED_TEST_GATE,
  VAETTIR_DEPLOYMENT_ENVIRONMENT: "aws-development",
  VAETTIR_AWS_ACCOUNT_ID: HOSTED_AWS_ACCOUNT,
  AWS_REGION: HOSTED_AWS_REGION,
  DATABASE_URL:
    "postgresql://synthetic@billing-test.internal/vaettir_sandbox_private_validation_test?schema=public&connection_limit=5&sslmode=require",
  VAETTIR_BILLING_APPROVED_ORIGIN: "https://vaettir-sandbox.skaldandstone.com",
  VAETTIR_BILLING_MOUNT_DIR: "C:\\mounted",
  VAETTIR_STRIPE_CATALOG_FILE: "C:\\mounted\\catalog.json",
  VAETTIR_STRIPE_KEY_FILE: "C:\\mounted\\stripe-key",
  VAETTIR_STRIPE_WEBHOOK_SECRET_FILE: "C:\\mounted\\webhook-secret",
});
const catalogReader =
  (value = hostedCatalog()): ProtectedFileReader =>
  (_path, _mount, purpose) => {
    if (purpose === "catalog") return JSON.stringify(value);
    if (purpose === "api-key") return restrictedTestKey;
    return webhookFixture;
  };

describe("disabled and local billing configuration", () => {
  it("does not require or read secrets while disabled", () => {
    const reader = vi.fn<ProtectedFileReader>();
    expect(readBillingConfig({}, reader)).toBeNull();
    expect(
      readBillingConfig(
        { VAETTIR_BILLING_MODE: "disabled", DATABASE_URL: "invalid" },
        reader,
      ),
    ).toBeNull();
    expect(reader).not.toHaveBeenCalled();
  });
  it("pins the approved Team amount and sandbox/account scope", () => {
    expect(readBillingConfig(local())?.offers[0]).toEqual(team);
  });
  it.each([
    { VAETTIR_BILLING_MODE: "live" },
    { NODE_ENV: "production" },
    { DATABASE_URL: "postgresql://tester@remote/vaettir_billing_test" },
    { DATABASE_URL: "postgresql://tester@localhost/vaettir" },
    { VAETTIR_STRIPE_ENVIRONMENT: "live-main" },
    { VAETTIR_BILLING_RETURN_ORIGIN: "https://evil.example" },
    { VAETTIR_STRIPE_ACCOUNT_ID: "" },
    { VAETTIR_STRIPE_SANDBOX: "other-product" },
    {
      VAETTIR_STRIPE_OFFERS_JSON: JSON.stringify([{ ...team, amountCents: 1 }]),
    },
    {
      VAETTIR_STRIPE_OFFERS_JSON: JSON.stringify([
        { ...team, currency: "eur" },
      ]),
    },
  ])("fails closed for unsafe local config %j", (override) => {
    expect(() => readBillingConfig({ ...local(), ...override })).toThrow();
  });
});

describe("private hosted sandbox gate", () => {
  it("accepts only the exact protected catalog and deployment identity", () => {
    const result = readBillingConfig(hosted(), catalogReader());
    expect(result).toMatchObject({
      mode: "hosted-test",
      accountId: "acct_vaettirSandbox",
      environment: "sandbox-vaettir-private-validation",
      sandbox: "vaettir-sandbox-private-validation",
      origin: "https://vaettir-sandbox.skaldandstone.com",
    });
    expect(result?.offers).toEqual([team, business, corp]);
  });
  it.each([
    ["missing gate", { VAETTIR_BILLING_HOSTED_TEST_GATE: undefined }],
    ["wrong gate", { VAETTIR_BILLING_HOSTED_TEST_GATE: "yes" }],
    ["wrong node environment", { NODE_ENV: "development" }],
    [
      "wrong deployment environment",
      { VAETTIR_DEPLOYMENT_ENVIRONMENT: "production" },
    ],
    ["wrong AWS account", { VAETTIR_AWS_ACCOUNT_ID: "000000000000" }],
    ["wrong AWS region", { AWS_REGION: "us-west-1" }],
    ["missing approved origin", { VAETTIR_BILLING_APPROVED_ORIGIN: undefined }],
    [
      "wrong synthetic database",
      {
        DATABASE_URL:
          "postgresql://synthetic@billing-test.internal/vaettir_production",
      },
    ],
    [
      "loopback database",
      {
        DATABASE_URL:
          "postgresql://synthetic@127.0.0.1/vaettir_sandbox_private_validation_test",
      },
    ],
    [
      "missing database pool bound",
      {
        DATABASE_URL:
          "postgresql://synthetic@billing-test.internal/vaettir_sandbox_private_validation_test?schema=public&sslmode=require",
      },
    ],
    [
      "missing database TLS requirement",
      {
        DATABASE_URL:
          "postgresql://synthetic@billing-test.internal/vaettir_sandbox_private_validation_test?schema=public&connection_limit=5",
      },
    ],
    [
      "wrong database schema",
      {
        DATABASE_URL:
          "postgresql://synthetic@billing-test.internal/vaettir_sandbox_private_validation_test?schema=tenant&connection_limit=5&sslmode=require",
      },
    ],
    [
      "origin mismatch",
      {
        VAETTIR_BILLING_APPROVED_ORIGIN:
          "https://vaettir-other.skaldandstone.com",
      },
    ],
    ["plaintext API key", { STRIPE_SECRET_KEY: "do-not-read" }],
    ["plaintext signing secret", { STRIPE_WEBHOOK_SECRET: "do-not-read" }],
  ])("rejects %s", (_name, override) => {
    expect(() =>
      readBillingConfig({ ...hosted(), ...override }, catalogReader()),
    ).toThrow();
  });
  it.each([
    ["wrong product", { product: "studio" }],
    ["wrong account", { accountId: "account-other" }],
    ["wrong origin", { returnOrigin: "https://evil.example" }],
    ["wrong database", { databaseName: "vaettir_production" }],
    ["wrong environment", { environment: "live-vaettir" }],
    ["wrong price", { offers: [team, business, { ...corp, amountCents: 1 }] }],
    ["missing plan", { offers: [team, business] }],
  ])("rejects catalog with %s", (_name, override) => {
    expect(() =>
      readBillingConfig(
        hosted(),
        catalogReader({ ...hostedCatalog(), ...override } as never),
      ),
    ).toThrow();
  });
  it("requires mounted test-only secrets and never constructs Stripe on failure", () => {
    const factory = vi.fn();
    const missing: ProtectedFileReader = (_path, _mount, purpose) =>
      purpose === "catalog" ? JSON.stringify(hostedCatalog()) : "";
    expect(() => createBillingRuntime(hosted(), missing, factory)).toThrow();
    expect(factory).not.toHaveBeenCalled();
    const live: ProtectedFileReader = (_path, _mount, purpose) =>
      purpose === "catalog"
        ? JSON.stringify(hostedCatalog())
        : purpose === "api-key"
          ? forbiddenLiveKey
          : webhookFixture;
    expect(() => createBillingRuntime(hosted(), live, factory)).toThrow();
    expect(factory).not.toHaveBeenCalled();
  });
});

describe("provider identity and catalog verification", () => {
  function runtime(): BillingRuntime {
    const config = readBillingConfig(hosted(), catalogReader())!;
    const prices = new Map(
      config.offers.map((item) => [
        item.priceId,
        {
          id: item.priceId,
          active: true,
          livemode: false,
          type: "recurring",
          recurring: {
            usage_type: "licensed",
            interval: "month",
            interval_count: 1,
          },
          billing_scheme: "per_unit",
          transform_quantity: null,
          custom_unit_amount: null,
          unit_amount: item.amountCents,
          currency: "usd",
          product: {
            id: item.productId,
            active: true,
            livemode: false,
            metadata: {
              product: "vaettir",
              environment: config.environment,
              sandbox: config.sandbox,
              planKey: item.planKey,
            },
          },
        } as Stripe.Price,
      ]),
    );
    const stripe = {
      accounts: {
        retrieveCurrent: vi.fn(async () => ({ id: config.accountId })),
      },
      prices: { retrieve: vi.fn(async (id: string) => prices.get(id)) },
      billingPortal: {
        configurations: {
          retrieve: vi.fn(async () => ({
            id: config.portalConfiguration,
            active: true,
            livemode: false,
            metadata: {
              product: "vaettir",
              environment: config.environment,
              sandbox: config.sandbox,
            },
            login_page: { enabled: false },
            features: {
              subscription_update: { enabled: false },
              subscription_cancel: { enabled: true, mode: "at_period_end" },
            },
          })),
        },
      },
    } as unknown as Stripe;
    return {
      config,
      stripe,
      webhookSecret: webhookFixture,
      ensureReady: async () => {},
    };
  }
  it("verifies the exact account, three products/prices and dedicated portal", async () => {
    const value = runtime();
    await expect(verifyProvider(value)).resolves.toBeUndefined();
    expect(value.stripe.prices.retrieve).toHaveBeenCalledTimes(3);
  });
  it("rejects a wrong provider account before trusting the catalog", async () => {
    const value = runtime();
    vi.mocked(value.stripe.accounts.retrieveCurrent).mockResolvedValueOnce({
      id: "acct_other",
    } as never);
    await expect(verifyProvider(value)).rejects.toThrow(/account identity/);
    expect(value.stripe.prices.retrieve).not.toHaveBeenCalled();
  });
  it("rejects foreign product metadata, live prices and wrong portal metadata", async () => {
    for (const variant of ["product", "live", "portal"] as const) {
      const value = runtime();
      if (variant === "product" || variant === "live") {
        vi.mocked(value.stripe.prices.retrieve).mockImplementationOnce(
          async () => {
            const item = value.config.offers[0]!;
            return {
              id: item.priceId,
              active: true,
              livemode: variant === "live",
              type: "recurring",
              recurring: {
                usage_type: "licensed",
                interval: "month",
                interval_count: 1,
              },
              billing_scheme: "per_unit",
              transform_quantity: null,
              custom_unit_amount: null,
              unit_amount: item.amountCents,
              currency: "usd",
              product: {
                id: item.productId,
                active: true,
                livemode: false,
                metadata: {
                  product: "studio",
                  environment: value.config.environment,
                  sandbox: value.config.sandbox,
                  planKey: item.planKey,
                },
              },
            } as never;
          },
        );
      } else {
        vi.mocked(
          value.stripe.billingPortal.configurations.retrieve,
        ).mockResolvedValueOnce({
          id: value.config.portalConfiguration,
          active: true,
          livemode: false,
          metadata: {
            product: "studio",
            environment: value.config.environment,
            sandbox: value.config.sandbox,
          },
          login_page: { enabled: false },
          features: {
            subscription_update: { enabled: false },
            subscription_cancel: { enabled: false },
          },
        } as never);
      }
      await expect(verifyProvider(value)).rejects.toThrow(
        /verification failed/,
      );
    }
  });
});

describe("protected mounted files", () => {
  const root = mkdtempSync(join(tmpdir(), "vaettir-stripe-config-"));
  const mount = join(root, "mount");
  const outside = join(root, "outside");
  mkdirSync(mount);
  writeFileSync(outside, restrictedTestKey, { mode: 0o600 });
  const key = join(mount, "key");
  writeFileSync(key, restrictedTestKey, { mode: 0o600 });
  afterAll(() => {
    if (root.startsWith(join(tmpdir(), "vaettir-stripe-config-")))
      rmSync(root, { recursive: true });
  });
  it("reads a bounded regular file only from the declared mount", () => {
    expect(readProtectedFile(key, mount, "api-key")).toBe(restrictedTestKey);
    expect(() => readProtectedFile(outside, mount, "api-key")).toThrow(
      /inside/,
    );
    expect(() => readProtectedFile("relative", mount, "api-key")).toThrow(
      /absolute/,
    );
  });
  it("rejects symlink indirection", () => {
    const link = join(mount, "link");
    try {
      symlinkSync(key, link, "file");
    } catch {
      return;
    }
    expect(() => readProtectedFile(link, mount, "api-key")).toThrow();
  });
  it.runIf(process.platform !== "win32")(
    "rejects group-writable and world-readable files",
    () => {
      chmodSync(key, 0o644);
      expect(() => readProtectedFile(key, mount, "api-key")).toThrow(
        /accessible/,
      );
      chmodSync(key, 0o600);
    },
  );
});
