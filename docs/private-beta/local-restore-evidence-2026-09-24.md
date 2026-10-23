# Local database restore evidence - 2026-09-24

This record proves Vaettir's logical dump/restore mechanics against an isolated
PostgreSQL 16 container. It did not read RDS, create paid infrastructure, use
production credentials, restore customer data, change AWS, or deploy code.

## Candidate and method

- Candidate branch before commit: `codex/overnight-readiness-20260921` at
  `d730569b12b0c55e3b4acfa97a5c2d003828346a`.
- Source: `vaettir_beta_restore_source_test` on disposable PostgreSQL 16.
- Target: `vaettir_beta_restore_target_test` on the same disposable server.
- The source received all 56 migrations and the reference-data seed.
- PostgreSQL 16 client tools ran inside the disposable container. An initial
  PostgreSQL 17-client attempt correctly failed because its archive emitted
  `transaction_timeout`, which PostgreSQL 16 does not recognize. The final
  procedure now supports a same-major Docker client explicitly and documents
  why client/server major compatibility matters.
- The drill created a custom-format dump, recreated only the validated target,
  restored it, and compared every public table's row count plus the exact set
  of completed Prisma migrations.
- The target database, temporary dump, and disposable container were removed.

## Executable result

```json
{
  "status": "passed",
  "sourceDatabase": "vaettir_beta_restore_source_test",
  "targetDatabase": "vaettir_beta_restore_target_test",
  "migrationCount": 56,
  "tableCount": 55,
  "rowCount": 76,
  "dumpSha256": "f8504e494876befd582be2b063249e4da774755eab50feb0ea9a8830761e28f6",
  "elapsedMs": 39240,
  "targetRemoved": true
}
```

The fail-closed contract suite passed 4/4. It rejects remote hosts,
production-like/shared names, mismatched connection scopes, unsupported URL
options, missing migration history, empty schemas, and source/target evidence
drift.

## Acceptance boundary

This closes only local logical-restore mechanics. It does not prove:

- an RDS snapshot or point-in-time restore;
- the current seven-day recovery window contains usable production data;
- restored-instance networking, security groups, or Secrets Manager cutover;
- production application health against a restored RDS instance;
- the private-beta restore objective of under four hours.

Those gates still require James's approval for a temporary paid RDS restore
target, followed by timed provider evidence and cleanup.
