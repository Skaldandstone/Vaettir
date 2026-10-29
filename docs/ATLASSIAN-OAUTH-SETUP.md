# Atlassian browser connections

Vaettir starts Jira and Confluence connections from project Integrations. The normal path signs in with Atlassian, selects an observed Cloud site and reviews projects or spaces. Manual Jira tokens remain under Advanced for existing deployments.

## Provider setup awaiting owner review

No OAuth client, credential or provider grant is created by the source change. Before enabling production, review one Vaettir OAuth 2.0 (3LO) application with this exact configuration:

| Setting | Value |
| --- | --- |
| Callback | `https://app.vaettir.app/connections/atlassian/callback` |
| Audience | `api.atlassian.com` |
| Read scopes | `read:me read:jira-work read:jira-user read:space:confluence offline_access` |
| Grant | Confidential authorization code; rotating refresh tokens |
| Application website | `https://vaettir.app` |
| Write scopes | None |

Both product scopes are declared together because later consent to the same Atlassian application can replace the previous consent's scope set. The UI discloses this in Permissions. Vaettir separately records the selected product, site and approved resource identities; provider consent alone does not authorize issue intake or page content reads. The Jira issue preview keeps its existing separate read approval and reviewed save. Confluence setup currently lists and approves space metadata; it does not import page bodies or install the Forge quality-sharing app.

Use the existing deployment secret mechanism for `ATLASSIAN_OAUTH_CLIENT_ID` and `ATLASSIAN_OAUTH_CLIENT_SECRET`, and set `ATLASSIAN_OAUTH_PUBLIC_URL=https://app.vaettir.app`. Never put a secret in source, browser storage, a URL, review evidence or chat. The existing `PRODUCTION_SIGNAL_ENCRYPTION_KEY` protects stored application snapshots and tokens. Secure storage plus all three Atlassian settings are required before Connect is enabled. Do not change the existing global `WEB_APP_URL` to activate this callback.

## Authorization and recovery

State expires after five minutes and is bound to the verified human Clerk subject, native actor, original organization and project. API keys cannot start or use the OAuth connection. Exchanges and refresh rotations claim a durable operation before provider I/O. Issued credentials are retained encrypted before account verification. Unknown responses, lost permissions, changed identities and disconnect races fail closed; codes and refresh tokens are not automatically replayed. A fresh connection is required after an uncertain operation.

Only an observed site can be selected. Catalog pages are reconstructed through fixed `api.atlassian.com/ex/...` paths with validated cloud IDs and cursors; provider-supplied URLs are not followed. Project approvals have bounded immutable request receipts. A linked Jira token-reader row references the original OAuth grant instead of copying a rotating bearer token; legacy approval endpoints cannot broaden its approved scope.

Disconnect immediately stops Vaettir access and retains approved resource metadata and evidence. It does not claim provider revocation. Remove Vaettir from [Atlassian's connected apps](https://id.atlassian.com/manage-profile/apps) to revoke the provider grant. In-flight or uncertain issued credentials remain encrypted for recovery and cannot be used by the reader.

## Release checks

Apply the additive `20261030002000_atlassian_oauth` migration before the API image. Existing token rows and customer data are unchanged. Rolling back to the previous API leaves the new tables and nullable foreign key unused. Disable the dedicated Atlassian configuration to stop new sign-in starts; this does not revoke an existing provider grant. Provider disconnection and application revocation remain explicit owner operations.

The durable database suite checks one-use exchanges/rotations, scope receipts, interrupted operations, disconnects, changed membership/identity and the Jira bridge. The mounted browser suite uses the actual component with synthetic transport and checks consent, site/resource selection, exact retry, stale metadata suppression, keyboard tooltips, themes and narrow layout. These checks do not prove live Atlassian consent or a customer acceptance test. The first provider test must use the Skald synthetic sandbox. aTwist directory activation remains pending review.

References: [Jira 3LO](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/), [Confluence 3LO](https://developer.atlassian.com/cloud/confluence/oauth-2-3lo-apps/), [3LO FAQ](https://developer.atlassian.com/cloud/oauth/getting-started/faq/), [Confluence space API](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-space/).
