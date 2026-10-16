# Vaettir Quality Intelligence for Atlassian

Company-owned Forge app. Architecture analysis, PlantUML/SVG sources, AI drafts
and architecture-to-test mapping live in Vaettir, not this app.

## Native surfaces

- Jira's collapsible **Vaettir tests** issue context shows cases explicitly
  linked to the exact ticket and their recorded verification outcomes.
- The **Quality Intelligence** project page shows explicitly approved quality
  captures and linked releases, validation runs, progress and release concerns.
- The **Vaettir Quality Intelligence** Confluence macro embeds approved report or
  historical closure captures. A space requires its own Vaettir approval.

These are native Atlassian app surfaces. End users do not need a Chrome or
other browser extension. The frontend Forge bridge serializes request objects
as JSON; do not add a redundant custom content-type header to that bridge.
The backend release consumer uses the separate `@forge/api` string-body API.

The project page is a supported Jira extension point. This does not claim a
custom chart inserted into Jira's built-in release page or Development
Connections screen. Manual runs are not fabricated as CI builds; failed tests
are not published as vulnerabilities.

## Release history

An administrator explicitly links a numeric Jira version ID to a Vaettir release
and selected validation runs in project Settings / Integrations. The app queues
`avi:jira:released:version` notifications durably in Forge. Its private consumer
uses a fresh app-system token to verify that version and asks Vaettir to capture
the approved scope. Short-lived tokens are never queued, stored or logged.

The first successful capture for the installation, project and version is
immutable. Retries, run edits, reopening or releasing again cannot replace it.
It records processing time and notification observation time, not an invented
exact Jira transition timestamp. Missing historical captures are explicitly
unavailable; current metrics never masquerade as closure-time evidence.

Captured definitions and execution context stay private in Vaettir. Atlassian
gets only approved case headers, summary metrics and access-controlled links.
Recorded Pass is not proof of the current case or release revision. Unrun,
blocked, skipped, flaky, mixed and ambiguous results remain distinct.

## Company isolation and setup

Registered company app ID:
`ari:cloud:ecosystem::app/743bf96f-0f9f-4fed-981a-ea3fc318d15d`.
The manifest belongs to the Skald and Stone Developer Space. Do not re-register
it under an aTwist or personal developer account.

`Invoke-CompanyForge.ps1` verifies the company identity before commands. Its
user-run StoreToken action prompts privately and uses current-user Windows DPAPI
inside ignored `.local/atlassian-company`. Runtime environment overrides do not
replace shared CLI/keychain authentication. Never put tokens in this repository,
command arguments, screenshots, chat, or a checked-in environment file.

The nested pnpm workspace isolates Forge dependencies and its lockfile from the
Vaettir runtime. Run `pnpm --dir integrations/atlassian install --frozen-lockfile
--ignore-scripts`, `pnpm --dir integrations/atlassian typecheck`, and the helper's
Lint action before deploying. Its ProseMirror override pins the fix for
[GHSA-c8x8-7fp4-3x9w](https://github.com/advisories/GHSA-c8x8-7fp4-3x9w).

Vaettir's remote bridge is disabled unless `VAETTIR_FORGE_APP_ID` and
`VAETTIR_FORGE_ENVIRONMENT_ID` explicitly identify this app and the intended
environment ARI. Development and production environments are not interchangeable.
Each installation/cloud/project-or-space requires its own administrator approval
in Vaettir. Reinstalling requires reviewing a new installation identity.

Installation requires separate site consent to the read-only product scopes and
Vaettir remote. Registration, lint, deployment, installation, live event delivery
and Marketplace publication are separate evidence gates. Do not equate one with
another, or install on a customer site for company development.

Official references:
[issue context](https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-issue-context/),
[remote security](https://developer.atlassian.com/platform/forge/remote/essentials/),
[async events](https://developer.atlassian.com/platform/forge/runtime-reference/async-events-api/),
[Jira events](https://developer.atlassian.com/platform/forge/events-reference/jira/).
