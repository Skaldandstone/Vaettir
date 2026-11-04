# Managed database credential refresh

The API polls the configured managed secret every 60 seconds. When its composed
URL changes, it creates a separate `ConstraintCheckedPrismaClient` with that
explicit URL, connects it, and runs `SELECT 1`. Only a successful probe publishes
the replacement. Existing route, context and worker references keep the same
facade and select the published pool for new work.

Plain `/health` and `/api/health` remain process-liveness checks, including during
rotation. They do not certify database availability. `/health/detailed` reports
the database probe, pending/failed credential refresh and pool cleanup status.
`credentials.rotated` means a detected change is still awaiting adoption; it
clears after successful refresh. No credential values or driver error details
are included in these statuses or refresh notifications.

## Query and transaction ownership

- Lazy model and raw SQL queries select a generation on first consumption, even
  if a caller saved a delegate or constructed the query before rotation.
- Interactive transactions keep their original native transaction client until
  settlement. Array transactions materialize all queries on one generation and
  retain native PrismaPromises, ordering and options. The existing UTC and
  deferred-constraint checks remain in `ConstraintCheckedPrismaClient`.
- Old pools disconnect only after all work using them settles. Failed queries
  and transactions propagate their original errors and are never replayed.
- Repeated awaits reuse the same outcome. Array transactions reject foreign,
  duplicate or already-consumed facade queries before execution. Fluent relation
  queries are supported. Runtime `$use`, `$on`, `$extends` and private engine
  access through the facade are deliberately unsupported; the API does not use
  these hooks. Ordinary clients without managed-secret configuration retain the
  native Prisma surface.

## Failure bounds

Replacement connection/query preparation has a 20-second observation deadline.
A timeout does not imply the native operation was cancelled. Its candidate stays
private, cannot be adopted later, and is disconnected after the probe settles.
The single-flight guard remains held until cleanup finishes, preventing more
candidate pools from accumulating if the native engine stalls.

At most two retired generations can await draining; another refresh is refused
until one finishes. A disconnect failure marks `pool.cleanupFailed` and prevents
further replacement creation. Existing work is never force-disconnected to meet
this bound. The serving pool remains selected after preparation failure, and the
next monitor tick may retry preparation once cleanup permits it. A secret-read
failure does not evict the task.

This removes the deliberate zero-target health handoff. It does **not** guarantee
that old credentials can open new database connections while the secret is
being fetched, that revoked sessions survive, or that a database outage produces
no request errors. There is up to one polling interval before detection. Detailed
health must be monitored; plain HTTP 200 alone is insufficient acceptance.

## Release validation (operator owned)

The source tests use synthetic pools and real generated Prisma 5.22 promises
with middleware short-circuiting all database requests. They establish source
behavior, not native connection, PostgreSQL, ECS or hosted acceptance.

Build the database package and API from the reviewed revision containing this
change and PR113; the previous API72 image does not contain this refresh code.
Before rollout, validate the exact image against an isolated disposable database
with synthetic credentials: hold a transaction across a credential change,
confirm fresh connections use the new credentials, confirm old work settles
without replay and old pools drain, and repeat with unavailable/invalid secrets
and failed replacement probes. Do not rotate the live production secret as a
test. Bind image/source identity, schema111-compatible rollback and hosted PR113
evidence upload/viewing results separately. No schema, migration, dependency or
infrastructure change is included in this source patch.

Prisma's lazy-query and transaction contract is documented in the
[client reference](https://docs.prisma.io/docs/orm/v6/reference/prisma-client-reference)
and [transaction reference](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions).
The package remains pinned to its existing installed 5.22 runtime; these links
do not establish compatibility for another Prisma major version.
