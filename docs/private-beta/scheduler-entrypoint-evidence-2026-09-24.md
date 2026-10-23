# Scheduler entrypoint resilience evidence - 2026-09-24

Vaettir's four in-process background loops previously launched interval
promises without a shared top-level rejection boundary. Per-item catches did
not cover failures that occurred before iteration, such as the initial
database query rejecting.

The reverse-engineering worker, readiness digest scheduler, readiness-change
scheduler, and monthly AI-credit grant scheduler now use one safe entrypoint
contract:

- a rejected tick is captured with a fixed scheduler tag and does not escape
  as an unhandled promise rejection;
- a later tick can retry after failure; and
- a second tick does not overlap one already in flight in the same process.

The existing per-job/per-organization handling remains in place. Heartbeats
still represent loop attempts, not successful notification delivery or
completed work.

## Local evidence

- Three shared-runner tests pass for rejection capture, retry, and overlap.
- One AI-credit scheduler test proves an outer organization-query rejection is
  captured and the next tick resumes grant processing.
- API typecheck, lint, and production TypeScript build pass.
- Focused formatting and `git diff --check` pass.

## Acceptance boundary

This proves single-process scheduler entrypoint behavior with mocked failures.
It does not prove multi-replica claiming, exactly-once delivery, live database
recovery, Sentry delivery, webhook/push delivery, or successful work from a
heartbeat. Multi-process coordination still requires a database claim, queue,
or outbox design before scaling the API beyond its current single-process
scheduler topology.

No AWS/provider/account mutation, credentials, production data change,
deployment, destructive action, paid call, or public release occurred.
