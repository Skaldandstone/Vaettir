# Privileged access denial logging evidence - 2026-09-24

Vaettir's privileged procedures already denied unauthorized calls, but the
denials did not produce a consistent security signal. The API now emits one
bounded structured warning for denied access at these boundaries:

- staff access granted through the exact Clerk-email allowlist;
- trusted Studio/service access using `X-Staff-Token`; and
- the narrower live-app scanning allowlist.

Each event contains only a fixed event type, fixed surface, fixed denial
reason, and, for the trusted-service path, booleans indicating whether token
and actor headers were present. It never records an email address, user id,
actor header value, authorization header, staff token, request body, project,
organization, or customer content.

## Local evidence

- Six focused tests exercise the structured reporter and the real tRPC
  middleware for staff-email, staff-token, and live-app-scan denials.
- Authorized staff-email and trusted-token calls do not emit denial events.
- API typecheck, lint, and production TypeScript build pass.
- Focused formatting and `git diff --check` pass.

## Acceptance boundary

These tests prove local event construction and middleware invocation. They do
not prove a deployed denial reaches CloudWatch, an alert or retained query is
configured, production log access is restricted, or an operator responds to
the event. Those are deployment and operational-acceptance gates.

No AWS/provider/account mutation, credential use, production data change,
deployment, destructive action, or public release occurred in this slice.
