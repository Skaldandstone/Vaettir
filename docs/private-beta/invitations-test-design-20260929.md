# Workspace invitation delivery and test design reviews

## Implemented slice

- Workspace invitations previously created only a local token. They now call the existing SES transport after committing the invitation, with durable delivery state and a single-send claim. Admins can explicitly send previously unsent pending invitations. Migration and deployment do not send existing invitations.
- The UI distinguishes unsent invitations, provider acceptance and uncertain delivery. Provider acceptance is not inbox-delivery proof. An ambiguous send or process interruption requires operator reconciliation, not an automatic resend.
- Test cases now offer a three-screen modal: evidence, cost/permission approval, and saved recommendations. The review recommends a test level, framework when supported, concrete step/assertion improvements, retained higher-level coverage, and missing evidence.
- Code excerpts require explicit processing approval and source/revision labels. No repository is fetched automatically. User-provided source identities are not independently verified; text-only reviews are provisional. Native connected-source discovery remains outstanding.
- Reviews retain their input identity and paid results; identical retries reuse the result. Concurrent requests do not charge twice. Manual changes make prior reviews stale. Charged failures retain a reconciliation record. Recommendations can prefill draft setup, but never silently alter the case or replace a paid draft.

## Evidence

- API suite: 386 tests passed on a fresh disposable local database; both additive migrations applied. Additional invitation-router authorization regression added afterward for the next validation run.
- Root typecheck: 7 tasks passed. Web contracts: 41 passed. AI design-review unit tests: 2 passed. Focused lint: no errors (two existing apostrophe warnings in the members page).
- Rendered synthetic modal: evidence navigation, credit/balance preview, saved-result reuse, recommendation and retained-coverage presentation checked. Synthetic responses are not live AI/provider acceptance.
- Read-only production mail configuration: SES enabled, production access enabled, enforcement healthy; production sender and web origin configured. No customer emails sent during validation.
- Daily Sentry triage/repair heartbeat created for 9 a.m. Pacific. Live error checks blocked by absent SENTRY_AUTH_TOKEN in process, user environment and local .env. Owner must configure a read-only Sentry token locally; never paste it into chat. No claim of zero Sentry errors.

## Remaining boundaries

Repository discovery, automatic code selection, applying reviewed case edits, bulk design reviews, and an admin credit-request workflow are not included in this slice. Actual mail receipt and live paid-model output remain untested. Deployment evidence is recorded separately once rollout completes.
