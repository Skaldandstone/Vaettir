# Native Linear source scope checkpoint

## Implemented source slice

SSE-135 / P9-00 and P9-02: project-scoped Linear chips open a shared in-page
modal with access verification, paginated project selection, focused review and
explicit scope approval. The underlying page stays in place. Previously approved
scope is retained on refresh, missing/inaccessible inputs and removal of saved
access. Native project IDs prevent duplicate scope entries on identical reruns.

This is a personal API-key metadata connection, not an OAuth integration or an
issue importer. It reads account/workspace identity and project ID/name/URL only.
It does not read issues, issue descriptions or client source, create requirements,
run imported code, call AI or charge credits. OAuth and issue import/sync capability
flags are false. Jira, Google Drive, Git, Perforce and SVN remain export intake;
the prior Bitbucket/Azure and GitHub/GitLab flows are unchanged.

The modal provides a Linear Security & access link, scoped read-only key guidance,
metadata consent, workspace/account verification results, page filtering,
cross-page multi-selection, back/refresh/retry, previous-connection resume and
confirmed access removal. Vaettir cannot prove that a supplied key lacks write
permissions; it sends only its internal static metadata queries. Browser OAuth
and issue synchronization remain separate unfinished product work.

## Security and persistence

- Full editor seat and active organization membership required server-side;
  credentials and catalogs are actor/project/tenant bound. Authorization is checked
  again after provider I/O and within locked write transactions.
- Encrypted credential storage is mandatory before any provider request. No key,
  ciphertext, raw provider error or approval receipt is returned to the browser.
  Encryption uses the existing integration key; do not rotate it casually.
- Verification has a ten-minute lease, durable request identity and changed-input
  rejection. Actor attempts are bounded to twenty per hour; access expires in
  Vaettir after eight hours. A failed/expired attempt requires a new request.
- The fixed Linear HTTPS endpoint uses pinned public DNS/TLS, no redirects, a
  fifteen-second deadline and a one-MiB response cap. No user-supplied GraphQL or
  URL is accepted. GraphQL partial errors fail closed. Native identity and returned
  project URLs are validated; pagination cursors never become network URLs.
- Catalog batches are capped at ten pages / five hundred projects. First-page
  refresh replaces the current catalog, not approved scope. Continuations do not
  extend the ten-minute review freshness window. Truncation is explicit.
- Scope additions require explicit review approval, current catalog version and
  allowed IDs. Locked compare-and-swap and durable approval receipts make retries
  idempotent and reject stale concurrent changes. Existing records are never
  silently deleted when a source disappears or access fails.
- Removing access clears encrypted credentials and prevents in-flight catalog
  writes, but retains approved scope. Remote revocation must be performed in Linear.

The additive `20261001081500_linear_source_connections` migration creates a
dedicated TicketSourceConnection table and relations. It does not alter existing
requirements, legacy organization Linear keys or customer records. Apply before
releasing this API/UI pair through the established guarded release path; older
application revisions ignore the new table. Do not roll back by dropping it.

## Validation and acceptance boundary

Fresh disposable loopback PostgreSQL migration/seed passed. Focused provider and
connection tests passed 94/94; the full API suite passed 619/619 in 88 files. Web
contracts passed 68/68; workspace typecheck, lint (zero errors, existing warnings)
and API build passed. Initial transport assertion failure was reproduced as a
synchronous-throw versus Promise rejection mismatch; the async helper contract
was corrected and focused/full suites rerun without weakening assertions.

Integration cases cover consent, missing storage, role/seat/tenant/actor denial,
verification and approval retries, changed inputs, expired/abandoned verification,
stale/concurrent reviews, pagination cycles/caps, missing/inaccessible inputs,
identity drift, permission revocation and access removal during provider I/O.

Rendered Chrome synthetic checks exercised actual shared chip/modal components:
verification, two-page selection, back/review/save, close/reopen/resume, confirmed
access removal retaining approved scope, storage/viewer denial and retry recovery.
A 343-pixel modal-container check verified long project labels and wrapped actions;
this is not full mobile-device acceptance. No live provider credentials were used.
Local diagnostic evidence is retained under `.local/linear-validation/` and is
deliberately excluded from Git. Exact-commit Linux CI is a separate build gate.

This checkpoint is source-only, not deployed or accepted by a live provider.
Remaining gates include guarded API/web release plus compatible migration,
authenticated runtime/role smoke, an owner-approved read-only Linear key and
explicit scope for actual catalog acceptance. OAuth registration/PKCE and reviewed
issue import/sync require subsequent implementation, not merely configuration.

## Primary provider references

- [Linear GraphQL authentication and read queries](https://linear.app/developers/graphql)
- [Linear cursor pagination](https://linear.app/developers/pagination)
- [Linear API key permissions](https://linear.app/docs/api-and-webhooks)
- [Linear OAuth and PKCE](https://linear.app/developers/oauth-2-0-authentication)
