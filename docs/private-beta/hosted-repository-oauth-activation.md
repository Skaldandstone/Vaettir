# Hosted repository authorization activation

The customer flow is provider selection, Connect, provider-owned sign-in/consent,
repository selection, then reviewed registration. A provider may reuse its own
signed-in browser session. Vaettir cannot silently check another site's login or
skip consent. Ordinary customers do not register applications or enter app keys.

## Source implementation versus activation

GitLab.com and GitHub.com have server-only hosted application support. Complete
configuration and encrypted storage expose a secret-free connection descriptor.
The first explicitly approved authorization saves a tenant-local encrypted app
snapshot; existing instance applications and grants are not silently replaced.
Presence of environment variables is not provider acceptance or deployment proof.

The 2026-10-02 read-only API33 task-metadata inspection has `WEB_APP_URL` set to
`https://vaettir.skaldandstone.com` and the existing
`PRODUCTION_SIGNAL_ENCRYPTION_KEY` secret reference. It has no hosted
`GITLAB_OAUTH_CLIENT_ID`, `GITLAB_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_CLIENT_ID` or
`GITHUB_OAUTH_CLIENT_SECRET` bindings. Both services reported one running task and
a completed deployment. This verifies metadata wiring, not provider application
existence or live authorization. Do not create or replace an encryption key unnecessarily;
replacing it without a reviewed rotation would strand existing credentials.

## One-time owner/platform setup

1. Recover the existing AWS `vaettir-toolkit` session using the supported login
   flow, with owner confirmation. Read current API task metadata and secret
   **metadata only**. Do not retrieve or log secret values. Inspect existing
   provider applications before creating duplicates; no application existence
   has been established by source tests or old task receipts.
2. Register or verify a confidential GitLab OAuth app owned by the platform at
   GitLab.com Settings > Applications. Set the exact redirect
   `https://vaettir.skaldandstone.com/connections/gitlab/callback`, with
   `read_api`. It covers more than repository metadata; the customer flow must
   continue disclosing that scope. See [GitLab application setup](https://docs.gitlab.com/integration/oauth_provider/)
   and [OAuth/PKCE flow](https://docs.gitlab.com/api/oauth2/).
3. Register or verify a GitHub **OAuth App**, not the separate PR-scanning GitHub
   App, under the authorized platform organization/account. Set homepage
   `https://vaettir.skaldandstone.com` and exact callback
   `https://vaettir.skaldandstone.com/connections/github/callback`.
   The current adapter requests `repo`, a broad read/write scope with organization
   resource implications. Do not describe it as repository-selected read-only
   access. See [OAuth App registration](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
   and [scope definitions](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).
4. Store each app's values through an approved secure secret-entry route and
   inject API-only ECS secret references using the four names above. Never put
   values in chat, Git, screenshots, command arguments, task plaintext environment,
   `NEXT_PUBLIC_*`, or mobile settings. Existing infrastructure/secret changes
   still need their applicable approval. The execution role must have narrow
   access to the selected existing/new secret references; metadata presence alone
   does not prove permission or valid values.
5. Keep callback identity and the encryption key stable. Saved tenant app
   snapshots preserve prior application credentials when hosted environment
   values change; rotation is not automatic replacement of existing grants.
   Retain failed upstream revocation recovery until confirmed. Do not delete old
   credentials/registrations blindly while grants or callbacks depend on them.
6. Release validated API **and** web code together through the existing guarded
   immutable build/release path. Resolve the recorded image-security hold first;
   this document does not authorize deploying known failing images.
7. With separately approved owner-controlled account/repository metadata scopes,
   verify popup sign-in, account verification, multi-page selection, review,
   save, resume and disconnect/revocation. Denial, popup blocking, unavailable app,
   stale role/tenant and retry paths must remain fail-closed. No customer source
   read or AI processing is implied by this test.

Publicly reachable self-hosted GitLab needs a separate app for its own instance,
configured once by that customer's workspace admin on the advanced integration
settings screen. A GitLab.com application cannot authorize a different instance.
Private-network and IPv6-only instance access remain unavailable.

## Offline, redacted wiring check

Run against an authorized current `describe-task-definition` response or a local
receipt, without resolving secret values:

```powershell
node scripts/check-repository-oauth-readiness.mjs --input <task-metadata-file>
```

Or pipe the API task metadata response to the script's standard input. Optional
`--container` and `--origin` support explicit non-production checks. Exit 0 means
the metadata has both hosted app secret-reference pairs, an encryption-key
reference and the expected HTTPS-root callback origin. Exit 1 means wiring is
incomplete/unsafe; exit 2 means malformed input/options. Output contains static
binding statuses and callbacks, never secret values or ARNs.

The checker intentionally does not fetch secrets, inspect tenant DB records,
contact providers, validate IAM, inspect current running code, or claim an app
is registered. It rejects plaintext credentials and duplicate bindings. Local
tests do not close registration, deployment or provider acceptance gates.

## Remaining providers, honestly

| Provider                         | Implemented connection slice                                                                    | Remaining native connection gate                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| GitLab                           | Hosted or public self-hosted OAuth, identity check, bounded repo catalog and reviewed selection | Application activation, live-provider acceptance; private-network hosts                  |
| GitHub                           | Hosted OAuth, identity check, bounded repo catalog and reviewed selection                       | Application activation, live-provider acceptance; narrower selected-repo GitHub App path |
| Bitbucket Cloud                  | Encrypted token verification, repository catalog and reviewed selection                         | Native OAuth; Bitbucket Server                                                           |
| Azure DevOps Services            | Encrypted token verification, repository catalog and reviewed selection                         | Native OAuth; Azure DevOps Server                                                        |
| Self-hosted Git / Perforce / SVN | Exported evidence/test intake and unverified reference                                          | Native authentication, repository catalog, source discovery                              |

Showing a provider in the dropdown must not make any unimplemented/native or
unconfigured capability appear connected. Token/export fallbacks remain distinct
from the requested OAuth experience.
