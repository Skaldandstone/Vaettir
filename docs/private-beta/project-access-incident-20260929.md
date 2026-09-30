# Project access and owner-menu incident

## Observed production failure

- Fresh Google sign-in succeeded, then `organization.mine` returned HTTP 500 and the project page showed the public recovery message. The account menu incorrectly described unavailable membership data as an admin-role denial.
- The API task started at 18:07 Pacific; the managed database password rotated at 19:08 Pacific. Credentials were resolved only at process startup. The detailed health query could still succeed on an existing connection while authenticated queries failed.
- A disposable, read-only diagnostic task using the same deployed image and current managed secret verified the owner's existing local user, membership, organization match and Clerk mirror. It exited successfully and did not alter roles, memberships or customer records.
- Replacing the API task with the same revision restored the authenticated Projects page and aTwist listing. The account menu again displayed `owner` and enabled Members, Billing and Integrations. This isolates the failure to stale runtime state following credential rotation; the old tRPC handler did not log its exception classification, so an original Prisma error code was not available.

## Prevention

- Check the managed credentials every minute with bounded AWS calls and no overlapping checks. A confirmed change marks both liveness routes unhealthy so ECS replaces the stale task and obtains the current secret. This is bounded recovery, not a claim of zero interruption during rotation.
- A transient Secrets Manager failure does not evict a healthy task. Detailed health exposes a failed credential check; logs contain only a generic warning. Neither credentials nor exception messages are emitted by this monitor.
- Never replay transactions or paid operations during recovery. No rotation policy, IAM, identity configuration or database schema change is required.
- Log allowlisted internal error classifications for unexpected tRPC failures without query arguments, credentials, raw messages or user identifiers. Public errors remain sanitized.
- Distinguish checking/unavailable workspace permissions from a confirmed non-admin role. Preserve disabled controls while permission data is unavailable and provide an explicit retry.

## Validation

- Full isolated API suite: 393 passed across 70 files before the additional liveness-status test. Final focused suite: 16 passed, including that additional test. Web contracts: 42 passed. API/web typechecks passed; focused lint has no errors and two existing image-element warnings.
- Production recovery was authenticated and read-only: projects listed and existing owner controls restored. No mail, paid generation or customer-record edits used for validation.
- Prevention deployment acceptance will be recorded after immutable build and rollout checks. No live password rotation will be forced as a test.
