# Vaettir Jira OAuth setup

Use one shared Vaettir application. Customers sign in to Atlassian, approve read access, then choose Jira projects in Vaettir. They should not create applications or supply API tokens.

## Platform configuration

1. In the [Atlassian developer console](https://developer.atlassian.com/console/myapps/), prepare an OAuth 2.0 integration named **Vaettir** with a resource-level grant.
2. Set the callback to `https://vaettir.skaldandstone.com/connections/jira/callback`.
3. Add Jira read scopes `read:jira-work` and `read:jira-user`. Request `offline_access` for renewable access. Do not add write or administrative scopes.
4. Store the client ID and secret in the platform vault, not customer settings, source control or chat.
5. Enable distribution only after the callback and project selection flow are deployed and tested. The app owner must approve any required terms.

## Implementation acceptance

The existing token connector is not the OAuth flow. Activation also requires a single-use callback bound to the signed-in actor and project, encrypted grants, serialized refresh-token rotation, current membership checks and an explicit project checklist. Retain saved project selections when access is revoked; offer reauthorization without silently granting new scopes.

Use `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/` for Jira API requests. Never choose a site solely from its name or an unverified URL.

Reference: [Atlassian authorization and refresh guidance](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/), [project discovery](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/#api-rest-api-3-project-search-get), [account verification](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-myself/#api-rest-api-3-myself-get).
