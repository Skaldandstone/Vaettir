# Enterprise identity implementation

Status: persisted drafts and published rules, mapped directory observations, scoped manual authoring and governed-plan actions, and compact Access/SSO setup UI. Not enabled or deployed. Real SSO enforcement, automatic new-user provisioning and complete custom permission coverage remain incomplete. Local checks are not provider acceptance.

## Product scope

Workspace Settings > Access will have three compact sections:

1. **Sign-in**: SAML/OIDC connection, setup/test status, verified domains and an explicit enforcement review.
2. **Groups & roles**: named local groups, reusable permission sets and workspace or selected-project scope. A role is not a renamed legacy Editor/Admin tier.
3. **Directory**: external groups mapped to roles/projects, last successful reconciliation, pending/failed changes and an effective-access preview.

Default existing workspace behavior remains unchanged. No workspace is enrolled by email domain alone. No provider credentials belong in screenshots, audit metadata, browser storage or repository files.

## Implemented checkpoint

`IdentityAccessDraft` adds a workspace-owned preparation record with revision CAS. The `identityAccess` router rechecks a verified human Clerk subject, current full-seat administrator membership, workspace host and suspension inside its transaction. It validates current tenant members/projects, saves and audits atomically under Serializable isolation. No native membership, seat, provider connection or authorization policy is modified by a draft save.

Workspace Settings > Access provides searchable, collapsible roles/groups, permission checklists, project scope, member selection, recoverable save errors and explicit saved-version reload. Revision conflicts preserve browser edits. This UI deliberately labels drafts and disconnected setup rather than presenting non-operational SSO switches. It must not be released as completed enterprise identity support.

**Draft preview** lets an administrator explicitly select an existing member and project, then inspect proposed local actions with expandable group-to-role sources. It uses the current editor draft, including unsaved changes; selections survive switching back to edit roles/groups. Invalid configuration or unavailable references suppress results and offer review/reload, never fallback permissions. Long selected names are disclosed without changing native keyboard selection. This is a display-only configuration inspection, not effective live access, directory evidence, seat eligibility, entitlement evaluation or SSO verification. The browser helper must never be used for server authorization.

Preview verification: 13 focused unit checks and the actual local component at 1280/390px in dark/light cover scope changes, permission reductions, source attribution, explicit selection, no-match results, saved reopen and unavailable-member recovery. Run `pnpm --filter @vaettir/web exec vitest run lib/identity-draft-preview.test.ts` and `node apps/web/e2e/identity-access/run.mjs --preview-only`. The latter uses synthetic browser persistence only, blocks external network requests and retains screenshots locally; it is not hosted/provider acceptance.

Local verification: 21 router/schema tests use a synthetic transaction double, not a database; core/db/AI package builds and API/Web typechecks pass. The real editor rendered in dark/light at desktop and 390px with synthetic browser persistence passes role/group save/reopen, failure recovery, duplicate-name validation and dialog keyboard/overflow checks. Actual provider calls and hosted acceptance remain unverified. Separate journal SQL evidence is described below; it does not establish router or provider acceptance.

`packages/core/src/identityPolicy.ts` is a dependency-free policy kernel with:

- Tenant-bound custom roles with an explicit permission catalog; no wildcard, ownership, billing or identity-admin escalation.
- Local groups evaluated from current membership on each authorization request.
- Stable directory subject/group IDs, never display-name or email matching.
- Complete-snapshot planning for one subject/connection provenance tuple.
- Compare-and-swap generation contract to reject stale or duplicate replacement plans.
- Removal/deactivation/disabled-connection plans with no implicit Viewer fallback.
- Permission re-evaluation against current roles/mappings, current connection state and expiry.
- A strict current-session SSO evidence predicate; merely linking an enterprise account does not prove this session used it.

The initial policy-only checkpoint did not change runtime authorization. The historical slices below describe its progression; the current scoped-action table is the authoritative coverage list. No provider activation is implied.

Run: `node --experimental-strip-types --test scripts/enterprise-identity-policy.test.mjs`.

### Durable directory observation journal

The additive `IdentityDirectoryConnection`, `IdentityDirectorySubject` and `IdentityDirectoryReceipt` schema stores source provenance. The journal alone does not authorize access; the current explicit-action evaluator can use fresh, enabled, revision-matched observations with published mappings. The migration creates no connections, memberships or grants and has been applied only to owned local test databases, not a hosted environment. Connections and subjects default disabled. Composite foreign keys constrain a subject to its workspace connection and an existing native membership; provider-instance/directory uniqueness prevents reusing a directory across tenants. These restrictive references require an explicit future retention/offboarding path, not silent cascading deletion.

`identityDirectoryStore` is an internal service with no route, scheduler or provider caller. Reservation advances a local generation before an authenticated fetch. Commit rechecks tenant, suspension, native subject, source IDs, binding/configuration revisions, latest generation and a server-reserved deadline in a Serializable transaction. Observations and source-attributed receipts commit together; receipts retain immutable source identifiers and observed group IDs, never credentials or raw provider payloads. Failed/partial reads are not removals. A newer reservation supersedes older in-flight fetches; replay/serialization conflicts require a fresh read, not replaying an old payload. Native memberships, seats and manual groups are untouched.

`readCurrent` returns source evidence only, never a permission decision. Disabled/rebound bindings are rejected; expired observations and revision-mismatched observations are unavailable. Starting another fetch cannot extend old evidence. Every future binding/enablement/mapping change must advance the relevant revision. The lease is configurable on the connection (schema default 300 seconds, bounded to 1–3600); it is not an adopted revocation SLA and adds to provider synchronization delay. Activating enforcement requires an explicit freshness/recovery decision and measured provider behavior.

Focused service tests use a synthetic transaction double; they do not prove PostgreSQL behavior. A separate owned PostgreSQL17 integration fixture applies the full committed historical migration chain using Prisma migrate deploy. Before the two identity migrations it inserts synthetic native users, workspace memberships, seats and suspension state. It then checks these rows remain identical, preserves a revisioned preparation draft across the journal migration, verifies the journal is empty, and checks a repeated deployment has exactly one completed checksum-matched receipt for each migration. The current 102-migration chain passes. Ten database checks then cover receipt constraint-failure rollback, overlapping two-client commits, a paused commit/configuration race, cross-tenant foreign keys, source uniqueness, subject rebinding, expiration, revoke/reactivate ordering and restrictive membership retention. Test barriers fail on timeout rather than silently accepting a sequential fallback. This is not a production-data upgrade rehearsal, production concurrency/load verification, live provider evidence or custom-role activation.

Run: `pnpm --filter @vaettir/api test -- src/services/identityDirectoryStore.test.ts`.

Windows SQL fixture: `node scripts/identity-directory-postgres.mjs` uses the existing PostgreSQL17 binaries to initialize a fresh loopback-only cluster under `.local/identity-postgres-*` on a dynamically selected non-default port. It never consumes an existing `DATABASE_URL`, provider secrets or database service. Schema and migrations are copied into the owned fixture so Prisma cannot discover repository environment files. The runner records source/file and migration hashes, upgrade readbacks and receipts, retains its synthetic data and logs, and stops only its owned cluster. The integration suite refuses any other fixture/URL. No Windows service, external identity or live database is created/modified. Its local bootstrap role uses trust only in this temporary synthetic loopback cluster; it is not a production authentication configuration. Retained fixtures are ignored and require deliberate cleanup review. The optional `--generated-baseline` mode retains the narrower earlier generated-schema check; it must not be reported as historical migration acceptance.

### Published local rules and first runtime action

`IdentityAccessPolicy` holds an explicitly published copy of a saved draft, its source revision and publication revision. The additive migration creates no policies. Publication validates a fresh verified human native FULL administrator, tenant ingress, suspension and current member/project references. Policy revision CAS and its audit commit together at Serializable isolation. Draft edits never change published rules. The HTTP publication endpoint remains unavailable unless the deployment operator enables the exact workspace with `VAETTIR_IDENTITY_LOCAL_RULES_ORGANIZATIONS`; there is no wildcard, browser-controlled enablement, or email/domain inference. **Do not enable this rollout gate for general use: the complete route/provider acceptance is still open.**

`readPublishedLocalAccess` evaluates only the published custom local contribution, not total effective access. It checks the current independently verified Clerk subject, native membership, absence of service identity, tenant/project, suspension and seat. Group/source removal and role/scope reduction take effect on subsequent evaluation; stale deleted member/project references cannot grant access. Independent native access remains independent. An explicit action helper never promotes a custom role to a broad legacy Editor and never overrides entitlement checks.

The first covered business action was `testPlans.create`. A full-seat native Viewer with a published, project-scoped `plans.write` grant can create a manual plan. Authorization and the business write occur together with the existing organization/membership/project locks and a pinned policy row. Native editor behavior is retained. The current table below lists subsequent coverage; this initial slice did not include external provisioning, directory grants, SSO enforcement or new membership creation.

The Access editor has a compact explicit publication review, separate saved/published revisions and a lost-acknowledgement guard: a failure requires reading the durable revision before another deliberate publication. Publication remains hidden when unavailable. Actual local component checks cover both themes at1280/390px, focus/Escape, dirty-draft prevention, failure before commit, lost response after commit, reload/reopen, no automatic republish and permission-reduction publication. These use synthetic transport, not hosted acceptance. Run `node apps/web/e2e/identity-access/run.mjs --publication-only`.

The initial publication verification applied103 historical migrations. It additionally proved real plan creation after publication and denial after publication of group removal, unchanged native Viewer/Full membership, actual audit foreign-key failure rollback, scope/seat/rebound-subject denials and competing publication rejection. The current migration/test count appears below. This closes local SQL/router behavior only; real provider and hosted UI tests remain required. The journal fixture still has no Google connection.

## Current scoped authoring and setup implementation

The current implementation adds these explicit actions without converting a custom role into a legacy Editor:

| Action | Covered operations | Deliberately unchanged |
| --- | --- | --- |
| `plans.write` | Manual creation and governed header/status/criteria/configuration/release attachment operations | AI generation, legacy mutation endpoints, workspace plan-type administration |
| `cases.write` | Manual case creation/content update, explicit case-authoring field projection; changing plan assignment additionally requires `plans.write` | Bulk/import, clone, standalone metadata/history restore, review decisions, AI, field-schema administration |
| `runs.execute` | Reviewed manual start, whole-case and step recording, current execution view, completion | Legacy starts, retests, datasets, CI/import, release workflows, broad case/plan editing |
| `requirements.write` | Manual requirement create/update/delete | Provider/import/link-management and AI paths |
| `architecture.write` | Reviewed manual case/diagram decisions with retained source | AI processing, draft generation and standalone document saving |
| `reports.create` | Private definition save/update and private preview capture | Sharing approval, shared definition management and catalog administration |

Business mutations authorize the exact action with current published policy and directory observations under transaction locks, before replay or writing. Existing tenant ingress, native membership, full-seat requirements, subject identity, source revisions and original review/CAS rules remain. The generic case-field `canEdit` projection remains native-only; only an explicit `cases.write` view used by the manual authoring form can add that action. Custom plan/case controls do not enable unrelated UI actions. Native read access is still the prerequisite, not a completed project-scoped managed-membership model.

Directory mappings are strict, tenant-bound records on the connection. Mapping changes and disablement increment its revision with an atomic audit, immediately making old observations unusable. Fresh reconciliation is required before the directory contribution returns; independent local/native sources remain. The UI provides observed-group selection, published-role and project choices, status, explicit disable confirmation, and reload-before-retry after an unknown outcome. It does not create, enable or reconnect a directory.

`IdentityProviderBinding` is an additive, disabled-by-default operator-owned one-to-one workspace/Clerk organization binding. The read-only preflight checks the independently authenticated native administrator, exact provider organization membership and `org:sys_entconns:manage`, refuses incomplete connection lists, and rechecks local binding/authorization after provider reads. No email/domain/name inference or provider mutation is used. The SSO button uses Clerk's supported OrganizationProfile overlay; it rechecks after active-organization selection and closes on account/organization changes. The provider Security tab, not custom token text fields, owns SAML/OIDC setup. This is a setup bridge, not evidence that the current session used a particular enterprise connection.

Local verification includes 105 historical migrations and 21 real PostgreSQL/router checks in the isolated owned fixture, including source removal/reactivation, scope reduction, mapping revision invalidation, native membership preservation, audit rollback, governed-plan replay denial, case/requirement authoring, free architecture links with AI denial, and private report creation with sharing/replay denial. Component fixtures render directory/setup, scoped manual plans and mapping in dark/light at1280/390px with recovery and revocation checks. The real report wizard and frozen report also pass private save/capture, close/reopen retention, offline exact-request retry, sharing denial and permission reduction in both themes and widths. Its catalog and definition-manager children are explicitly stubbed, not accepted by that fixture. Stable commentary field labels preserve accessible lookup after reopening a populated draft. Custom case-author browser acceptance remains outstanding. These checks do not exercise Google, hosted identity settings or new-user provisioning. Run `node apps/web/e2e/identity-access/run.mjs --directory-only`, `node apps/web/e2e/ui-plan-mapping/run.mjs --identity-plan-only`, `--identity-mapping-only` and `node apps/web/e2e/identity-report/run.mjs` for the distinct local proofs.

The Google fixture remains a **plan for isolated company test users/group**, not authorization to create them, grant delegation, enable domain routing or read a production directory. Clerk's documented Google directory sync reads all users/groups in the Workspace domain and valid credential upload activates synchronization. A group mapping in Vaettir does not constrain that provider read scope. The deployment operator must separately establish an approved exact fixture and consent scope. Sheets OAuth and Search Console ownership are unrelated. Supported source-specific lifecycle/current-session proof and automatic managed-user ingress remain unresolved; do not fabricate these from a linked enterprise account, global active state or omitted groups.

Other catalog actions remain preparation-only or retain native authorization. Keep the exact-workspace publication gate off for general use until coverage and provider acceptance are complete. Do not include these migrations or source changes in an unrelated release by implication.

### Setup and directory UI recovery

SSO inspection is pinned to the selected native workspace and current account/session before awaiting a response. A scope change or unmount rejects delayed callbacks, clears displayed status and closes an already opened provider profile. Only an inspected response from the same component lifecycle can open the existing SDK setup overlay, after the independent fresh server/provider binding recheck. Synchronous duplicate activations are ignored. This is UI request ownership, not proof of an enterprise-authenticated session.

Directory labels distinguish never-synced, zero-member, stale and current observations. Mapping review shows the exact project scope. Unchanged mappings cannot be saved, including reordered mappings/project IDs and removal/recreation of the same rule; this prevents a UI no-op from withdrawing grants until another sync. Real changes retain explicit save, server validation/revision checks and reload-before-retry after an unknown outcome.

Dedicated local component checks: `node apps/web/e2e/identity-sso-recovery/run.mjs` exercises the actual setup wrapper/panel with synthetic Clerk/query boundaries; `node apps/web/e2e/identity-access/run.mjs --directory-only` covers directory save/reopen/recovery. Both cover dark/light at 1280/390px, keyboard recovery/focus and no horizontal overflow. These fixtures neither call an identity provider nor establish authenticated, deployed or customer acceptance.

### Reviewed manual execution coverage

The newest owned SQL fixture applies **106 historical migrations and passes 23 database/router checks**. This supersedes the earlier 105/21 authoring evidence above. A native FULL Viewer with only a published `runs.execute` contribution can start the reviewed whole-case and step workflows, record results, and complete those synthetic runs. Removing its grant rejects new writes and exact receipt recovery; republishing the explicitly restored grant allows completion without changing native role or seat. The SQL whole-case insert guard independently checks current action scope and source freshness; application/SQL parity covers directory disablement, lease expiry, configuration/subject revisions, wrong subject, project scope and seat reduction. The generated-baseline fixture deliberately skips these two trigger-dependent checks and cannot establish run acceptance.

The new run action is available only to verified human transports. Legacy cached-subject callers gain no custom authority. Native ingress, FULL seat, suspension, frozen procedure/context, correction/history and entitlement checks remain. The UI's scoped execution hook retains a separate native-authority flag so retests do not accidentally inherit this grant. Mounted configuration/controller checks include a non-editor executor and permission withdrawal before submission. These are not actual hosted/browser/provider acceptance.

This real SQL exercise also exposed a pre-existing malformed quoted identifier in the reviewed run-start admission query. Its standalone one-line repair is separate from the identity migration and has been handed to the deployment operator for a baseline-native regression; no identity rollout is implied.

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
