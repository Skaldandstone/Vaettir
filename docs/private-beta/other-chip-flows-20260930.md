# Other source chips: implemented paths and acceptance gates

## Same-page actions

The project Overview and population modal share the same repository connection screens. GitHub and GitLab retain native OAuth popup authorization. Bitbucket Cloud and Azure DevOps Services now verify read-only token access, list searchable repository metadata, retain multi-selection across visited pages, and require review before registering repositories. No source files or AI processing occur in these flows.

Bitbucket uses an Atlassian account API token, account email and selected workspace. Azure uses an organization-scoped Code (Read) PAT and an active authenticated principal, not anonymous public repository visibility. Credentials are encrypted with the existing integration key and retained for at most eight hours of local connector use. Removing local saved access does not revoke provider credentials. Expired interrupted verification can be removed and retried; late results cannot restore it.

Repository native identity survives renamed URLs, repeated selection and manual revision edits. Conflicting native identities or another actor's connection require explicit reconciliation rather than silent replacement. Provider default branches are metadata, not deployed revisions. Listing rechecks live tenant membership before and after provider I/O; persistence checks current full-seat editor access and suspension.

PagerDuty and Datadog chips now open routing, webhook instructions and reviewed-save screens. They show real signing/release prerequisites, exact endpoints, copy controls and provider setup instructions. Saving is routing configuration, not evidence of received delivery. Concurrent route changes are rejected against the dialog's original baseline. Newly stored Datadog header secrets are encrypted; existing legacy configuration remains readable without rewriting customer records. Native incident event identities and durable atomic receipts prevent replayed alerts from creating duplicate risk flags, including concurrent retries and changed release state. Legacy payloads without native event identity deduplicate exact relevant payloads; otherwise identical distinct incidents require native IDs to distinguish them.

Self-hosted Git, Perforce and SVN offer exported-document intake or existing-test import inside the modal. Native account browsing is not implemented for these providers. Optional reference registration remains explicitly unverified. Jira, Linear and Google Drive source chips open reviewed exported-text/document intake; they are not claimed as native source discovery. No ADB/Appium device helper is presented as a repository connector.

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
