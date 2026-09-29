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

Initial core suite: 68 tests passed (21 new reconciliation cases); core TypeScript build passed. Tests use synthetic evidence only. Full-root checks and checkpoint revision are recorded in Linear and the local handoff. Validated deployment through existing AWS resources is now authorized before 07:00 Pacific; client source processing, paid AI and unrelated customer writes are not.

## Increment 3: draft wizard UI

The project overview now links to `/projects/[projectId]/populate`. Four compact steps select sections, describe objectives/system type, select source preferences and review. Partial reruns skip unselected context/source steps. Progress is saved through the versioned draft API; a later visit resumes the saved step. Uncertain saves lock editing and reuse the original request ID until confirmed. Newer drafts receive explicit comparison and user-directed reconciliation rather than background replacement.

This is a setup-preference workflow, not finished source intake. Provider-logo assets, authentication, scope selection, evidence review/approval, generation and assessment remain to be connected. Source preferences explicitly do not claim live connectivity. Existing approved records remain untouched.

Validation: web contracts 35/35, web typecheck and focused ESLint passed. Synthetic browser rendering verified scope, objective entry, source choice, review and save callback. Preview bundle initially failed because its ignored harness resolved React from the repository root; setting the installed web dependency search path fixed it. This was a harness issue, not a disabled check. Production API integration, mobile sizing and authenticated full-flow acceptance remain separate checks before release.

Execution tracking: SSE-135 / P9-00, with related reverse-engineering, strategy and foundation work remaining in their existing tickets. No duplicate tickets or customer-facing completion claim.

## Increment 4: reviewed document evidence

`populationDocuments` now persists bounded plain-text/Markdown previews separately from approved evidence. The user confirms processing permission before preview storage, then explicitly approves new or changed text. Project-local stable document keys let identical reruns remain unchanged without incrementing evidence versions. Changed previews use expected-version checks; a stale approval cannot overwrite another approved revision. Durable receipts acknowledge retries without reapplying old content. Preview input, actor and approval/cancellation timestamps preserve run provenance.

The focused `/populate/documents` page is linked from setup, not crowded into a wizard step. It supports paste, comparison, approval, pending-review resume and cancellation. Input is limited to 50,000 characters, 100 pending previews per project, and ten recent actor-owned pending previews per response. Approved evidence listing is capped at 200; pagination and file upload remain follow-ups. Content is displayed as text, never executed, link-followed or sent to AI. Membership, editor/full-seat and suspension checks reuse the project authorization boundary.

This establishes **documented intent only**, not implemented or deployed behavior. It does not yet extract requirements, reconcile generated records, calculate readiness or connect providers. No existing tests/requirements are mutated. Retention policy and fuller pagination require follow-up. A synthetic browser preview exercised consent and new-document comparison; database tests separately exercise approval, identical reruns, changed evidence, stale approval, retry receipts, cross-tenant denial, permission/size guards, pending resume visibility and cancellation. Production and mobile end-to-end acceptance remain separate.

## Increment 5: cited requirement suggestions

Approved documents can now supply a bounded literal first pass of explicit must/shall/required-to statements. Each suggestion carries an exact line/quote, stable normalized-text key and approved document version. This is not AI inference, semantic duplicate detection or exhaustive extraction; code fences are excluded and output is capped at 100. The focused review page lets users edit a proposed title and approve one suggestion at a time, with no AI charge.

Approval transactionally rechecks source version, reuses normalized exact-title matches and stores a durable source-to-requirement link. Concurrent identical approvals in this flow create at most one requirement. Retries preserve human edits; removed requirements are not recreated. Statements absent from a later approved document are flagged for source review without deleting or rewriting previous requirements. No test cases or strategy records are generated or overwritten. Concurrent unrelated legacy requirement-creation paths and semantically equivalent wording are not globally deduplicated.

An initial full-suite failure exposed shared test-fixture contamination: the new test left approved evidence in the older document test's supposedly empty project. The new test now creates its own project, preserving the original empty-baseline assertions. Failure evidence remains in `.local/ux-validation/vaettir_ux_test_1790669612491/`. Synthetic rendered checks exercised document selection, editable title and stale-source warning; authenticated production acceptance remains pending.

## Increment 6: initial project evidence snapshot

A read-only, project-authorized repeatable-read snapshot now distinguishes recorded intent, approved planning, test design and execution evidence with separate visual tiles. Prioritized actions point to missing work or the latest failing run; run deep links open the existing run drawer. Release phases are explicitly labelled recorded statuses, not inferred deployment. Old (30-day operational threshold) and future-dated execution evidence prompt review. Counts and passing runs never produce a readiness percentage or imply coverage.

This is a project-level evidence inventory and navigation aid, not the full component/release inference engine. It does not establish deployed revision, semantic coverage or recommendation confidence; it does not persist a historical assessment or populate every target form. These remain explicit follow-ups alongside provider adapters. Synthetic rendering verified the four activity tiles and failure-prioritized actions. AWS CLI access was verified for the existing release account before build preparation, with no identity changes.

## Increment 7: local document-file intake

The evidence form now accepts a local UTF-8 Markdown, text or README file as an alternative to pasting. Decoding happens in the browser, bounded to 200 KB and 50,000 characters. Unsupported extensions, invalid UTF-8, binary/control characters, empty files and changed sizes are rejected. Contents remain inert text, never executed or followed as links. A local preview and explicit Use file contents action precede replacement of unsaved draft text; previously approved evidence is untouched. Permission confirmation resets when text changes and is still required before the existing server preview/approval workflow.

Web contracts now pass 39 tests; typecheck and focused lint pass. The control-character regex initially triggered ESLint's no-control-regex rule, so the implementation now checks code points without disabling the rule or weakening rejection tests. Synthetic browser inspection confirmed the upload disclosure, file control and review wording. File decoding is unit-tested; native file-picker interaction and end-to-end file upload in production are not yet accepted. PDF, Word, archives, bulk files and provider-repository intake remain unsupported by this route. This increment is separate from the already deployed saved-draft/document baseline.
