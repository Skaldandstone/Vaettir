# Private-beta onboarding and support

Public in-product copy: /beta-guide. Owner: James.

Release status: HOLD until the [readiness register](readiness-register.md) gates are demonstrated. The [browser lane evidence](browser-lane-evidence.md) separates implemented flows from authenticated and visual acceptance. This guide is not authorization to invite a team early.

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

### Owner and teammate walkthrough

1. Sign in using the verified primary email reserved by James or named on the invitation. If the invitation names another email, sign out from the account menu, sign in with the invited account, and reopen the same link.
2. An enrolled owner starts at /onboarding, names the organization, then creates its first project on /projects. An invited teammate accepts /invite/<token> and joins that existing organization. Do not create a replacement organization for an expired invitation; ask the owner to revoke it and issue a replacement.
3. Choose the organization on Projects when more than one is available, then open the named project. The project sidebar selector switches between that organization's projects. Confirm the project name before importing or reviewing anything.
4. In Test Cases, use Full editor to create a synthetic Given/When/Then case, or use Reverse Engineer for an approved sample file. AI drafts need a human decision in the Review queue. Deterministic Gherkin/CSV imports do not establish live-AI acceptance.
5. Open Test Runs and link the synthetic CI report's unmatched results to the intended cases. Open Release Readiness, check criteria and risk flags, and confirm a blocked release cannot be marked ready under hard-block policy. Do not override policy just to complete onboarding.
6. In Compliance, select the framework/control and record evidence against a mapped case. An editor can map/record evidence but cannot sign off; a full-seat auditor can sign off without project-edit authority. Record only an attestation you can substantiate.
7. Verify Members shows five full and two read-only seats, pending reservations and no self-service beta upgrade. Settings should show the 500/month allowance and ledger activity; the remaining balance can be lower after approved AI use. Service-account tokens consume a full seat.
8. Repeat project selection, case review/read-only access, release status and authorized sign-off on Android using the same team/project. Save private browser screenshots and a physical-device recording against the same release SHA. Android and iOS device acceptance remain separate gates.

### Recovery paths

- No access or empty projects: verify the invited account and selected organization; ask the owner to add a project or check membership. Public organization creation is disabled during beta.
- Expired/revoked invitation: ask an administrator for a replacement. An already accepted link should lead back to Projects.
- Session/network failure: sign in again or restore the connection, then use Try again for reads. Do not rely on stale displayed data as proof of continuing access.
- Import validation failure: keep the source, correct the reported JSON/CSV/field issue and submit once. Never put secrets into error reports.
- No AI credits or unavailable AI: retain the source and read the error. Check Settings and contact James if accounting or outcome is uncertain. A new attempt may consume credits; do not repeatedly submit an operation whose result is unknown.
- CI identifier ambiguity: correct the duplicate mapping within the project and resubmit only after confirming the failed report created no partial run. The permissions lane must provide server-side atomicity evidence; browser failure presentation alone is insufficient.

## Data and credits

AI features send the supplied code, relevant test/requirement text, failure details and contextual hints to Anthropic. Do not upload secrets, credentials, regulated personal data or production customer datasets. Human review is required. Shared catalog definitions are staff-managed and must contain only non-private reference content.

Each organization receives 500 credits per UTC calendar month, with no rollover or automatic overage charge. The allowance is not a guarantee of a particular model-provider dollar ceiling. Failed attempts may already have consumed model capacity; do not repeatedly retry an uncertain paid operation. Ask support to review the ledger and make an audited adjustment when appropriate.

The initial companion does not keep persistent offline case data. A network or authorization failure clears/withholds the view and offers recovery. Sign out before lending a device. Previously issued artifact URLs can remain usable until their short expiry; do not share them.

## Support route

Contact James through the same private channel used for your invitation. James routes defects to engineering. Include platform, app version/build, time/timezone, a short reproduction and whether the issue blocks work. Include the visible error identifier when available. Do not send tokens, raw code, case text or uncropped screenshots containing personal data.

Critical: suspected cross-team exposure, credentials exposure, data loss or unauthorized mutation. Stop using the affected feature and contact James immediately. High: sign-in, import, review, release or sign-off unusable with no workaround. James owns cohort communication and the go/no-go.

No 24/7 response-time promise is made for this free beta. Data export/deletion requests go through James for identity verification and auditable handling.
