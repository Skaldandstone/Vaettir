# Private-beta onboarding and support

Public in-product copy: /beta-guide. Owner: James.

## Staff preparation

1. Complete the first-team gates in the readiness register and record the release SHA.
2. Staff open /admin/beta, reserve the approved owner's verified email, and record a reason. Three active reservations maximum.
3. James sends the owner the sign-up/onboarding URL through the approved private channel. The enrollment action itself sends no email.
4. The owner signs in with the enrolled verified primary email, creates the organization and the first project, then invites teammates from Members.
5. The existing invitation links must be delivered privately by the owner. They expire in seven days and reserve capacity. Revoke unused pending invitations before replacing them.
6. For CI, mint the minimum-role service token needed, save its one-time secret in the CI secret store, and record its owner. Service accounts currently occupy a full seat.

## First useful workflow

Use synthetic, non-regulated sample code without tokens or customer data. Import a small test file or a deterministic Gherkin scenario, review the resulting cases, ingest a sample CI report, and check release readiness. On Android, use the same account and select the same organization/project. Confirm the cases, review decision and release summary agree with web.

A read-only tester should see useful data but no working mutation controls. A full editor can review AI cases; compliance sign-off requires a full-seat Owner, Admin or Compliance Auditor.

## Data and credits

AI features send the supplied code, relevant test/requirement text, failure details and contextual hints to Anthropic. Do not upload secrets, credentials, regulated personal data or production customer datasets. Human review is required. Shared catalog definitions are staff-managed and must contain only non-private reference content.

Each organization receives 500 credits per UTC calendar month, with no rollover or automatic overage charge. The allowance is not a guarantee of a particular model-provider dollar ceiling. Failed attempts may already have consumed model capacity; do not repeatedly retry an uncertain paid operation. Ask support to review the ledger and make an audited adjustment when appropriate.

The initial companion does not keep persistent offline case data. A network or authorization failure clears/withholds the view and offers recovery. Sign out before lending a device. Previously issued artifact URLs can remain usable until their short expiry; do not share them.

## Support route

Contact James through the same private channel used for your invitation. James routes defects to engineering. Include platform, app version/build, time/timezone, a short reproduction and whether the issue blocks work. Include the visible error identifier when available. Do not send tokens, raw code, case text or uncropped screenshots containing personal data.

Critical: suspected cross-team exposure, credentials exposure, data loss or unauthorized mutation. Stop using the affected feature and contact James immediately. High: sign-in, import, review, release or sign-off unusable with no workaround. James owns cohort communication and the go/no-go.

No 24/7 response-time promise is made for this free beta. Data export/deletion requests go through James for identity verification and auditable handling.
