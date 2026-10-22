# Enterprise identity implementation

Status: policy foundation plus persisted preparation workflow and local Access editor. Not enabled or deployed. Active SSO, directory provisioning and custom permission enforcement are still incomplete.

## Product scope

Workspace Settings > Access will have three compact sections:

1. **Sign-in**: SAML/OIDC connection, setup/test status, verified domains and an explicit enforcement review.
2. **Groups & roles**: named local groups, reusable permission sets and workspace or selected-project scope. A role is not a renamed legacy Editor/Admin tier.
3. **Directory**: external groups mapped to roles/projects, last successful reconciliation, pending/failed changes and an effective-access preview.

Default existing workspace behavior remains unchanged. No workspace is enrolled by email domain alone. No provider credentials belong in screenshots, audit metadata, browser storage or repository files.

## Implemented checkpoint

`IdentityAccessDraft` adds a workspace-owned preparation record with revision CAS. The `identityAccess` router rechecks a verified human Clerk subject, current full-seat administrator membership, workspace host and suspension inside its transaction. It validates current tenant members/projects, saves and audits atomically under Serializable isolation. No native membership, seat, provider connection or authorization policy is modified by a draft save.

Workspace Settings > Access provides searchable, collapsible roles/groups, permission checklists, project scope, member selection, recoverable save errors and explicit saved-version reload. Revision conflicts preserve browser edits. This UI deliberately labels drafts and disconnected setup rather than presenting non-operational SSO switches. It must not be released as completed enterprise identity support.

Local verification: 21 router/schema tests use a synthetic transaction double, not a database; core/db/AI package builds and API/Web typechecks pass. The real editor rendered in dark/light at desktop and 390px with synthetic browser persistence passes role/group save/reopen, failure recovery, duplicate-name validation and dialog keyboard/overflow checks. SQL transaction rollback/concurrency, actual provider calls and hosted acceptance remain unverified.

`packages/core/src/identityPolicy.ts` is a dependency-free policy kernel with:

- Tenant-bound custom roles with an explicit permission catalog; no wildcard, ownership, billing or identity-admin escalation.
- Local groups evaluated from current membership on each authorization request.
- Stable directory subject/group IDs, never display-name or email matching.
- Complete-snapshot planning for one subject/connection provenance tuple.
- Compare-and-swap generation contract to reject stale or duplicate replacement plans.
- Removal/deactivation/disabled-connection plans with no implicit Viewer fallback.
- Permission re-evaluation against current roles/mappings, current connection state and expiry.
- A strict current-session SSO evidence predicate; merely linking an enterprise account does not prove this session used it.

This checkpoint is intentionally not exported or consumed by runtime routes. Existing authorization is unchanged.

Run: `node --experimental-strip-types --test scripts/enterprise-identity-policy.test.mjs`.

### Durable directory observation journal

The additive `IdentityDirectoryConnection`, `IdentityDirectorySubject` and `IdentityDirectoryReceipt` schema stores source provenance, not active permissions. The migration creates no connections, memberships or grants and has not been applied to a database. Connections and subjects default disabled. Composite foreign keys constrain a subject to its workspace connection and an existing native membership; provider-instance/directory uniqueness prevents reusing a directory across tenants. These restrictive references require an explicit future retention/offboarding path, not silent cascading deletion.

`identityDirectoryStore` is an internal service with no route, scheduler or provider caller. Reservation advances a local generation before an authenticated fetch. Commit rechecks tenant, suspension, native subject, source IDs, binding/configuration revisions, latest generation and a server-reserved deadline in a Serializable transaction. Observations and source-attributed receipts commit together; receipts retain immutable source identifiers and observed group IDs, never credentials or raw provider payloads. Failed/partial reads are not removals. A newer reservation supersedes older in-flight fetches; replay/serialization conflicts require a fresh read, not replaying an old payload. Native memberships, seats and manual groups are untouched.

`readCurrent` returns source evidence only, never a permission decision. Disabled/rebound bindings are rejected; expired observations and revision-mismatched observations are unavailable. Starting another fetch cannot extend old evidence. Every future binding/enablement/mapping change must advance the relevant revision. The lease is configurable on the connection (schema default 300 seconds, bounded to 1–3600); it is not an adopted revocation SLA and adds to provider synchronization delay. Activating enforcement requires an explicit freshness/recovery decision and measured provider behavior.

Focused service tests use a synthetic transaction double; they do not prove PostgreSQL rollback, constraints or concurrent isolation. Actual database acceptance must cover receipt failure rollback, overlapping commits, cross-tenant foreign keys, revision races and compatibility with existing membership removal. No live/provider acceptance or custom-role activation is implied.

Run: `pnpm --filter @vaettir/api test -- src/services/identityDirectoryStore.test.ts`.

## Remaining implementation, in order

| Stage | Required evidence before acceptance |
| --- | --- |
| Durable identity records | Additive Prisma migration; tenant-bound foreign keys; unique provider subject/connection and mapping keys; role/group/grant revisioning; native transaction tests and rollback compatibility |
| Authenticated directory adapter | Verified provider/signature, payload limits, stable configured organization binding, complete pagination, bounded fetch and authoritative state reconciliation; no browser-supplied directory claims |
| Provisioning worker | Atomic source-specific replacement, generation/config revision CAS, audit and retry receipt; duplicate delivery, failure rollback, concurrent role edits, delete/reactivate and multi-directory tests |
| Existing authorization integration | Preserve workspace ingress, suspension, independently verified Clerk subject and native membership contracts; explicit action checks on each covered router; reject uncovered actions rather than promote custom roles to broad legacy roles |
| SSO setup and enforcement | Verified native-workspace-to-provider-org binding, tested current-session proof and recovery path; enforcement opt-in only after owner review; no global provider setting change |
| Compact settings UI | Human-session owner/admin controls, mapping previews, clear source of access, save/retry/version-conflict states; actual populated dark/light and narrow-screen verification |
| Provider acceptance | Explicitly authorized isolated IdP fixture; real login, provision, group change, deprovision and retry; document measured revocation delay, never claim instantaneous delivery |

## Persistence and revocation contract

- External grants are separate from manually approved memberships. Never overwrite a native Owner or reassign ownership through sync.
- A group removal withdraws that group's grant. A subject deactivation withdraws every grant from that directory subject. Other independently authorized sources remain visible in effective-access review.
- Account-wide deactivation is distinct from removal of a single workspace/directory grant; the adapter must not infer one from the other.
- Mapping or role deletion/scope reduction denies matching permissions immediately on subsequent server authorization. Permission expansion requires reconciliation where the grant scope changes.
- Missing results in an incomplete/paginated/failed fetch are not deletion evidence. Reject the snapshot. Expired grants fail closed under an explicitly configured freshness policy.
- Database locks/CAS, grant replacement, synchronization receipt and append-only audit must commit atomically. A pure replacement plan is not an applied revocation.
- Reserve generation before authoritative read, enforce commit ordering, and compare configuration revision. Retried webhook payloads are signals to reconcile current provider state, not authority to restore old roles.
- Preserve disabled/deleted bindings as tombstones; recycled email addresses must not bind a new external subject to old grants. Review interaction with existing verified-email native-user recovery explicitly.
- Do not make role claims in stale JWTs authoritative. Human sessions and API/service tokens retain distinct provenance. Tenant suspension remains dominant.
- Provisioning must respect existing entitlement/seat decisions without silently starting subscriptions or charging seats. Revocation must not depend on billing availability.

## Provider integration constraints

Clerk is the existing authentication provider. Use its SAML/OIDC and Directory Sync capabilities rather than implement SAML XML/signature processing in Vaettir. Its native organization membership is not the same as Vaettir's native workspace membership.

The installed backend SDK exposes enterprise connection CRUD, but the inspected Session model does not itself expose a verified connection-specific authentication field. Do not fabricate that proof from `user.enterpriseAccounts`, email domain, or `lastActiveOrganizationId`. Confirm a documented provider enforcement/session mechanism before enabling the policy predicate in production.

Directory group mappings and custom attributes are not part of Clerk's documented self-serve directory wizard. The official BAPI 2026-08-20 schema does expose `/directories`, directory detail and `group_role_mappings` routes, even though the installed SDK lacks the corresponding convenience API. Validate the exact response/group membership schemas and tenant-specific visibility before wiring Vaettir's picker; do not call undocumented dashboard endpoints. Provider-native default-role behavior must not silently grant Vaettir access when its last mapping is removed.

The same official schema exposes a session-scoped reverification read endpoint. Its existence is not proof of connection-specific SSO: validate the response schema and actual completed SSO factor before using it for enforcement. Frontend `prepareFirstFactorVerification` accepts an enterprise connection ID but a browser-supplied factor is not trusted server evidence.

Provider lifecycle details require actual acceptance tests: the current directory overview and self-serve documentation describe different membership-retention outcomes on directory removal. Vaettir should explicitly invalidate its own connection-sourced grants on disconnect; do not assume a provider UI action supplies that guarantee.

Sources checked October 21, 2026:

- [Clerk enterprise SSO](https://clerk.com/docs/guides/organizations/add-members/sso)
- [Directory Sync](https://clerk.com/docs/guides/configure/auth-strategies/enterprise-connections/directory-sync)
- [Self-serve Directory Sync](https://clerk.com/docs/guides/configure/auth-strategies/enterprise-connections/self-serve-directory-sync)
- [Official Backend API schema 2026-08-20](https://raw.githubusercontent.com/clerk/openapi-specs/main/bapi/2026-08-20.yml)
- [Session verification methods](https://clerk.com/docs/js-frontend/reference/objects/session)

No provider plan, add-on, credential, organization, grant or connection has been created or changed by this checkpoint. Any configuration or cost approval remains separate from source completion.
