# Project reporting, saved views and regulatory intake

## Source checkpoint

- Test-case views save each member's project-specific suite, search, filters and sort order. The API accepts only bounded typed fields, authorizes the current project, scopes every write to its creator, and uses a version compare-and-swap for updates and deletion. Applying a view changes only the local case-list display; it does not edit test cases. A narrow-layout overflow was corrected so the table scrolls inside its own panel.
- The project Reports screen offers a database-snapshot inventory, requirement and execution summary, 7/30/90-day or all-run window, recorded run drilldowns, and a Markdown export. It labels denominators and separates case inventory from execution outcomes and release readiness. It does not imply that a criterion is covered by a test or that a commit is deployed. Manual runs do not display placeholder branch/commit as real source evidence.
- New-project intake now separates regulatory areas to **investigate** from standards/control frameworks to review. Existing quality profiles remain readable with an empty regulatory list. Existing-project population drafts retain older data and can carry a separate regulatory note. Neither UI determines legal applicability or grants an attestation. New projects move into the in-page Add sources modal after creation; a bare repository URL is no longer presented as a verified connection in the creation form. The overview now directs repository work to the multi-provider chip group instead of a second legacy GitHub URL-only chip.

## Validation and boundaries

- Fresh local disposable PostgreSQL migration/seed and full API suite: passed on `vaettir_ux_test_1790755677314`. The saved-view integration suite covers tenant/user/project isolation, conflicts and input bounds. The report integration suite covers project isolation and recorded data. API/web typechecks and Prisma schema validation passed. Web unit/contract suite: 61 passed.
- Saved-view actual component was exercised in a synthetic desktop/mobile fixture: save, apply, changed-state, update and delete; document scroll width equals viewport at 375px, with only the table scrolling horizontally inside its panel. Actual report component rendered at 1280px and 375px without page overflow; local Markdown download was checked. These are fixture and source checks, not production acceptance.
- No customer data, repository source, provider authorization, paid AI, invitations or production records were changed for this source checkpoint. Saved views and Reports are not a universal query language, custom dashboard builder, cross-project report catalog, PDF exporter or scheduled report system. Suite drag/drop, prerequisites, step media identity and other provider-native connectors remain separate work.

## Release state

Source-only at this checkpoint. Append immutable commit, CodeBuild/ECS identity, compatible migration result and authenticated browser smoke after the next approved release. Production's existing cost schedule stops Vaettir API/web and RDS at 01:00 Pacific and starts them at 08:00 Pacific; a manually timed smoke before 07:00 requires a temporary start of existing resources, not an inference from a successful build.
