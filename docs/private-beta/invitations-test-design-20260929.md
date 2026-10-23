# Workspace invitation delivery and test design reviews

## Implemented slice

- Workspace invitations previously created only a local token. They now call the existing SES transport after committing the invitation, with durable delivery state and a single-send claim. Admins can explicitly send previously unsent pending invitations. Migration and deployment do not send existing invitations.
- The UI distinguishes unsent invitations, provider acceptance and uncertain delivery. Provider acceptance is not inbox-delivery proof. An ambiguous send or process interruption requires operator reconciliation, not an automatic resend.
- Test cases now offer a three-screen modal: evidence, cost/permission approval, and saved recommendations. The review recommends a test level, framework when supported, concrete step/assertion improvements, retained higher-level coverage, and missing evidence.
- Code excerpts require explicit processing approval and source/revision labels. No repository is fetched automatically. User-provided source identities are not independently verified; text-only reviews are provisional. Native connected-source discovery remains outstanding.
- Reviews retain their input identity and paid results; identical retries reuse the result. Concurrent requests do not charge twice. Manual changes make prior reviews stale. Charged failures retain a reconciliation record. Recommendations can prefill draft setup, but never silently alter the case or replace a paid draft.

## Evidence

- API suite: 389 tests passed across 69 files on a fresh disposable local database; both additive migrations applied. Includes invitation authorization, ambiguous credit-ledger acknowledgments and oversized-input rejection before charging.
- Root typecheck: 7 tasks passed. Web contracts: 41 passed. AI design-review unit tests: 2 passed. Focused lint: no errors (two existing apostrophe warnings in the members page).
- Rendered synthetic modal: evidence navigation, credit/balance preview, saved-result reuse, recommendation and retained-coverage presentation checked. Synthetic responses are not live AI/provider acceptance.
- Read-only production mail configuration: SES enabled, production access enabled, enforcement healthy; production sender and web origin configured. No customer emails sent during validation.
- Daily Sentry triage/repair heartbeat created for 9 a.m. Pacific. Live error checks blocked by absent SENTRY_AUTH_TOKEN in process, user environment and local .env. Owner must configure a read-only Sentry token locally; never paste it into chat. No claim of zero Sentry errors.

## Remaining boundaries

Repository discovery, automatic code selection, applying reviewed case edits, bulk design reviews, and an admin credit-request workflow are not included in this slice. Actual mail receipt and live paid-model output remain untested.

## Production release evidence

- Verified September 29, 2026 at 18:15 Pacific. API `84b5a429a032e2a73f40e24c2cc8e256890f3911`, task revision 26, digest `sha256:4146fc7836b9b81a119b2aabc5a96ec1c249bc3fb00c92fe8e0f1297784e9aa6`. Web `bd7886c1ac931598368be31769a0e33f00884730`, task revision 20, digest `sha256:06c1209ed0f0720007012d8e8736dadff7314adfa940c764783fa7de3dc8b65e`.
- Both CodeBuild releases succeeded and both ECS acceptance checks returned `ready: true` with no issues. Public API detailed health confirmed the exact commit/digest, database and workers healthy. Previous API25/web19 definitions are preserved locally for recovery.
- Authenticated read-only smoke: test-design modal opens, navigates to the live cost/balance preview, requires unchecked processing/spend consent, disables confirmation without consent, and closes back to the unchanged case page. Pending invitations display “Email not sent.” and an explicit “Send email” action.
- No customer emails, paid model calls, repository processing, invitation revocations or customer-record edits were performed during validation. Existing pending invitations remain unsent until an authorized user explicitly sends them.
- API follow-up preserves reservations on ambiguous ledger failures and caps serialized review input at 64,000 UTF-8 bytes. Definitive insufficient-credit failures may safely release a reservation; ambiguous charged work may not silently retry.
