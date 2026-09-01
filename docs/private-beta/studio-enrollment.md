# Studio alpha enrollment

The Skald and Stone invitation reviewer must reserve Vaettir capacity before it sends a Clerk invitation. This preserves the private alpha's three-team limit and prevents an invited person from reaching sign-in without an available team slot.

## Approval sequence

1. The Studio reviewer claims the pending access request.
2. It calls `beta.enrollFromStudio` with the request email and immutable Studio request ID.
3. Vaettir authenticates the call with `X-Staff-Token`, applies the existing serialized three-team capacity check, and returns the existing enrollment on an exact-email retry.
4. Only after that reservation succeeds does Studio authorize the user or create the Clerk invitation.
5. After the person signs in, Vaettir's existing onboarding flow calls `bootstrapBetaOrganization`, consumes the enrollment, and creates the private-beta organization.

If capacity is full or Vaettir is unavailable, Studio returns the request to pending and sends no Clerk invitation. A later approval retry is safe because both the Vaettir reservation and Clerk invitation stages are idempotent.

If Clerk fails after the Vaettir reservation succeeds, Studio records the reservation receipt and leaves the request pending for retry. Denying that request calls `beta.revokeFromStudio` first. Vaettir only revokes the exact Studio request's unclaimed enrollment, so denial cannot remove another request's reservation or an already-claimed team.

## Production configuration gate

Production activation requires all of the following manual operations:

- Set the same strong `STAFF_ADMIN_TOKEN` value in the Vaettir API and the Studio Worker's `VAETTIR_STAFF_ADMIN_TOKEN` secret binding.
- Confirm Studio points to the deployed Vaettir API origin, not a hostname routed back through the Studio Worker.
- Configure the Vaettir Clerk secret in Studio and confirm the Clerk instance enforces the intended invitation policy.
- Apply the Studio D1 migrations, deploy both services, and complete one controlled end-to-end enrollment with a disposable test address.

Do not put either secret in source control, Wrangler configuration, frontend environment variables, screenshots, or release notes.
