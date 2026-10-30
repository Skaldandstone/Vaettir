# Compliance coverage expansion

Status: frontend/catalog implementation prepared on `codex/compliance-coverage-20261030`, based on `4d385c52efe37945d7d246f9c4e1d08cd92e265c`. This is separate from the privacy/edge release. It is not deployed and does not complete the automated compliance workflow.

## Implemented frontend scope

Project creation previously offered five named frameworks. Creation and the standalone starter picker now share a searchable catalog of all twelve bundled starters and the SOC 2 reference. Search includes name, topic, version and aliases; category filtering never deselects hidden choices. Existing project preference labels remain compatible. Selection during creation continues to save planning context only.

Saved frameworks use the same picker component while retaining their exact database identity, wording and version. Duplicate names are not collapsed. The catalog is public reference material; it contains no tenant licenses or private agreement terms. SOC 2 is discoverable but has no bundled starter controls and cannot be loaded through the starter action.

The music and performance rights starter contains eight original review prompts covering inventory, separate composition/recording permissions, audiovisual use, public performance/transmission, reproduction/distribution, license conditions, credits/reporting and release changes. The starter is labeled as US review prompts dated October 30, 2026. Applicability depends on actual use, jurisdiction and agreement. Evidence review and software checks do not grant rights, establish legal clearance or replace the responsible reviewer.

Reference sources checked for this addition:

- [US Copyright Office: Musicians](https://www.copyright.gov/engage/musicians/) distinguishes compositions from sound recordings and explains permission and other legal bases for using existing work.
- [BMI: Types of copyrights](https://www.bmi.com/licensing/types_of_copyrights) distinguishes performance, mechanical, synchronization and recording rights.

The existing manual mapping picker now ranks the loaded candidates by shared title terms and explains those terms. It makes no automatic selection or mapping. The interface discloses that only titles were compared and that the legacy API returns at most 200 candidates. A title match is not semantic coverage or a passed execution. A failed or refreshing candidate query disables mapping.

Exact curated control wording has an expandable, unsaved check outline with prerequisites, action, expected-result guidance and evidence. Changed descriptions or titles do not receive a generated outline. These outlines are starting material; they have not been compared with all existing case steps and are not missing-test determinations.

## Required backend and workflow follow-up

The full authorized feature remains open. Backend writer ownership is held by the release operator. No API, schema, migration, shared script, dependency, fixture, provider or deployment changes are part of this frontend slice.

- Unify public references and tenant-owned custom framework/control definitions in a versioned server catalog. Preserve existing identities and evidence; do not infer ownership of legacy global custom rows from names, creators or activity. Existing global create/import paths are not made tenant-safe by this frontend change and must be reconciled before the new workflow ships.
- Add complete, bounded candidate traversal, including steps, expected results and relevant approved metadata. Return the scanned scope and omissions. Explain each proposed relationship and distinguish existing coverage, uncertain relevance and a missing-check proposal.
- Build a project-context preview from selected frameworks during creation and later compliance review. Retain a durable review draft so work can continue without repeating analysis. No paid model calls are required or authorized by this slice.
- Let a reviewer select mappings and edit proposed new cases in one review. Preserve normal case approval as a separate action. Proposals must never imply legal applicability, license clearance, execution success or compliance sign-off.
- Apply a reviewed selection once using an idempotency key, transaction and audit provenance. Revalidate the current actor, workspace, project access, framework/control versions, case source versions and reviewed proposal digest at apply time. Revocation, reduced access and change-and-restore must invalidate stale authority. Reconcile ambiguous results before retrying.
- Prove isolation, permission loss, concurrent edits, stale previews, double-submit/retry and cross-workspace rejection. Verify both creation and standalone flows with authenticated hosted acceptance after integration.

## Validation boundary

The pure catalog/guidance/proposal tests and the isolated real React picker browser harness exercise this frontend slice only. The browser harness uses synthetic data, application CSS, keyboard and touch input, and light/dark layouts at desktop and 390px widths. It makes no authenticated customer or provider requests and does not run the API or a database.

Local results: 10 pure tests passed across the three compliance test files; the direct browser harness passed all four theme/width combinations without browser errors or external requests. Scoped TypeScript checking of the catalog, guidance, proposal helpers, shared components and their tests passed with zero diagnostics. Synthetic screenshots are retained only in ignored local evidence.

Full web type checking currently encounters missing generated Prisma privacy fields in the unchanged Atlassian API service. Prisma generation is reserved to the release operator; that check is not recorded as passed. Hosted acceptance, full-page review/apply acceptance and the backend guarantees above remain pending.
