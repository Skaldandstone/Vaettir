# Vaettir AI integration preview

Codex is the first host. The portable plugin manifest and MCP server are the
reusable core for later AI integrations. Version 0.1.6 is a local prototype,
not an OpenAI-approved or published plugin.

The owner requested reading and managing Vaettir tests, plans, and runs, with
read access first. Customer confidentiality changes the first release: this
preview supports only explicitly approved **synthetic-project aggregate
counts**. Customer content is unavailable. No production connection is enabled.

For release conditions and the first installed Codex connection/revocation test,
use [RELEASE-REVIEW.md](./RELEASE-REVIEW.md) and [CONNECTION-TEST.md](./CONNECTION-TEST.md).

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
logging uses fixed codes without request contents; unknown credentials are never
assigned a fabricated tenant.

## Current implementation and activation gates

- `apps/api/src/services/aiDisclosureGateway.ts`: server-side policy boundary.
  Counts are projected explicitly; expiry is checked after locks are acquired.
- `apps/api/src/services/aiDisclosureStore.ts`: durable PostgreSQL grant adapter,
  scoped SQL aggregates, live authorization locks, awaited audit, and a persistent
  thirty-read-per-minute grant limit. It never loads test text.
- `apps/api/src/services/aiDisclosureAdmin.ts` and `routers/aiDisclosure.ts`:
  independently verified human admin approval, classification, one-time
  credential issuance, rotation, revocation, and durable idempotency receipts.
- `apps/api/src/services/aiDisclosureRoute.ts`: Fastify handler registered under
  `/api` only when `VAETTIR_AI_DISCLOSURE_ENABLED=1`. The default deployment has
  no gateway route. Request logging is disabled on this route, and authentication
  failures emit only fixed security codes. Sentry redacts gateway/admin request
  contents and breadcrumbs.
- `apps/web/components/AiDisclosureSettings.tsx`: customer controls in **Project
  settings > Integrations > External AI access**, including disclosure preview,
  classification attestation, expiry, masked one-time credentials, rotation,
  revocation and recent decisions. Account/session/permission changes discard the
  credential view. Credential responses bypass React Query's mutation cache.
- `server/`: portable MCP adapter with strict response validation, bounded
  bodies, request timeout, no redirects, and generic errors.
- `skills/vaettir-quality/`: Codex workflow that respects withheld data and
  refuses alternate access paths after a policy denial.

The additive `20261016222000_ai_disclosure_grants` migration creates tenant-bound
policies, dedicated grants, append-only decision history and operation receipts.
No existing project is classified or approved automatically. Only a SHA-256
credential hash is stored. A response lost after issuance recovers its receipt,
never its credential; the customer must deliberately rotate if it was lost.
Approvals expire in one to thirty days, as chosen by the administrator in this
preview. Saving classification revokes old approvals even when the label stays
the same. A label is an administrator attestation, not a content scan.

Database triggers also revoke grants on approver removal/demotion, loss of a full
admin seat, identity remapping, or organization suspension. Restoring access does
not resurrect those credentials. Existing user/project hard-deletion paths are
restricted while disclosure history exists; retention/deletion needs a separate
reviewed workflow. Audit and command records cannot be updated or deleted by
ordinary SQL mutations. No mutation API for history is exposed.

Transactions lock organization, approver identity, membership, project, policy,
and grant. Revocation serializes against an authorized read; subsequent reads
after revocation commits are denied. An earlier authorized response may finish
delivery afterward, and data already delivered cannot be recalled.

Local PostgreSQL, browser-control, and real bundled MCP-over-HTTPS tests exercise
these controls with synthetic data. They do not establish a production rollout,
customer approval, fresh Codex installation, provider identity, or regulatory
acceptance. No customer credential or project was used.

Before a live connection:

1. Integrate and release this source through Vaettir's existing reviewed release
   process, including the additive migration and recovery checks. No release is
   performed by these local tests.
2. Keep the gateway disabled until the source/migration is deployed. Through
   the normal deployment process, set `VAETTIR_AI_DISCLOSURE_ENABLED=1` AND
   `VAETTIR_AI_DISCLOSURE_PROJECTS` to a reviewed JSON array of exact
   `{ "organizationId": "...", "projectId": "..." }` pairs. There is no
   global or wildcard mode: absent, empty, malformed or duplicate scope denies
   every project. A pair only admits that project to the deployment pilot;
   it does not classify it or approve a customer grant. Out-of-pilot known
   grants are denied and audited before any aggregate count is queried.
3. A current customer admin must review a clearly synthetic project, save its
   classification, approve the precise Codex aggregate scope and expiry, and save
   the one-time credential in local connection settings.
4. Verify a fresh Codex installation and real authenticated read, then revoke
   the grant and confirm the installed client is denied. No live credential
   exists in this package; the production gateway was not enabled by this work.

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
npm run test:approval-ui --prefix integrations/ai
pnpm --filter @vaettir/api exec vitest run src/services/aiDisclosureGateway.test.ts src/services/aiDisclosureRoute.test.ts
```

Database suites additionally require a disposable loopback PostgreSQL database
whose name contains `test`, with migrations applied and reference data seeded.
`src/ai-disclosure-grants.integration.test.ts` covers durable approval and
concurrent revocation. To run the actual bundled MCP/HTTPS/database test, set
`VAETTIR_AI_MCP_TEST=1` and run `src/ai-disclosure-mcp.integration.test.ts`; the
standalone npm dependencies, built bundle, and OpenSSL must be present. Its
generated one-day certificate is trusted only by that test's MCP child process.
The browser-control suite uses actual ReactDOM/Chromium with synthetic auth and
RPC boundaries and no external network requests.

The built server is a single bundle at `dist/server.mjs`, containing runtime
dependencies and no credentials. The Codex package uses
`.codex-plugin/plugin.json` and `.mcp.json`, with `skills/` and this bundle.
`prepare-preview.mjs` maps the reviewed `codex-plugin.json` and `codex-mcp.json`
adapters to those fixed paths. Build output and dependencies stay ignored.

When the activation gates are complete, configure `VAETTIR_AI_BASE_URL` as an
HTTPS origin and `VAETTIR_AI_TOKEN` through approved local connection settings.
Never put tokens in manifests, marketplace files, chat, command arguments, or Git.
The base URL is operator configuration, never an AI tool argument.

Until then `node integrations/ai/dist/server.mjs` can initialize MCP and report
that it is unconfigured. It cannot read production data. This repository is not
installed automatically into any user's Codex profile.

## Host adapters

The portable `mcp.json` follows the Agent Plugins schema. That schema has no
`env_vars` field or generic secret interpolation, so this file alone does not
establish secure credential delivery on another host. An unconfigured server
denies reads. Each future host needs an explicit reviewed credential adapter.

The Codex native adapter forwards only the two dedicated connection variables.
It uses `cwd: "."`, resolved by Codex against the installed plugin root, and a
relative server path. Portable `${PLUGIN_ROOT}` placeholders are not used in
Codex native MCP arguments. The Codex preview deliberately omits root portable
metadata so that it cannot override the native adapter. No credentials are
embedded, saved to Codex configuration, or inherited by an existing desktop app.

Official implementation: [Codex plugin MCP normalization](https://github.com/openai/codex/blob/main/codex-rs/codex-mcp/src/plugin_config.rs).
Packaging: [OpenAI plugin packages](https://developers.openai.com/plugins/build/plugins).

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
