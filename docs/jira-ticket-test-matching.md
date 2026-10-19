# Jira ticket verification and suggested tests

## Intended workflow

The native Jira issue context is a collapsible **Verification tests** panel. Each
confirmed link shows the Vaettir test ID as a link and its summary separately.
Execution details are expandable. A recorded pass does not prove that the current
ticket or current test definition has been verified.

Within a connected and explicitly approved Vaettir project:

1. Read the current ticket summary, description and labels using the current
   viewer's Jira permissions and signed issue identity.
2. Search the project's tests automatically. Exact normalized label overlap
   prioritizes candidates, but neither proves relevance nor excludes unlabeled
   tests. Do not search other projects or workspaces.
3. Review actual functionality against complete case procedures, assertions and
   context. Show relevant candidates separately from confirmed links, with a
   reason and evidence. Keep uncertain candidates marked **For review**.
4. A completed review with no suitable tests shows **Create test case**. This
   action reads the ticket functionality and proposes editable drafts using
   preconditions, actions and expected results, without requiring Gherkin.
   Missing functionality requests clarification rather than inventing behavior.
5. Only an authorized Vaettir editor can confirm a link or create reviewed
   drafts. Jira read access alone is not Vaettir write authority.

## Source checkpoint, 2026-10-19

Implemented locally:

- Compact native linked-test rows, with separate ID links and summaries.
- Signed-issue context reader and ADF text extraction, flagging unread media or
  unsupported nodes instead of treating their contents as reviewed.
- Label-prioritized, complete-inventory batching and fingerprints that change
  when ticket functionality, case definitions, labels or project change.
- Semantic provider adapter with evidence-grounded required, related, unrelated
  and uncertain decisions. Matching and draft generation are separate modes.
- Strict output validation and completion reducer. Failed/missing batches,
  unread inputs, low confidence and uncertain decisions cannot become a false
  "no suitable tests" result. Stale results and duplicate batches are rejected.

These matching services are **not wired to public routes or the native UI**.
There is no automatic discovery job, link-confirmation flow or draft-creation
button yet. No provider calls, credit debits or customer writes were performed.
Unit/SSR tests validate contracts and rendering, not model accuracy or hosted
Jira behavior. This is an incomplete implementation, not a releasable feature.

## Remaining release gates

- Decide funding for matching and draft generation: platform-funded or explicitly
  approved purchased AI credits. Free import-type recommendations are a different
  product policy and do not settle this choice.
- Add a distinct project-admin discovery opt-in, default off. Existing
  `shareTicketTests` approval covers explicitly linked tests; it must not silently
  become permission to inspect and disclose the whole test inventory.
- Build authorized background orchestration, progress, cancellation, scoped
  caching and retry behavior. Recheck current viewer access, sharing approval and
  scope before work, between batches and before returning results. Keep model
  calls outside database transactions and do not automatically retry unknown
  spend outcomes.
- Add the native proposed-match and empty-result views, plus an authenticated
  Vaettir review handoff for link confirmation and draft creation. Preserve
  idempotency, audit, project isolation and access revocation.
- Test misleading same-label cases, unlabeled relevant cases, partial coverage,
  missing descriptions, changed definitions and revoked approval end to end.
  Run actual semantic evaluation only after funding authorization.
- Run current-source CI and coordinated deployment. Verify on the company
  synthetic Jira project only; do not import or mutate customer cases.

Vaettir owns matching, evidence and authorization. Jira displays the approved
projection. No browser extension is required by this product workflow.
