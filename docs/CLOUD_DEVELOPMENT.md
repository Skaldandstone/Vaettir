# Development without local Docker

The cloud builder handles release compilation. A separate Aurora PostgreSQL 16
database replaces the Compose PostgreSQL service for development. It starts empty;
no production or old local data is copied. The old Docker volume remains intact.

## Connect and run

Install AWS CLI v2 and the official AWS Session Manager plugin. Renew the existing
`vaettir-toolkit` login when needed. From the Vaettir checkout, run:

```powershell
pnpm dev:cloud
pnpm db:migrate:cloud
```

The underlying helper can wrap another command:

```powershell
python scripts/cloud-dev-db.py run -- pnpm --filter @vaettir/db studio
```

It starts the small access host if stopped, opens a private Systems Manager tunnel
on `127.0.0.1:15432`, and reads only the new development cluster's managed secret.
It passes `DATABASE_URL` to the child process in memory. Passwords are not printed,
placed in command arguments, or saved in `.env`. Existing `.env` files are retained;
the process environment overrides their local database URL for this command.
The helper clears inherited `DB_SECRET_ID`, sets `NODE_ENV=development`, and the
development task passes this environment through Turbo to its child processes.

The helper checks the AWS account, stack, cluster tags, database name, endpoint,
and secret identity before retrieving credentials. It refuses a production or
mismatched target. The connection uses TLS and allows time for database resume.
Closing the child command closes the SSM session. Run the helper again after a
long-running development session encounters rotated database credentials.

If port 15432 is already occupied, close that connection before starting another
helper. One helper can run the entire development task group through `pnpm
dev:cloud`; it is not necessary to open separate tunnels for each app.

## Infrastructure and costs

`infra/dev-database.json` creates the isolated `vaettir-dev-database` stack in
account 051722405355, us-east-2. The database is private and accepts PostgreSQL
traffic only from its dedicated access host. That host has no inbound ports and
has only Systems Manager connectivity permissions, with no database-secret access.
The large compiler host is not used as the development tunnel.

Aurora pauses compute after five minutes with no database connections. Open
application connection pools prevent pausing; close the development command when
finished. The access host stops after at least 20 minutes uptime and 15 minutes
without an SSM session. Its root disk and the database remain billable while
compute is stopped or paused. AWS managed-secret storage, I/O and networking can
also incur charges. No NAT gateway, load balancer or public database address is
created.

The capacity range is an initial development configuration, not a measured sizing
assessment. Review observed connections, CPU and capacity before increasing it or
using it for load tests. Do not use this database for production.

The database uses encryption, managed credentials, deletion protection and snapshot
retention. Retirement must follow the repository's preservation/cleanup process.
Aurora 16.15 availability was verified with the live RDS engine and orderable-instance
APIs; the template narrowly suppresses cfn-lint 1.55.1's stale version enum for that
resource. AWS change-set validation remains required.

## Acceptance

Provision the reviewed change set, verify SSM/tunnel access, apply the committed
Prisma migrations, and query the database identity and empty application tables.
Then close the connection and verify auto-pause and access-host idle shutdown.
Template/unit checks alone do not establish these runtime results.

References: [Aurora auto-pause](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html),
[Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/install-plugin-windows.html).
