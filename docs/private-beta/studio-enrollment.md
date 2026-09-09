# Studio private-beta enrollment

The Skald and Stone invitation reviewer must reserve Vaettir capacity before it sends a Clerk invitation. This preserves the three-team private-beta limit and prevents an invited owner from reaching sign-in without an available organization slot.

## Approval sequence

1. The Studio reviewer claims the pending access request.
2. It calls `beta.enrollFromStudio` with the request email and immutable Studio request ID.
3. Vaettir authenticates the call with `X-Staff-Token`, applies the serialized three-team capacity check, and binds the enrollment to that request ID.
4. Only after the reservation succeeds does Studio authorize the user or create the Clerk invitation.
5. After the person signs in, Vaettir onboarding calls `organization.bootstrap`, consumes the enrollment, creates the private-beta organization, and records its initial 500-credit monthly grant.

An exact request retry is idempotent. Reusing a request ID for another email, or trying to reserve an email held by another request, fails closed. If capacity is full or Vaettir is unavailable, Studio returns the request to pending and sends no Clerk invitation.

If Clerk fails after reservation, Studio retains the reservation receipt and retries the same request. Denying the request calls `beta.revokeFromStudio` with the enrollment and request IDs. Vaettir locks and verifies that exact unclaimed Studio reservation before revoking it; a claimed team must be suspended through staff support instead.

## Production configuration gate

Production activation still requires manual approval and verification:

- Set the same strong `STAFF_ADMIN_TOKEN` value in the Vaettir API and Studio Worker's `VAETTIR_STAFF_ADMIN_TOKEN` secret binding.
- Confirm Studio points to the deployed Vaettir API origin, not a hostname routed back through Studio.
- Configure the Vaettir Clerk secret in Studio and verify the intended invitation policy.
- Apply the Studio D1 and Vaettir database migrations, deploy both services, and complete one controlled end-to-end enrollment with a disposable test address.

Do not put either secret in source control, Wrangler configuration, frontend environment variables, screenshots, or release notes.
