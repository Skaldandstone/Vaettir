# Vaettir private hosted Stripe sandbox handoff

Status: source/config candidate only. Disabled by default. No Stripe or AWS resource was created or changed. Live billing, public pricing, external beta admission and automatic tax remain blocked.

## Fixed boundary

- Product: Vaettir only. A Stripe customer or subscription from another Skald and Stone product cannot grant Vaettir entitlements.
- Deployment: AWS development account `734702670689`, `us-east-2`, environment label `aws-development` only. This is not the production account or live billing.
- Provider: one James-approved Vaettir Stripe Sandbox and its exact `acct_...` identity. The app uses only a least-privilege `rk_test_...` key.
- Data: one dedicated synthetic database named `vaettir_sandbox_<name>_test`. Do not point this mode at the beta, development, staging or production organization database.
- Origin: one James-approved private HTTPS origin matching `vaettir-*.skaldandstone.com`. The catalog and task environment must match exactly.
- Catalog: separate Team, Business and Corp Products with one monthly licensed USD Price each at 3900, 5900 and 8900 cents per full seat. These figures are approved for sandbox validation only.
- Portal: one Vaettir-only test configuration. Public login and subscription updates off. Cancellation either off or at period end.
- Tax: `automatic_tax.enabled` remains false. No tax collection or readiness claim until registrations and obligations are reviewed.

## Catalog metadata contract

Copy [the source template](../../config/stripe/vaettir-hosted-test.catalog.example.json) into the protected runtime mount and replace every `REPLACE` value only after James has selected the sandbox and origin. Do not edit the source template with real IDs.

Each Product must have exact metadata:

```text
product=vaettir
environment=<catalog environment>
sandbox=<catalog sandbox>
planKey=team|business|corp
```

The portal configuration must have exact `product`, `environment` and `sandbox` metadata. Price/Product IDs, amount, USD currency, recurring monthly interval, licensed usage, active state and test-mode state are all runtime-verified. The configured current Stripe account ID is verified before any provider mutation.

## Protected mount contract

Suggested container mount: `/run/secrets/vaettir-stripe`. Exact path remains an AWS implementation choice, but all three files must be direct regular files beneath the same absolute mount:

- `catalog.json`: reviewed non-secret catalog, at most 16 KiB.
- `api-key`: restricted test key, at most 512 bytes.
- `webhook-secret`: signing secret for the exact `/api/webhooks/stripe` endpoint, at most 512 bytes.

Symlinks, outside paths, empty/oversized files, hosted `sk_test_...`, all live keys and plaintext Stripe secret variables are rejected. On Linux, files may be `0600` or group-readable `0640`; group write/execute and all other-user access are rejected. Use AWS Secrets Manager or an equivalent protected injection mechanism for the two secrets. Do not store values in ECS task-definition environment variables, source, logs or evidence manifests.

The restricted key needs only current-account read, Product/Price read, Customer read/write, Checkout Session write, Subscription/Invoice read, portal configuration read and portal session write. Confirm actual permissions in the sandbox during the owner-approved smoke test; do not broaden the key preemptively.

## Required task settings

These are names and fixed non-secret values, not authorization to deploy:

```text
NODE_ENV=production
VAETTIR_BILLING_MODE=hosted-test
VAETTIR_BILLING_HOSTED_TEST_GATE=vaettir-private-hosted-sandbox-v1
VAETTIR_DEPLOYMENT_ENVIRONMENT=aws-development
VAETTIR_AWS_ACCOUNT_ID=734702670689
AWS_REGION=us-east-2
VAETTIR_BILLING_APPROVED_ORIGIN=<exact reviewed HTTPS origin>
VAETTIR_BILLING_MOUNT_DIR=<absolute protected mount>
VAETTIR_STRIPE_CATALOG_FILE=<mount>/catalog.json
VAETTIR_STRIPE_KEY_FILE=<mount>/api-key
VAETTIR_STRIPE_WEBHOOK_SECRET_FILE=<mount>/webhook-secret
DATABASE_URL=<protected connection for exact synthetic catalog database>
```

Keep `STRIPE_SECRET_KEY`, `STRIPE_API_KEY` and `STRIPE_WEBHOOK_SECRET` absent. The database URL must specify exactly the public schema, a connection limit from 1 through 10 and `sslmode=require`; the catalog database name must match exactly. The runtime refuses a loopback database in hosted mode.

## Activation sequence and evidence gates

1. James reauthenticates normally and selects the Vaettir Sandbox. Do not reuse another product's sandbox/catalog/customer/portal.
2. James or an approved operator creates/reviews the three test Products/Prices and portal, chooses the private origin, and records only IDs/metadata in the protected catalog.
3. AWS owner provisions the dedicated synthetic database and protected file injection in the development account. No production resources or customer data.
4. Engineering starts one isolated candidate and confirms the provider verifier passes. Wrong-account/product/price/portal/origin/database/key tests must still fail before mutation.
5. Staff enrolls only the disposable Free organization in that synthetic database, with an audit reason. Private-beta organizations remain ineligible.
6. Run hosted test Checkout success/cancel/3DS, portal cancellation, verified webhook replay/reorder/duplicate, payment failure/recovery and ambiguous Checkout reconciliation. Use Stripe test payment methods only.
7. Record sanitized evidence, remove/rotate test access when finished, and keep the public/live gate closed.

Local tests and stubs do not prove the real sandbox, restricted-key permissions, DNS/TLS, webhook delivery, browser UX, AWS identity, restore or rollback. A successful hosted test still does not approve live billing or public launch.
