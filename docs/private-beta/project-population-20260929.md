# Project population: overnight implementation ledger

## Product acceptance

The new-project wizard and an existing-project **Update project understanding** entry share a saveable, resumable flow. One clear decision per step; compact provider-logo chips; optional sources and advanced details; accessible back/skip controls; scope and cost review before any generation or import write. This is a utility UI, not a giant configuration dashboard.

Projects may use multiple repositories, ticket systems, release plans and documents. Connector targets include GitHub, GitLab, Bitbucket, Azure DevOps, self-hosted Git, Perforce, SVN, Jira and Linear. A provider identity contract is not an implemented or verified adapter. Native commit, changelist, revision and document/ticket version identities must survive every transformation.

Discover README/specification/API-contract/source/test/CI evidence, separating documented intent, observed implementation and inference. Review the system map and reconcile existing cases before approving generated work. Assess phases per component/release, cite evidence, expose missing/stale/conflicting inputs, accept corrections and provide useful prefilled next actions. No numerical accuracy claim. Branch activity is not deployment proof.

Rerun all or selected sections on the same project. Preserve stable identities, human edits, approvals and completed work. Preview new, changed, unchanged, conflicting and unavailable inputs. Absence is never automatic deletion. Refresh only affected derived outputs, retaining history and provenance.

## Increment 1: implemented source foundation

`packages/core/src/projectPopulation.ts` exports validated native revision/evidence/scan contracts and a deterministic reconciliation preview. Identity includes project, server-owned source connection, selected scope and native object ID, so equal paths across repositories/branches cannot collide. The preview:

- Rejects cross-project/out-of-scope evidence, ambiguous duplicate identities and inconsistent unavailable scans.
- Leaves scopes not selected for a rerun untouched.
- Classifies new/changed/unchanged/conflicting/missing/unavailable evidence without mutating the baseline.
- Preserves changes in provenance even when content hashes are identical.
- Flags affected derived records for review and surfaces manual-edit conflicts.
- Treats incomplete/cancelled/inaccessible scans as uncertainty, not source deletion.
- Carries the baseline version for a future transactional compare-and-swap boundary.

This module does not fetch sources, execute code, invoke AI, write records, authenticate users or provide durable idempotency. Project authorization and server-owned identity resolution remain mandatory at its future API boundary. It is not yet integrated into a UI or a persisted workflow. Existing client data is untouched.

## Next implementation boundaries

1. Add persisted project-scoped wizard sessions, source selections, immutable scan attempts and approved baseline versions. Enforce Editor+ writes and membership-scoped reads. Use transactionally checked versions and request receipts for concurrent edits/retries. Never accept a caller-supplied authoritative baseline or client-created connection identity.
2. Implement a usable document/fixture vertical slice through a short re-entrant wizard before enabling provider discovery. Preview/review/commit are separate states; retries must not duplicate approved output. Include rendered desktop/mobile and keyboard checks.
3. Add server-side source connection adapters with encrypted scoped credentials and honest capability states; implement GitHub/GitLab first without hard-coding the domain model to Git. No client source is fetched until processing permission and selected scopes are confirmed.
4. Add bounded jobs, cancellation, network/SSRF protections, source filtering, cost approval, cross-source reconciliation and evidence-based assessments. Recompute affected outputs only; preserve edits and approval history.
5. Extend real adapters and complete outstanding work from `assistive-ux-20260928.md` without claiming all providers are operational from interface availability.

## Increment 2: saved draft API

Added `projectPopulation.draft` and `projectPopulation.saveDraft` with a strict shared preference schema. An additive migration stores one versioned draft per project plus durable request receipts. Saving does not update the project's approved quality profile, evidence baseline, or generated records. Provider choices are preferences, not authenticated connections; credentials are not accepted in the draft schema.

Reads require project membership; writes require Editor+ and a full seat; suspension blocks both. Saves serialize on the existing parent project row, including first-save races. Expected-version checks reject stale edits. Request hashes and actor binding prevent reusing a save ID for different input; exact retries acknowledge the original version even after subsequent writes without overwriting those later writes. UI callers must refetch after acknowledgment because the acknowledged version can be historical.

Validation: the fresh local database applied all migrations and seeded successfully. The API suite passed 348 tests across 62 files before two additional authorization/first-save cases were added; the expanded focused suite then passed all 8 cases. Core 68 tests, focused lint and all 7 root typecheck tasks passed. Evidence: ignored `.local/ux-validation/vaettir_ux_test_1790664204739/`. No production migration/deployment or customer-data changes in this increment.

Still next: actual re-entrant wizard UI, persisted scan/evidence review and commit, authenticated provider adapters, generation/cost approval, and assessment. The saved-draft API is not a full wizard or an approved-evidence baseline. James has now authorized validated overnight deployments before September 29 07:00 Pacific, superseding the earlier source-only deployment restriction; client-source processing and other authority boundaries remain unchanged.

## Evidence and release boundary

Initial core suite: 68 tests passed (21 new reconciliation cases); core TypeScript build passed. Tests use synthetic evidence only. Full-root checks and checkpoint revision are recorded in Linear and the local handoff. No deployment, production migration, external source scan, paid AI call or customer-record write is authorized by this source-only overnight run.

Execution tracking: SSE-135 / P9-00, with related reverse-engineering, strategy and foundation work remaining in their existing tickets. No duplicate tickets or customer-facing completion claim.
