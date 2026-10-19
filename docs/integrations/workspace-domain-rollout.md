# Vaettir domain rollout

`vaettir.app` serves the public marketing package in
`integrations/domain-edge`. Customer applications use an immutable
`<name>.vaettir.app` claim; `app.vaettir.app` is the shared entry address.
An organization display name and its existing slug are independent of this claim.

## Current rollout boundary

The public apex and `www` are deployed. The old Studio `/vaettir` and
`/vaettir/` marketing paths redirect to the new homepage for GET/HEAD only.
The shared entry is deployed with signed ingress. A read-only October 19
inventory verified the existing Skald and Stone owner's `skaldandstone` claim;
`atwist` remains unclaimed. Customer routes and legacy redirects remain off
pending authenticated acceptance. The checked-in Worker allowlist is empty
and contains no ingress secret; the reviewed live entry configuration is local.

The first live acceptance uses only James's existing Skald and Stone sandbox
and the **Codex Plugin Synthetic Sandbox** project
`cmvbm3j0r0001uqg3xtxwszh4`. Resolve and independently verify that project's
immutable organization ID before setting the rollout scope. Complete sandbox
acceptance before activating existing customers. On October 19 the owner
authorized migration of all existing customer accounts and their database
records, preserving their immutable IDs, content, memberships, billing,
integrations and AI disclosure settings, and confirmed these permanent names:

| Existing customer | Confirmed address |
| --- | --- |
| Skald and Stone | `https://skaldandstone.vaettir.app` |
| aTwist | `https://atwist.vaettir.app` |

These approved names are not proof of database claims or activated routes. First
inventory every existing organization and bind each approved name to its exact
immutable organization ID. Report any additional customers before choosing their
permanent names. Do not infer names from slugs or create replacement accounts.

## Controls

- Migration `20261017003000_workspace_domain_claim` creates no customer claims.
  Database uniqueness and immutable triggers prevent rename, transfer and reuse.
  Organization erasure leaves a minimal name tombstone.
- The full-seat owner checks availability and explicitly confirms the permanent
  address during onboarding. Identity changes clear the browser draft. The API
  rechecks the current human identity, role and suspension state under locks;
  same-name retries return the existing claim.
- Cloudflare strips caller-supplied forwarding and staff headers, signs the
  external hostname/method/target and probes the API for its verification marker.
  Unknown, retired, disabled or unverifiable customer hosts fail closed.
- The API resolves the signed hostname to the immutable organization ID. Current
  membership and project permissions still apply. Native project options also
  constrain fresh database membership reads to that organization. Customer REST
  surfaces without explicit tenant-aware support are denied.
- Private responses use `no-store`. Existing native setup callbacks remain on
  their configured trusted origin. Legacy project links resolve through current
  project permission; a shared `/projects` entry redirects only for one current
  workspace. Only benign navigation query values survive a tenant redirect.

## Deployment configuration

| Layer | Setting | Initial synthetic phase |
| --- | --- | --- |
| API | `VAETTIR_WORKSPACE_DOMAINS_ENABLED` | `1` only after the combined release gates pass |
| API | `VAETTIR_WORKSPACE_DOMAIN_ORGANIZATION_IDS` | Exact verified sandbox organization ID; keep nonempty |
| API | `VAETTIR_ACTIVE_WORKSPACE_NAMES` | Empty until that claim and host pass acceptance; then exact sandbox name |
| API and Next middleware | `VAETTIR_DOMAIN_INGRESS_SECRET` | Same newly generated secret, at least 64 characters; secret storage only |
| Web build | `NEXT_PUBLIC_VAETTIR_WORKSPACE_AUTH_ENABLED` | `1` only after the Clerk satellite is configured |
| Web build | `NEXT_PUBLIC_VAETTIR_ACTIVE_WORKSPACE_NAMES` | Exact sandbox name; required on the primary sign-in origin too |
| Worker secret | `VAETTIR_DOMAIN_INGRESS_SECRET` | Same secret, supplied through Wrangler secret storage |
| Worker variable | `ENABLED_WORKSPACE_HOSTS` | Explicit `app.vaettir.app` and sandbox hostname only after verification |
| Worker variable | `VAETTIR_APP_ORIGIN` | Existing trusted CloudFront HTTPS origin |

An explicit `*` activation exists for a future coordinated general rollout in
the API/Worker. Do not use it for the synthetic phase. The browser redirect
allowlist requires exact names. DNS alone never grants organization access.

The two `NEXT_PUBLIC_VAETTIR_*` settings are baked into the web image.
`Dockerfile.web` and `buildspec.web.yml` forward them explicitly, defaulting to
`0` and empty. A release operator using a buildspec override must forward the
same arguments and bind their exact values to its release intent. ECS runtime
variables cannot enable an image that was built with these settings disabled.

The company Clerk primary domain remains in service during migration.
The owner approved the quoted $10/month `vaettir.app` satellite on October 19.
The live production instance already contained the satellite when refreshed;
reuse it instead of creating a duplicate. Its actual DNS requirement is a
DNS-only `clerk.vaettir.app` CNAME to `frontend-api.clerk.services`. Verify the
provider's DNS, TLS and session behavior before enabling customer hosts.
Do not repoint the primary domain or broaden token audiences speculatively.

Clerk's satellite handshake runs before the middleware auth callback. Restore
the HTTPS forwarded context only after verifying the edge signature on a
bodyless workspace request. Do not rely on the primary sign-in return helper
to repair this earlier handshake. The edge permits document GET redirects only
to `https://clerk.vaettir.app/v1/client/handshake`, with exactly one absolute
HTTPS return URL for the same workspace and path. Other provider paths, tenant
returns, writes and API requests remain denied. Preserve the handshake cookie
directives and `no-store` responses. A runtime diagnostic may record origins,
paths and parameter names, never cookies, tokens or full authentication URLs.

A single coordinated release operator owns the API/web image rollout,
migrations, native baseline and recovery gates. Transfer that ownership
explicitly before another chat operates AWS. Preserve the currently deployed
native application and scopes. Deploy the Cloudflare package from its isolated
reviewed source; do not deploy Studio's unrelated dirty source.

## Acceptance before activation

1. Pass exact-source CI, production image/static/security gates, historical
   migration checks and the combined schema/grant/domain restore proof.
2. Confirm the paid satellite decision and verified provider configuration.
   Establish the existing native setup return URL preserves HTTPS and opaque
   state without forwarding it to another customer.
3. Enable selection only for the verified sandbox organization. Use onboarding
   to preview, confirm and retry the exact chosen name; a different-name retry
   must fail. Activate aTwist only after this sandbox acceptance succeeds.
4. Configure the exact new hosts and signed ingress, then verify fresh sign-in,
   session renewal/sign-out, own project access, foreign-project denial and
   cache isolation through the actual deployed route.
5. Verify the native picker/connect/sharing path under the sandbox hostname
   exposes only that workspace and still requires explicit human approval.
6. Before activating the installed Codex preview, complete its synthetic counts
   read, revoke and fresh-client denial with matching retained audit evidence.
   Customer portal address acceptance does not activate AI disclosure grants.
   Local tests or a healthy API do not establish installed-plugin acceptance.

## Existing customer cutover

After sandbox acceptance, reconcile the live inventory against the two approved
names above. The current application schema stores organizations in shared
PostgreSQL tables, keyed by `organizationId`; a hostname change does not require
copying a customer into a new database. Verify the actual deployed database
topology before acting. Preserve the existing database and apply only reviewed
schema migrations and authorized name bindings.

Retain a recoverable backup and the release operator's before/after evidence for
all customer records, membership roles, projects, imports, billing references,
integration bindings and AI policies/grants. Separate expected migration and
domain-claim additions from any unexpected changes. Confirm exact names through
the normal current-owner claim path; do not invent a human actor or bypass its
authority checks for a bulk update.

Enable each accepted hostname explicitly in the Worker, API activation list and
web build allowlist. Keep the legacy authenticated application available while
checking fresh sign-in, session renewal/sign-out, existing project links, native
callbacks and foreign-workspace denial for each migrated account. An old project
link must resolve to that project's existing organization and its confirmed
address after checking current access. Report each customer's actual cutover
result separately from source, CI and DNS configuration.

Rollback disables new-host activation and routes while retaining existing
claims, audit history and the old authenticated application. A confirmed name
cannot be reassigned or deleted as a rollback shortcut.
