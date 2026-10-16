# Vaettir AI integration preview

Codex is the first host. The portable plugin manifest and MCP server are the
reusable core for later AI integrations. Version 0.1.0 is a local prototype,
not an OpenAI-approved or published plugin.

The owner requested reading and managing Vaettir tests, plans, and runs, with
read access first. Customer confidentiality changes the first release: this
preview supports only explicitly approved **synthetic-project aggregate
counts**. Customer content is unavailable. No production connection is enabled.

## Disclosure contract

Human access and external AI disclosure are separate permissions. Customer IP,
patient information, credentials, business logic, test steps, titles, logs,
attachments, custom fields, and source may all be sensitive. A normal Viewer
credential is insufficient for an external AI connection.

| Project classification | This preview |
| --- | --- |
| Unclassified | Denied |
| Customer proprietary | Denied |
| Regulated | Denied |
| Synthetic | Counts only, with an explicit current grant |

The API boundary requires an enabled, unrevoked, expiring grant for the exact
organization, project, dedicated principal, Codex recipient, and aggregate-only
scope. It checks live principal role, organization state, approving administrator
state, and the project's classification version. Policy or classification drift
invalidates access. Changing the label alone must not recreate approval.

Dedicated `vai_` credentials resolve only through this gateway. Do not mint or
reuse general `vt_` API keys, human sessions, staff tokens, or browser credentials.
The gateway does not accept them. Conversely, do not add `vai_` recognition to
the general API auth path: these credentials must never unlock general tRPC.
The recipient is a grant restriction, not proof of which executable holds a
bearer token. Host/account restrictions need verified connection identity before
any expansion beyond this synthetic preview.

Only three nonnegative integer counts can leave the boundary. No free text,
IDs, names, URLs, per-test rows, errors, or artifacts are returned. Any nonzero
count below ten withholds the entire count object. This is minimization, not a
claim of anonymization or protection against every inference attack. No filters
or arbitrary queries are available. No model calls or Vaettir AI-credit operations
are involved.

Known-grant allow, deny, and suppression decisions require an awaited audit
record. Audit records hold identifiers and fixed decision codes, not content,
tokens, or returned values. Audit failure prevents disclosure. Authentication
failures without a resolvable grant still need bounded, sanitized security-event
logging in the production adapter; they cannot be assigned a fabricated tenant.

## Current implementation and activation gates

- `apps/api/src/services/aiDisclosureGateway.ts`: tested server-side policy
  boundary with a storage interface. Counts are projected explicitly.
- `apps/api/src/services/aiDisclosureRoute.ts`: tested Fastify handler. It is
  deliberately **not registered in `server.ts`** and returns unavailable without
  a store. It does not expose test content or call existing test-list endpoints.
- `server/`: portable MCP adapter with strict response validation, bounded
  bodies, request timeout, no redirects, and generic errors.
- `skills/vaettir-quality/`: Codex workflow that respects withheld data and
  refuses alternate access paths after a policy denial.

There is no durable grant database, grant-management UI, token issuance,
classification editor, OAuth flow, or production store adapter yet. Test stores
are synthetic fixtures only. The interface does not itself prove transactional
locking, tenant isolation in SQL, production audit persistence, or revocation
under concurrency. These are required integration gates, not shipped controls.

Before activation, implement and verify:

1. Durable tenant/project classifications and separate external-AI grants;
   customer administrators approve each exact connection and disclosure scope.
   Revocation, expiration, policy changes, and admin removal must invalidate reads.
2. Dedicated credentials stored hashed, connection lifecycle and rotation,
   current authorization checks, and transaction locks that serialize disclosure
   against grant/classification changes. Counts must be SQL aggregates scoped by
   both organization and project, without loading customer test records.
3. Durable audit decisions, safe auth-failure events, per-principal limits,
   rate-limit/telemetry redaction (including headers and project query parameters),
   and integration tests for cross-tenant requests and concurrent revocation.
4. Register the gateway under `/api/integrations/ai/v1/project-summary` only
   after those controls pass. Verify authenticated behavior with a synthetic
   workspace and a fresh Codex installation. No live credential exists in this
   package and no customer data was read during development.

For later content access, add a customer-approved field disclosure policy and
an explicitly reviewed output projection. Deny unknown fields and unrestricted
free text. Sanitization is defense in depth, not authorization. Review destination
account, retention, contractual/data-processing requirements and customer policy
before enabling regulated or proprietary content. This prototype makes no
HIPAA-compliance or regulatory-approval claim.

Future plan/run writes need separate capabilities and permissions, a reviewable
change preview, explicit authorization, idempotency, and a durable audit. Read
grants cannot enable writes. Each additional AI system needs its own grant;
approval for Codex does not authorize another provider.

## Local build and verification

This is an isolated package outside the production pnpm workspace. Its lockfile
does not change Vaettir's production dependency graph.

```powershell
npm ci --prefix integrations/ai --ignore-scripts --workspaces=false
npm run build --prefix integrations/ai
npm test --prefix integrations/ai
pnpm --filter @vaettir/api exec vitest run src/services/aiDisclosureGateway.test.ts src/services/aiDisclosureRoute.test.ts
```

The built server is a single bundle at `dist/server.mjs`, containing runtime
dependencies and no credentials. `plugin.json`, `mcp.json`, `skills/`, and this
bundle form the local package. Build output and dependencies stay ignored.

When the activation gates are complete, configure `VAETTIR_AI_BASE_URL` as an
HTTPS origin and `VAETTIR_AI_TOKEN` through approved local connection settings.
Never put tokens in manifests, marketplace files, chat, command arguments, or Git.
The base URL is operator configuration, never an AI tool argument.

Until then `node integrations/ai/dist/server.mjs` can initialize MCP and report
that it is unconfigured. It cannot read production data. This repository is not
installed automatically into any user's Codex profile.

## Publication path

OpenAI currently accepts portable packages with root `plugin.json` and
`mcp.json`. Local and repo marketplaces are separate from the public directory.
Directory publication requires review; local MCP public submissions require
approved-partner access. The portal's remote connection flow does not support a
fixed API-key input. A remote authenticated/OAuth integration is the intended
broader distribution route after the disclosure boundary and customer controls
are complete. Do not upload this prototype as a production-ready integration.

Official documentation checked October 16, 2026:

- [Package a plugin](https://developers.openai.com/plugins/build/plugins)
- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Submit and publish](https://developers.openai.com/plugins/deploy/submission)
- [Desktop-only submission eligibility](https://developers.openai.com/plugins/deploy/desktop-only)
- [Security and privacy](https://developers.openai.com/plugins/guides/security-privacy)

Tracking belongs in Vaettir's existing Integrations ticket, SSE-135. The current
Linear connection requires reauthentication, so no status update was claimed.
