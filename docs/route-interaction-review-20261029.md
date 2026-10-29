# Route interaction review — 2026-10-29

Source review covers all 66 page routes and their statically imported local components. Counts below identify reachable control/disclosure sites; they are not a claim that every conditional screen was rendered. Redirects and pages with no local buttons still use the shared shell.

## Interaction contract

- Action labels use concise task verbs; full descriptions appear on keyboard focus and pointer hover. Escape dismisses tips, pointer movement into a tip retains it, touch performs one activation, and native form/ref behavior is retained.
- Case actions appear directly for individual and selected cases. Move and Tag freeze the selected IDs for their task dialog. Destructive review, bounded batches, authorization and immutable retries remain in their existing handlers.
- Supporting provenance and caveats are in closed Details. Current failures, explicit consent, uncertain-write recovery and necessary source-field instructions remain visible.
- Record selectors, source names, selected filter values, measured counts and evidence identifiers remain intact. They are data labels, not generic action captions. Critical permission notices are not hidden merely to reduce word count.
- Jira source connection remains owned by the separately coordinated Atlassian OAuth slice; this review does not approve its provider configuration.

## Route checklist

Each row records completed source coverage. Browser evidence is representative, listed separately below.

| Route | Reachable control sites | Details sites | Source scope |
| --- | ---: | ---: | --- |
| `/account/security` | 9 | 0 | Reviewed |
| `/admin/organizations/[id]` | 11 | 1 | Reviewed |
| `/admin` | 1 | 0 | Reviewed |
| `/admin/repo-health` | 1 | 0 | Reviewed |
| `/beta-guide` | 0 | 0 | Reviewed |
| `/connections/drive/callback` | 2 | 0 | Reviewed |
| `/connections/github/callback` | 2 | 0 | Reviewed |
| `/connections/gitlab/callback` | 2 | 0 | Reviewed |
| `/dashboard` | 0 | 0 | Reviewed |
| `/google-sheets-privacy` | 0 | 0 | Reviewed |
| `/integrations/atlassian/connect` | 4 | 0 | Reviewed |
| `/invite/[token]` | 3 | 0 | Reviewed |
| `/onboarding` | 4 | 0 | Reviewed |
| `/` | 16 | 0 | Reviewed |
| `/projects/[projectId]/architecture` | 37 | 7 | Reviewed |
| `/projects/[projectId]/audit-log` | 1 | 1 | Reviewed |
| `/projects/[projectId]/compliance` | 28 | 3 | Reviewed |
| `/projects/[projectId]/defect-map` | 256 | 55 | Reviewed; Jira OAuth handoff separate |
| `/projects/[projectId]/execution-trends` | 16 | 7 | Reviewed |
| `/projects/[projectId]/exploratory/[sessionId]` | 3 | 0 | Reviewed |
| `/projects/[projectId]/exploratory` | 1 | 1 | Reviewed |
| `/projects/[projectId]/import` | 49 | 25 | Reviewed |
| `/projects/[projectId]/live-app-generation` | 28 | 9 | Reviewed |
| `/projects/[projectId]/manual-run-comparison` | 13 | 2 | Reviewed |
| `/projects/[projectId]` | 279 | 57 | Reviewed; Jira OAuth handoff separate |
| `/projects/[projectId]/populate/assessment` | 0 | 1 | Reviewed |
| `/projects/[projectId]/populate/documents` | 9 | 5 | Reviewed |
| `/projects/[projectId]/populate` | 238 | 52 | Reviewed; Jira OAuth handoff separate |
| `/projects/[projectId]/populate/requirements` | 4 | 0 | Reviewed |
| `/projects/[projectId]/production-signals` | 6 | 2 | Reviewed |
| `/projects/[projectId]/quality-risks` | 46 | 16 | Reviewed |
| `/projects/[projectId]/recorded-run-comparison` | 13 | 2 | Reviewed |
| `/projects/[projectId]/releases/[releaseId]` | 43 | 13 | Reviewed |
| `/projects/[projectId]/releases` | 24 | 7 | Reviewed |
| `/projects/[projectId]/reports` | 84 | 38 | Reviewed |
| `/projects/[projectId]/reports/snapshots/[snapshotId]` | 14 | 7 | Reviewed |
| `/projects/[projectId]/requirement-baselines` | 24 | 8 | Reviewed |
| `/projects/[projectId]/requirement-coverage` | 16 | 9 | Reviewed |
| `/projects/[projectId]/requirements` | 274 | 52 | Reviewed; Jira OAuth handoff separate |
| `/projects/[projectId]/reverse-engineer` | 242 | 51 | Reviewed; Jira OAuth handoff separate |
| `/projects/[projectId]/settings/integrations` | 240 | 49 | Reviewed; Jira OAuth handoff separate |
| `/projects/[projectId]/settings` | 8 | 1 | Reviewed |
| `/projects/[projectId]/shared-steps` | 23 | 3 | Reviewed |
| `/projects/[projectId]/tags` | 8 | 2 | Reviewed |
| `/projects/[projectId]/test-cases/[id]/edit` | 48 | 12 | Reviewed |
| `/projects/[projectId]/test-cases/[id]` | 168 | 47 | Reviewed |
| `/projects/[projectId]/test-cases/[id]/unreal` | 6 | 1 | Reviewed |
| `/projects/[projectId]/test-cases/new` | 48 | 12 | Reviewed |
| `/projects/[projectId]/test-cases` | 400 | 98 | Reviewed |
| `/projects/[projectId]/test-cases/review` | 12 | 5 | Reviewed |
| `/projects/[projectId]/test-plans/[id]` | 82 | 25 | Reviewed |
| `/projects/[projectId]/test-plans` | 90 | 27 | Reviewed |
| `/projects/[projectId]/test-runs/[testRunId]` | 0 | 0 | Reviewed |
| `/projects/[projectId]/test-runs/manual/[testRunId]` | 66 | 22 | Reviewed |
| `/projects/[projectId]/test-runs` | 47 | 19 | Reviewed |
| `/projects/[projectId]/test-strategy` | 9 | 1 | Reviewed |
| `/projects` | 22 | 2 | Reviewed |
| `/settings/access-review` | 6 | 0 | Reviewed |
| `/settings/billing` | 8 | 4 | Reviewed |
| `/settings/integrations` | 232 | 48 | Reviewed; Jira OAuth handoff separate |
| `/settings/integrations/repositories` | 13 | 2 | Reviewed |
| `/settings/members` | 11 | 1 | Reviewed |
| `/settings/organization` | 26 | 4 | Reviewed |
| `/share/requirements/[token]` | 0 | 0 | Reviewed |
| `/sign-in/[[...sign-in]]` | 0 | 0 | Reviewed |
| `/sign-up/[[...sign-up]]` | 0 | 0 | Reviewed |

## Validation boundaries

Real Chromium checks exercise the complete Import and Reports pages through the unchanged tRPC provider and auth query client, plus native tooltip and inline case-tool interactions. These cover keyboard/pointer/touch behavior, dark/light/narrow layouts, retained source-row edits, original-account access loss, exact uncertain retries, export failure recovery and late-output discard. Office downloads are checked as editable packages.

Controller fixtures expose the full action description at the native-button boundary so their original guard assertions and raw multiline values remain exact. They do not substitute for browser rendering. PostgreSQL fixtures verify queue atomicity, original actor/workspace bindings, revocation, source coordinates, saved-row repair and legacy/new project-key aliases.

Hosted acceptance of this change, real provider authorization, native Office acceptance and the remaining reporting parity gaps are separate operator gates. No provider, deployment, purchase or AI execution is performed by this source slice.
