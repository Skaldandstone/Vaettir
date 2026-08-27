# Database backup & restore runbook

Covers `vaettir-postgres` (RDS PostgreSQL, `us-east-2`, account `094842496450`)
— the single production database backing both `vaettir-api` and everything
under `vaettir.skaldandstone.com`.

## Current state (checked 2026-08-27)

| Setting | Value |
|---|---|
| Automated backup retention | **1 day** |
| Preferred backup window | `03:02–03:32 UTC` |
| Multi-AZ | No (single instance) |
| Engine | PostgreSQL |
| Allocated storage | 20 GB |

Three automated snapshots currently exist (2026-08-25, 2026-08-26,
2026-08-27), despite the 1-day retention setting — likely from before a
retention change; older ones will age out under the current setting going
forward.

**Recommendation, not yet applied**: bump `BackupRetentionPeriod` to 7 days.
1-day retention means a mistake discovered more than a day later (a bad
migration, an accidental bulk delete, a bug that silently corrupts data) has
no automated recovery point left. This is a safe, reversible, no-downtime
RDS setting change (`aws rds modify-db-instance --backup-retention-period 7
--apply-immediately`) — flagged here rather than applied directly, since
changing production infrastructure settings needs your go-ahead even under
a broad "keep building features" authorization; this isn't a code feature.

## How automated backups actually work here

RDS takes a daily snapshot during the backup window, plus continuous
transaction-log backup, giving point-in-time recovery to *any second* within
the retention window (not just the daily snapshot boundaries). At 1-day
retention, that window is barely a day; at 7, it's a full week.

## Restore procedure (point-in-time or from a snapshot)

RDS restore is **always a new instance**, never an in-place rollback of the
existing one — this is intentional (Amazon's own safety mechanism: you can't
accidentally overwrite good data while trying to recover from bad data).

1. **Point-in-time restore** (recover to a specific moment, e.g. "5 minutes
   before the bad migration ran"):
   ```bash
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier vaettir-postgres \
     --target-db-instance-identifier vaettir-postgres-restore-YYYYMMDD \
     --restore-time 2026-08-27T14:30:00Z \
     --profile vaettir-toolkit --region us-east-2
   ```
2. **Restore from a specific snapshot**:
   ```bash
   aws rds restore-db-instance-from-db-snapshot \
     --db-instance-identifier vaettir-postgres-restore-YYYYMMDD \
     --db-snapshot-identifier rds:vaettir-postgres-2026-08-27-03-16 \
     --profile vaettir-toolkit --region us-east-2
   ```
3. Wait for the new instance to become `available`
   (`aws rds describe-db-instances --db-instance-identifier
   vaettir-postgres-restore-YYYYMMDD`).
4. **Verify before cutting over**: connect to the restored instance
   directly (it gets its own endpoint) and spot-check the data actually
   looks right for the target restore point — do not point production
   traffic at an unverified restore.
5. **Cut over**: update the `vaettir/database-url` secret in Secrets
   Manager to point at the restored instance's endpoint, then force a new
   ECS deployment of `vaettir-api` (`aws ecs update-service --cluster
   vaettir-cluster --service vaettir-api --force-new-deployment`) so the
   running task picks up the new connection string.
6. Once confirmed stable, decide whether to rename the restored instance to
   `vaettir-postgres` (after deleting/renaming the old one) or keep the new
   identifier and update the secret permanently — a naming decision, not a
   technical requirement.

## What hasn't been done

- **The RDS backup retention bump above** — flagged, not applied, needs
  your go-ahead.
- **A live, end-to-end tested restore** — the procedure above is RDS's
  documented, standard mechanism (not something invented for this doc), but
  it has not actually been executed against a real snapshot in this
  environment. Spinning up a restored instance costs real money and time
  for a test that doesn't change what the documented procedure *is* — worth
  doing once as a real drill when you have 20-30 minutes, not something to
  do unattended. When you do run it: use a genuinely disposable target
  identifier, verify the data, then delete the restored instance
  (`aws rds delete-db-instance --db-instance-identifier
  vaettir-postgres-restore-YYYYMMDD --skip-final-snapshot`) rather than
  leaving it running and being billed for a second RDS instance indefinitely.
- **Multi-AZ** — not enabled. Multi-AZ protects against an *availability
  zone outage* (automatic failover, no data loss, no manual restore needed)
  — a different problem than backup/restore (which protects against *bad
  data*, not infrastructure failure). Worth a cost/benefit look once uptime
  actually matters to paying customers; not urgent for a single-user
  production app today.
