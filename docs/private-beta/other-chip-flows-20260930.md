# Other source chips: implemented paths and acceptance gates

## Same-page actions

The project Overview and population modal share the same repository connection screens. GitHub and GitLab retain native OAuth popup authorization. Bitbucket Cloud and Azure DevOps Services now verify read-only token access, list searchable repository metadata, retain multi-selection across visited pages, and require review before registering repositories. No source files or AI processing occur in these flows.

Requirements intake and Reverse Engineer also open the shared connection screens in place, rather than navigating away to Overview. Generic project source chips use the same provider-specific screens without requiring caller-supplied callbacks. Successful repository approvals refresh the project and repository queries; ticket/document exports remain distinct from authenticated repository access.

Bitbucket uses an Atlassian account API token, account email and selected workspace. Azure uses an organization-scoped Code (Read) PAT and an active authenticated principal, not anonymous public repository visibility. Credentials are encrypted with the existing integration key and retained for at most eight hours of local connector use. Removing local saved access does not revoke provider credentials. Expired interrupted verification can be removed and retried; late results cannot restore it.

Repository native identity survives renamed URLs, repeated selection and manual revision edits. Conflicting native identities or another actor's connection require explicit reconciliation rather than silent replacement. Provider default branches are metadata, not deployed revisions. Listing rechecks live tenant membership before and after provider I/O; persistence checks current full-seat editor access and suspension.

PagerDuty and Datadog chips now open routing, webhook instructions and reviewed-save screens. They show real signing/release prerequisites, exact endpoints, copy controls and provider setup instructions. Saving is routing configuration, not evidence of received delivery. Concurrent route changes are rejected against the dialog's original baseline. Newly stored Datadog header secrets are encrypted; existing legacy configuration remains readable without rewriting customer records. Native incident event identities and durable atomic receipts prevent replayed alerts from creating duplicate risk flags, including concurrent retries and changed release state. Legacy payloads without native event identity deduplicate exact relevant payloads; otherwise identical distinct incidents require native IDs to distinguish them.

Self-hosted Git, Perforce and SVN offer exported-document intake or existing-test import inside the modal. Native account browsing is not implemented for these providers. Optional reference registration remains explicitly unverified. Google Drive remains reviewed exported-text/document intake, not native discovery. Project-scoped Linear now has a separate verified metadata connection in source at 80d8bc9; Jira Cloud has a subsequent equivalent source-only account/project selection slice documented below. Neither reads issues or imports requirements yet. No ADB/Appium device helper is presented as a repository connector.

## Follow-up source correction - 2026-10-01

Jira Cloud chips now open verified account/site metadata, paginated native project choices, filtering/multi-selection and explicit additive source-scope approval. Standard Atlassian API tokens without scopes are supported by the site-local connector. OAuth, modern scoped-token gateway access, self-hosted Jira, issue-content import and sync are unavailable, not configured connections. Access is actor/project/tenant-bound, encrypted and expires locally after eight hours. Multiple Jira sites can be selected independently. A compatible nullable provider-origin migration preserves prior Linear records.

Saved repository registrations now reopen their provider module for editors; viewers retain read-only reference/status display. Integration health no longer reports Connected merely because settings exist. Project-scoped Jira/Linear/signal setup opens an accessible-project chooser in place. Historical sync/delivery evidence is qualified; stale/error project queries expose no connection actions. Legacy organization health counts do not include actor/project-scoped metadata connections and say so explicitly. Slack/webhook setup review keeps its intentional advanced organization-settings link; it does not manufacture OAuth or delivery acceptance.

The ten-page catalog cap is enforced server-side for both Jira and Linear. A continuation withheld at the cap is not retained as an accepted API cursor, including catalogs with repeated native identities. Scope and approval receipts survive access failures and removal; existing requirements, tests and human edits are untouched.

PD/DD/P4/SVN textual fallback marks are not native provider logos. Official asset availability was checked separately from redistribution/use permission: Datadog requires written consent, PagerDuty has gated guidelines and full-wordmark sizing, Perforce forbids altered composition, and Apache requires attribution and a project-homepage link for permitted references. Do not invent/crop compact brand marks or claim this remaining branding gate complete. [Datadog terms](https://www.datadoghq.com/legal/terms/), [PagerDuty brand portal](https://brandfolder.com/pagerduty/external), [Perforce logo guidelines](https://www.perforce.com/resources/brand-guidelines/logos), [Apache trademark policy](https://www.apache.org/foundation/marks/).

This follow-up is source-only until exact-commit migration/build/release and authenticated smoke evidence are recorded. No scheduled-off environment wake-up, provider/customer source access or paid AI processing is part of its validation.

## Provider references

- [Bitbucket API token authentication](https://support.atlassian.com/bitbucket-cloud/docs/using-api-tokens/)
- [Bitbucket user API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-users/)
- [Bitbucket repository API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-repositories/)
- [Azure repository listing API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/repositories/list?view=azure-devops-rest-7.1)
- [Azure scoped PAT setup](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops)
- [PagerDuty webhook setup](https://support.pagerduty.com/main/docs/webhooks)
- [Datadog webhook variables and custom headers](https://docs.datadoghq.com/integrations/webhooks/)

## Validation boundaries

Synthetic adapter/network tests, disposable PostgreSQL migrations and integration tests cover consent, tenant isolation, encryption, retries, catalog approval, native rename preservation, live membership changes, route conflicts, encrypted/legacy secret compatibility and alert replay recovery. Rendered real components against synthetic metadata cover multi-page selection, back/review/save, guided alert setup and export intake at desktop/mobile widths. A fixture initially lacked import mutation hooks; diagnostic evidence identified the fixture omission and the corrected fixture renders the real import screen.

Windows standalone Next output encountered `EPERM` at dependency symlink creation after compilation and page generation. Exact-commit Linux CI and CodeBuild production builds are the release-build acceptance path; the check is not disabled or replaced with a no-standalone configuration. Deployment must be recorded by immutable commit/digest and authenticated runtime smoke, separately from source tests.

Real provider token acceptance, OAuth account authorization, repository listing and webhook delivery remain unverified until exercised with owner-controlled, non-customer or explicitly consented credentials. Private-network source intake, Bitbucket Server, Azure DevOps Server, native Git/P4/SVN and automatic token refresh remain future adapters. No customer source access, invitations, paid AI calls or new infrastructure are part of this change.
