# Private-beta welcome email

Vaettir's owner invitation uses Clerk's `email/invitation` template. Clerk remains the delivery provider so an invitation produces one message, preserves Clerk's expiring ticket, and does not require a second email service.

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

Before updating Clerk, the command saves the current production template under `.local/clerk-template-backups/`. Clerk delivery stays enabled, the sender local-part becomes `welcome`, and replies route to `james` on the configured Clerk email domain.

## Acceptance evidence

Source validation and a browser preview do not prove inbox delivery. Before inviting an external team, send one invitation to an approved internal test identity and verify the received message in desktop and mobile clients, including the sender, reply-to, subject, CTA ticket, OAuth sign-up, expiration copy, spam placement, and plain-text/multipart behavior. Then reserve the beta enrollment before inviting the external owner.
