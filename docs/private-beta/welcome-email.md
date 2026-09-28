# Private-beta welcome email

Vaettir's owner invitation uses Clerk's `email/invitation` template. Clerk remains the ticket and template authority. Production delivery can stay with Clerk or be moved, for this template only, through Vaettir's signed `email.created` webhook to Amazon SES.

## Source of truth

- `apps/api/src/email-templates/private-beta-invitation.html` is the delivered HTML body.
- `apps/api/src/email-templates/private-beta-invitation.subject.txt` is the subject.
- `apps/api/src/email-templates/private-beta-invitation.txt` is the approved plain-text companion and copy fallback. Clerk's current template API accepts the HTML body; delivery-client multipart behavior must be verified from a received message before claiming the text file is delivered.
- `scripts/clerk-invitation-template.mjs` validates, previews, inspects, and synchronizes the template.

The copy states the actual private-beta limits, the shared-infrastructure tenant boundary, the data restrictions, and the AI-provider disclosure. It does not claim a dedicated cloud instance.

## Validate and preview

```powershell
pnpm test:invitation-email
pnpm email:invitation:check
pnpm email:invitation:preview
```

The preview is written to `.local/email-previews/private-beta-invitation.html`. It uses a nonfunctional sample ticket and is intentionally excluded from Git.

## Inspect production without changing it

Set `CLERK_SECRET_KEY` in the current process without printing it, then run:

```powershell
pnpm email:invitation:inspect
```

The command prints only template hashes, delivery state, and whether production matches source.

## Synchronize production

This is a Clerk configuration write. Confirm the target instance and authorization before running it. If the key exposes explicit Backend API scopes, set `CLERK_BAPI_SCOPES`. A legacy administrative secret requires an explicit `--admin` override.

```powershell
pnpm email:invitation:sync -- --apply --admin
```

Before updating Clerk, the command saves the current production template under `.local/clerk-template-backups/`. Template synchronization does not toggle delivery. The sender local-part is `welcome`, and replies route to `james` on the configured Clerk email domain.

## Self-managed invitation delivery

The API exposes `/api/webhooks/clerk/email`. It verifies Clerk's signature before parsing the event and accepts only `email.created`. The delivery service has additional boundaries:

- Events with `delivered_by_clerk=true` are acknowledged without sending, preventing duplicate mail before cutover.
- Only the `invitation` template is supported. Authentication and verification messages remain Clerk-delivered.
- A unique Clerk email ID and Svix webhook ID provide retry deduplication.
- The database stores a one-way recipient hash and recipient domain, never the address, HTML, text, or invitation ticket.
- A failed SES call can be retried by Svix. A stale `SENDING` record becomes `UNKNOWN` and is not automatically resent because SES does not expose an idempotency key for `SendEmail`; an operator must reconcile that outcome against provider evidence.

Runtime configuration:

```text
CLERK_WEBHOOK_SIGNING_SECRET=<Secrets Manager reference>
SES_TRANSACTIONAL_EMAIL_ENABLED=true
TRANSACTIONAL_EMAIL_FROM=welcome@skaldandstone.com
TRANSACTIONAL_EMAIL_REPLY_TO=james@skaldandstone.com
SES_CONFIGURATION_SET=vaettir-transactional
```

Cutover order matters:

1. Apply the database migration and deploy the API with the signed webhook configured, but keep `SES_TRANSACTIONAL_EMAIL_ENABLED=false`.
2. Create the Clerk webhook endpoint for `email.created` and prove a signed example is accepted while Clerk still delivers the message.
3. Create and validate the SES configuration set, task-role permission, reputation metrics, account suppression, and a received internal test.
4. Set `SES_TRANSACTIONAL_EMAIL_ENABLED=true` and deploy.
5. Disable Clerk delivery for the invitation template only.
6. Send one controlled invitation and prove there is exactly one delivery record and one received message.

If any gate fails, re-enable Clerk delivery before disabling SES. Never leave both delivery paths active for the same template. Do not automatically resend `UNKNOWN` outcomes.

## Acceptance evidence

Source validation and a browser preview do not prove inbox delivery. The first internal Clerk-managed test passed SPF, DKIM, and DMARC but initially landed in Gmail spam. Before claiming self-managed acceptance, test Workspace Gmail, personal Gmail, and Outlook; inspect provider delivery evidence and received authentication headers; and confirm the CTA/OAuth ticket. Maintain one stable branded sender backed by a real monitored mailbox and review Clerk/SES delivery logs, DMARC reports, and Google Postmaster data.
