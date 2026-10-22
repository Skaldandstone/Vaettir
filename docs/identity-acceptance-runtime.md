# Isolated identity acceptance runtime

Status: source preparation only. This entrypoint does not authorize activation,
credentials, new objects, directory reads, grants or test mutations. Supported
per-directory lifecycle/group evidence and current-session enterprise-connection
proof remain prerequisites. Local unit/call-order tests are not provider or
hosted UI acceptance.

## Production parity

`apps/api/src/server.ts` still starts the application with no options. Its
release validation, database resolution, instrumentation, registration of real
router/context/tenant ingress, health handlers, credential monitor and all five
background starters remain in `serverApplication.ts`. Production still binds
`0.0.0.0` and does not interpret a fixture environment flag. A derivation test
reconstructs the exact prior bba2644 server (normalized SHA256
`b51b8ce948ff11335d4ac872eb94c7c49cc0cf5eb92616aaef64cced8f98efd9`).

## Separate entrypoint, after operator approval only

The compiled `apps/api/dist/identityAcceptanceServer.js` requires an absolute
path to a reviewed JSON manifest. It validates before dynamically importing the
application. No alternate auth context or mocked provider is installed.

The operator must construct a **new child environment**, not spread the parent
environment. Allowed OS variables are PATH, SYSTEMROOT, WINDIR, TEMP, TMP,
COMSPEC, PATHEXT and SYSTEMDRIVE. Optional OS names are case insensitive;
application names are exact. Every other inherited variable is refused, even
when empty. Do not launch through npm/pnpm, tsx, dotenv, `--env-file`, preload
hooks or a Node inspector. NODE_OPTIONS/NODE_PATH must be absent **before Node
starts**; in-process validation cannot undo a preloaded module.

Required application values:

| Name | Required value |
| --- | --- |
| NODE_ENV | development |
| API_PORT | 4208 |
| WEB_APP_URL | http://localhost:3208 |
| CORS_ALLOWED_ORIGINS | http://localhost:3208 |
| DATABASE_URL | PostgreSQL, literal127.0.0.1:54828, database vaettir_identity_acceptance_20261022, role vaettir_identity_fixture; password required, no query/fragment |
| CLERK_SECRET_KEY | Independently verified, pinned existing development key; never a live key |
| CLERK_PUBLISHABLE_KEY | Matching pinned development key encoding the reviewed issuer |

Manifest fields are `version: 1`, `reviewReference`, `applicationId`,
`developmentInstanceId`, `issuer`, `secretKeySha256`, and
`publishableKeySha256`. All must be filled from independently reviewed operator
evidence; no defaults or real sample credentials are provided. Issuer must be
an exact HTTPS `*.clerk.accounts.dev` origin. Unknown fields fail closed.
Hash matching and a test-key prefix **do not prove** that a backend key belongs
to the stated instance/application. Verify that independently before activation.
The review reference records evidence; possession of a manifest is not authority.

Generated Prisma code is inspected as text before loading. Any non-null
generation-time env-file path or unknown metadata format is refused. No
generated code is executed to inspect these paths. Post-import environment
drift also refuses startup. Dependency/source integrity still requires a sealed
reviewed candidate; this is not a sandbox for untrusted modules.

This gate is not an outbound-network sandbox or OS credential-store isolation.
An SDK can have a default filesystem/metadata credential chain even without
explicit environment keys. Before any real activation the operator must review
transitive import effects and isolate network/credential access to the approved
provider path. Do not claim that environment filtering alone prevents every
external call, or exercise non-identity application routes in this fixture.

The API uses a validated in-memory permit to bind literal127.0.0.1 and skip
the credential timer and all background starters. Only exact local Host and
the reviewed Origin are allowed; forwarded and Vaettir tenant-attestation
headers are rejected, not trusted. Missing Origin remains valid for local
non-browser clients, which still pass normal authentication/authorization.
The ordinary development CORS localhost allowlist is narrowed only for this
entrypoint. Original tenant ingress and real context/router remain registered.

Health handlers are unchanged. In a fixture with intentionally stopped workers,
the ordinary detailed health poller check can report unhealthy. Do not rewrite
that result as production health or use it to justify starting workers.

## Operator launch gates and evidence

Before activation, confirm every proposed port is free without stopping another
process; record the owned database cluster/schema/role and exact source/build
identities. Start the separate web process with explicit IPv4 loopback binding,
not merely a localhost URL. Inspect actual owned-PID sockets for web/API/database
and fail on wildcard, IPv6, LAN or proxy listeners. An empty fixture database and
local URL alone do not prove ownership. No production environment file, database
dump, customer row or production provider credential belongs in this runtime.

No runtime or database was started by this implementation. Existing deployment,
directory-read authority, shared-development-user-pool exposure, isolated test
IDs, independent recovery, provider proof and end-to-end UI gates remain open.
