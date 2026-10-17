# Vaettir domain rollout

`vaettir.app` serves the public marketing package in
`integrations/domain-edge`. Customer applications use an immutable
`<name>.vaettir.app` claim; `app.vaettir.app` is the shared entry address.
An organization display name and its existing slug are independent of this claim.

## Current rollout boundary

The public apex and `www` are deployed. The old Studio `/vaettir` and
`/vaettir/` marketing paths redirect to the new homepage for GET/HEAD only.
Customer hosts, satellite authentication and live domain claims remain disabled.
The checked-in Worker allowlist is empty and contains no ingress secret.

The first live acceptance uses only James's existing Skald and Stone sandbox
and the **Codex Plugin Synthetic Sandbox** project
`cmvbm3j0r0001uqg3xtxwszh4`. Resolve and independently verify that project's
immutable organization ID before setting the rollout scope. Do not claim,
reserve, redirect, reconfigure or test aTwist during this phase. Existing customer
migration follows later, with the exact owner-confirmed organization/name mapping.

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

The company Clerk primary domain remains in service during migration.
Adding the prepared `vaettir.app` satellite currently shows a $10/month charge;
obtain the owner's approval before submitting it. Follow Clerk's actual DNS
instructions and verify TLS and session behavior before enabling customer hosts.
Do not repoint the primary domain or broaden token audiences speculatively.

The main release operator owns the combined API/web image rollout, migrations,
native baseline and recovery gates. Preserve the currently deployed native
application and scopes. This lane owns only the isolated public Cloudflare
package; do not deploy Studio's unrelated dirty source.

## Acceptance before activation

1. Pass exact-source CI, production image/static/security gates, historical
   migration checks and the combined schema/grant/domain restore proof.
2. Confirm the paid satellite decision and verified provider configuration.
   Establish the existing native setup return URL preserves HTTPS and opaque
   state without forwarding it to another customer.
3. Enable selection only for the verified sandbox organization. Use onboarding
   to preview, confirm and retry the exact chosen name; a different-name retry
   must fail. Keep aTwist out of scope.
4. Configure the exact new hosts and signed ingress, then verify fresh sign-in,
   session renewal/sign-out, own project access, foreign-project denial and
   cache isolation through the actual deployed route.
5. Verify the native picker/connect/sharing path under the sandbox hostname
   exposes only that workspace and still requires explicit human approval.
6. Complete the installed Codex preview's synthetic counts read, revoke and
   fresh-client denial with matching retained audit evidence. Local tests or a
   healthy API do not establish this acceptance.

Rollback disables new-host activation and routes while retaining existing
claims, audit history and the old authenticated application. A confirmed name
cannot be reassigned or deleted as a rollback shortcut.
