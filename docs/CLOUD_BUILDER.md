# Cloud builds for Vaettir

This path moves API compilation off the developer PC. The PC needs Git, Python
3.11 or newer, and AWS CLI v2; it does not need Docker. The cloud host runs Docker
with a persistent BuildKit cache. Production continues to use its existing ECS
release process.

## Infrastructure

`infra/cloud-builder.json` defines one dedicated Ubuntu 24.04 x86 host in account
051722405355, us-east-2. The initial size is m7i.4xlarge (16 vCPUs, 64 GiB RAM),
with 150 GiB encrypted gp3 storage. It uses an existing public subnet, has no
inbound ports or SSH key, and is operated through Systems Manager. No NAT gateway
or load balancer is created. Verify subnet routing and current EC2/EBS pricing
before applying the change set.

The instance stops after at least 20 minutes of uptime and 15 minutes without a
build, checked every five minutes. A shared lock prevents idle shutdown during a
build. Compute charges stop when the instance stops; EBS storage remains billable.
The instance and disk are retained on stack deletion or replacement. Retirement
requires the normal explicit preservation and cleanup review.

The instance role can read only the source bucket's `cloud-builder/jobs/` prefix,
write build logs/results there, and publish images to `vaettir-api`. It has no ECS
rollout, customer database, or application-secret permissions. IMDSv2 is required;
the metadata hop limit keeps instance credentials out of build containers.

## Provision

Use the existing `vaettir-toolkit` profile and verify its STS account first. Review
current resources for an existing builder before creating this one. Supply a
verified VPC and public subnet from that account. Create a CloudFormation change
set for stack `vaettir-cloud-builder` using `infra/cloud-builder.json`, parameters
`VpcId` and `SubnetId`, and capability `CAPABILITY_IAM`. Inspect validation results
and every proposed resource before executing it. Do not apply changes to the
application stacks. Creation is not complete until Systems Manager reports the
host online and `/var/lib/vaettir-builder/ready` exists.

## Build

Commit the worker/controller changes before using them: the controller reads its
worker from its own Git HEAD. Choose an exact source SHA independently. Uploads
use `git archive`, excluding uncommitted changes. Review tracked content for
privacy before the first submission. No native session stores or local databases
are uploaded.

```powershell
python scripts/cloud-builder.py submit <40-character-source-sha> --phase prepare-native
python scripts/cloud-builder.py status <run-id>
python scripts/cloud-builder.py logs <run-id>
python scripts/cloud-builder.py submit <same-source-sha> --phase build-image
python scripts/cloud-builder.py status <run-id>
```

Run preparation once before the release window, and repeat it when the native
toolchain needs a refresh. Ordinary image builds reuse matching native layers and
force the final runtime checks again. A cold image build can compile native layers
itself. Both paths use the unmodified production Dockerfile and existing LLVM
test deadlines; neither uses diagnostic or checkpoint targets as runtime donors.

Submission starts a stopped instance, waits for Systems Manager, then runs the
job independently of the PC. An occupied builder rejects another job with exit
75. Keep the returned receipt under `.local/assistant-history/cloud-builder/`.
Jobs have a seven-hour build budget and retain source, logs and receipts on the
encrypted disk. The idle timer stops the machine after failure as well as success.
Inspect SSM output if bootstrap fails before a result can be written.

Successful image jobs publish a unique `cloud-<commit>-<run-id>` ECR tag and return
its digest. Native preparation produces no runtime image. Neither operation
changes the running application. Before rollout, the existing release owner must
verify scans, exact source identity, CI, runtime checks and current ECS baseline.

## Acceptance and remaining migration

Local syntax, policy and command tests do not establish a working cloud host.
Accept this path only after a cloud native preparation, successful image build,
digest/scan verification, a warm-cache build, and observed idle stop/start with
cache retention. Do not interrupt or discard the existing local release build to
test this path.

The Compose PostgreSQL database is a separate migration. Preserve and inspect
its data before changing development connection settings. A cloud development
database must be isolated from production and reachable privately; this builder
is disposable compute and must not become a database host. No database or local
volume is deleted by this change.
