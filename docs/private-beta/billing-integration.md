# Stripe billing slice: isolated tests only

Owner: Vaettir integration engineering. Commercial activation and account decisions: James.

This implements James's August 31 request for product-specific Stripe code. It does not change the free private beta or approve the proposed figures in PRICING.md. Live payments are disabled in code, not merely left without keys. Production NODE_ENV and non-loopback/non-test databases are rejected. No Stripe objects, payments, customer data, cloud configuration or secrets were created or changed during implementation. The connector returned reauthentication required; public official documentation and local SDK stubs were used without refreshing authorization.

## Implemented surface

- Authenticated GET `/settings/billing`, not a public pricing page. Not deployed or safe for Studio sales links. The browser offers no arbitrary customer, price, return URL or entitlement input; returning from Checkout does not grant access.
- tRPC `billing.status`, `billing.checkout`, `billing.portal`: fresh persisted full-seat OWNER/ADMIN membership, active organization and human identity. API-key service users cannot manage billing. Beta tiers and enrolled beta organizations cannot use paid checkout.
- Staff-token-only `billing.enrollTest`: explicit Free, non-beta organization, recorded actor/reason, immutable environment binding. No provider calls on enrollment. Existing organizations remain unmanaged unless explicitly enrolled.
- POST `/webhooks/stripe` and `/api/webhooks/stripe`: encapsulated exact-byte JSON buffer, 256 KiB limit, Stripe SDK signature/timestamp verification, test direct-account events only. Processing failures return 503 for delivery retry; payloads, signatures and provider errors are not logged.
- Hosted monthly, licensed, per-unit subscription Checkout. Price/product/currency/plan are server allowlisted, product metadata is verified, and purchased quantity accommodates accepted and pending seats. Customer metadata binds Vaettir, environment, organization and billing-account IDs. Stripe cannot unlock another product through this integration.
- Dedicated customer portal configuration. Public login and subscription updates must be disabled, cancellation may only be at period end, and every listed customer subscription must belong to this Vaettir account/environment. Listing overflow fails closed. No generic shared-business portal is used.
- Current subscription and paid latest invoice are retrieved for each event, never trusted from the delivered snapshot. Paid active state, one valid price and bounded quantity grant only the mapped Vaettir tier/full-seat count. Unpaid, trial, invalid, paused or canceled state grants no paid entitlement. Existing members/data are retained. Automatic charging, top-ups, seat expansion and tax are not enabled.
- Organization locks protect checkout reservations, seat changes and entitlement writes. A short database lease serializes provider reads outside transactions. Lease ownership/expiry is rechecked before commit; an expired worker cannot clear a replacement's lease. Receipts and entitlement changes commit together. Event IDs, not timestamps, deduplicate; same-second/out-of-order events fetch canonical current state.
- Persistent Checkout/customer idempotency keys keep retries identical. Pending plan/quantity changes fail closed. An uncertain/expired checkout needs support reconciliation rather than automatically starting a second purchase. An unresolved customer creation older than 23 hours is not retried with a potentially expired provider key. A canceled old subscription cannot erase a newer pending checkout.
- All seat mutation paths, including staff transfer/resend and service-key creation, honor purchased full-seat capacity. Web/mobile seat responses expose effective capacity. Tenant and both staff manual plan writers refuse billing-managed accounts. Hard deletion refuses these accounts to prevent orphaning payment obligations or losing receipts.

## Configuration contract

Defaults in `.env.example` leave billing disabled. Future approved local sandbox testing needs:

| Setting | Required value |
|---|---|
| `VAETTIR_BILLING_MODE` | `test`; `live` is unsupported |
| `DATABASE_URL` | Loopback PostgreSQL `vaettir_<name>_test`, public schema, bounded pool |
| `VAETTIR_STRIPE_ENVIRONMENT` | Unique product test label such as `test-vaettir-sandbox` |
| `VAETTIR_BILLING_RETURN_ORIGIN` | Fixed loopback HTTP(S) origin, no path, credentials or query |
| `VAETTIR_STRIPE_OFFERS_JSON` | Array of distinct `{planKey, priceId, productId, currency}` entries; no amounts supplied by clients |
| `VAETTIR_STRIPE_PORTAL_CONFIGURATION` | Explicit product-specific `bpc_...` configuration |
| `VAETTIR_STRIPE_KEY_FILE` | Absolute protected/vault-mounted test restricted-key file; test secret key supported only where necessary |
| `VAETTIR_STRIPE_WEBHOOK_SECRET_FILE` | Absolute protected/vault-mounted endpoint signing-secret file |

Products must carry `product=vaettir`, the exact `environment`, and `planKey=team|business|corp` metadata. Customers/subscriptions are created with additional organization/account ownership metadata. Portal configuration must carry the same product/environment. Configure only approved test objects. No commercial IDs, amounts, secrets, registrations or destination account are inferred from another product.

Use the official restricted-key permission reference to approve only customer read/write, prices/products read, Checkout Sessions write, subscriptions/invoices read, portal configuration read and portal session write required by this code. Actual permission grants remain unverified. Do not put keys in source, browser/mobile bundles, plaintext task definitions or logs. Cloud coordination is with task 01a0556d-77fe-73b2-96a2-29ac8f01666f; this slice requires no deployment or cloud change. A future hosted test/live deployment needs a separate reviewed activation change because the current runtime deliberately rejects it.

## Evidence and remaining acceptance

Initial focused run: 51 tests passed (configuration plus real PostgreSQL billing/real SDK signature boundary). API methods are stubbed; no paid/external API traffic. All 41 migrations and reference seed applied to fresh `vaettir_stripe_test` on owned loopback PostgreSQL 17. The subsequent [exact-commit combined run](stripe-integration-evidence.md) at 5a851f1 passed 267 tests and full builds, with the two pre-existing high dependency advisories still blocking release.

Tests cover authorization, stale membership, beta/service restrictions, environment/price/customer isolation, seat reservations, idempotent Checkout, privacy-safe errors, portal scope, duplicate and same-second delivery, concurrent leases, stale-worker fencing, receipt rollback/retry, invoice-vs-return authority, and old-cancellation/new-checkout safety. This proves local software behavior, not a real hosted Checkout, portal, webhook endpoint, restricted key, browser or device acceptance.

Owner actions before any provider sandbox smoke test: reauthenticate Stripe through its normal approved flow; select the Vaettir sandbox/account, approved test catalog and portal; provide protected secret references; approve isolated test identities. Commercial prices, currencies, annual plans, seat/read-only billing policy, proration, payment-failure grace, cancellation, refund/support and data-retention policy still need James's decisions. No automatic tax is enabled. Tax registrations, product tax codes and collection obligations are unverified; do not claim tax readiness without those decisions and verification.

After approval, test real hosted success/cancel/3DS/delayed payment, portal cancellation, duplicate/reordered webhooks, payment failure/recovery, expired and ambiguous Checkout reconciliation, wrong-account events, and cross-product portal denial. Review screenshots and human recovery copy. Deploy only after normal release/security gates. There is no live-mode toggle or public paid launch in this change.

## Migration and rollback

Additive migration `20260831080000_stripe_test_billing` adds optional organization capacity and separate billing-account/event tables. Existing organizations retain null capacity and existing behavior. Receipts contain IDs/outcomes, not raw provider payloads. No ledger history is overwritten, and webhook processing does not automatically grant credits or bill overages. Existing monthly credit policy remains unchanged.

Do not drop billing tables, erase receipts, delete provider customers, or return billing-managed organizations to legacy manual plan code as a rollback shortcut. Resolve any provider obligations and preserve evidence first. Restoring an old application that ignores purchased capacity is unsafe once billing-managed test data exists. For the free beta, billing stays disabled; this migration does not by itself enroll or charge anyone.

## Official implementation references

Checked August 31: [stripe-node](https://github.com/stripe/stripe-node) SDK 22.6.0, API `2026-08-26.dahlia`. Follow [Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create), [webhook verification and duplicate/event-order guidance](https://docs.stripe.com/webhooks), [subscription events](https://docs.stripe.com/billing/subscriptions/webhooks), [customer portal ownership](https://docs.stripe.com/customer-management/integrate-customer-portal), and [idempotency retention](https://docs.stripe.com/api/idempotent_requests). Reverify compatibility before upgrading or activating a real environment.
