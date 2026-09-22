# Unreal playtest bridge (technical preview)

This is a two-way editor/PIE integration, not packaged-game automation. A tester authors a normal Vaettir case, reviews a local Unreal catalog's level and actor candidates, saves an ordered objective binding, queues a run, and later reads the result under that same case. A local worker claims only its configured project key and returns objective outcomes. Vaettir adjudicates required objectives and creates a linked `TestRun` and `TestResult`.

## Data ownership and safety

- The local Unreal operator chooses which `.uproject` and level to publish. The server stores map package paths, actor labels, tags, and positions, not a local filesystem path. The worker separately checks an explicit local map allowlist.
- Vaettir rejects a queue request unless the selected level exists in that project's published catalog and every objective resolves to exactly one actor there. Text matches in the UI are suggestions; the tester confirms the binding.
- A queued job contains the case/version and binding snapshot. Only a project service API key can claim or finish it, and only the claiming identity can finish it. A failed or malformed Unreal report becomes `ERROR`/`BLOCKED`, not a pass.
- There is no remote shell command, automatic baseline acceptance, or silent fallback from objective test to exploratory walk. Worker setup and secret provisioning remain local.
- A claimed job is not automatically retried if the worker crashes. An operator must investigate the local evidence and explicitly decide how to recover it. This is a technical-preview limitation.

## Setup for a supervised local demo

1. Apply the Prisma migration and deploy the matching Vaettir API and web build to the chosen environment. Do not point a worker at a Vaettir environment that lacks the new router.
2. Install the matching UE 5.8 AgentToolkit build into the local project and enable PythonScriptPlugin for catalog export.
3. Create a project-scoped Vaettir service API key and set `VAETTIR_API_KEY` in the worker process environment. Never put the key in a test case, shell history, Git, or the pitch deck.
4. In the toolkit repository, run `scripts/Publish-VaettirPlaytestCatalog.ps1` with the Vaettir API base URL (ending in `/api/trpc`), Vaettir project ID, local project key, physical `.uproject`, and one approved `/Game/...` map. Repeat for each approved map. The catalog is read-only and actor inventory can become stale after a level edit; republish after changes.
5. In Vaettir, author or open the case, follow **Unreal playtest (technical preview)**, select the cataloged project and level, draft goals from the case's When steps if useful, confirm each actor, and save. Queue the saved binding.
6. Run `scripts/Run-VaettirPlaytestJob.ps1` in the toolkit repository with the same API URL, project ID, project key, local `.uproject`, and `-AllowedMaps` containing the approved `/Game/...` path or paths. It handles one job and exits. Return to the Vaettir case to inspect the linked run.

## Acceptance still open

The control-plane code and disposable-database tests do not prove the full workflow. Before calling this shipped or adding it to investor claims, capture a real map/actor catalog, one successful required-objective run, one intentionally missed-objective run, exact plugin/engine/game commits, returned Vaettir results, worker logs, and a tester-driven UI walkthrough. A `FAILED` run with a report-backed required-objective assertion is different from `ERROR`/`BLOCKED` for editor or report failures. Test on the deployed environment only after secrets and migration scope are reviewed. Exploratory, traversal, fuzzing, and real frame-time performance modes need separate contracts and acceptance.
