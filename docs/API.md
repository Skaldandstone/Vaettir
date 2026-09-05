# API access for external integrations (P9-05)

Vaettir's API is a tRPC server, not a hand-written REST API - there's no
separate OpenAPI/REST layer, and none is planned to be auto-generated
across all ~200 procedures in one pass (that's real, invasive per-procedure
work - `.meta({ openapi: {...} })` on every one - not something to do
unattended; tracked as the open remainder of this ticket). What this
document covers instead: **the real, already-proven way to call the API
directly over plain HTTP**, without the TypeScript client - exactly what
this repo's own `ci-integrations/*/report.sh` scripts already do in
production-shaped CI configs.

## Authentication

Every call needs an API key (`P1-05` - create one under Organization
Settings → API keys, or via `apiKeys.create` if you're already
authenticated another way). Send it as a standard bearer token:

```
Authorization: Bearer vt_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

A missing or invalid key gets a real `401` with a standard tRPC error
body (verified for real against a running server):

```json
{"error":{"message":"UNAUTHORIZED","code":-32001,"data":{"code":"UNAUTHORIZED","httpStatus":401,...}}}
```

## Calling a query (GET)

```
GET /trpc/<procedure.path>?input=<URL-encoded JSON>
```

Example - list a project's test cases:

```bash
curl -H "Authorization: Bearer $VAETTIR_API_KEY" \
  "https://vaettir.skaldandstone.com/api/trpc/project.list?input=$(node -e 'console.log(encodeURIComponent(JSON.stringify({organizationId:"..."})))')"
```

A successful response wraps the return value in `result.data` (verified
for real):

```json
{"result":{"data":[{"id":"...","name":"Kall","slug":"kall","repoUrl":"...","createdAt":"..."}]}}
```

## Calling a mutation (POST)

```
POST /trpc/<procedure.path>
Content-Type: application/json

<the mutation's input, as plain JSON - no wrapper>
```

This is exactly what `testRuns.ingestJUnit` (the endpoint every
`ci-integrations/*/report.sh` script already posts to) does:

```bash
curl -X POST "https://vaettir.skaldandstone.com/api/trpc/testRuns.ingestJUnit" \
  -H "Authorization: Bearer $VAETTIR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "...",
    "ciProvider": "generic",
    "commitSha": "'"$(git rev-parse HEAD)"'",
    "branch": "'"$(git branch --show-current)"'",
    "junitXml": "<the raw JUnit XML content as a string>"
  }'
```

Response, again wrapped in `result.data` (verified for real):

```json
{"result":{"data":{"testRunId":"...","totalResults":1,"passCount":1,"failCount":0,"skipCount":0,"matchedCount":0,"unmatchedCount":1}}}
```

## What's realistically worth calling from outside the web app

- **`testRuns.ingestJUnit`** - post test results from any CI system. See
  `ci-integrations/README.md` for provider-specific scripts already built
  (GitHub Actions, CircleCI, Jenkins) - reuse or copy those rather than
  reinventing the request shape.
- **`coverage.ingest`** - post a coverage report (Istanbul/nyc, Cobertura,
  JaCoCo).
- **`project.list`** / **`testCases.list`** / **`testCases.byId`** - read
  access for building a dashboard or a custom integration against real
  project data.
- Outbound direction (Vaettir pushing TO you instead): see `P9-06`'s
  webhook system - Organization Settings → Webhooks - rather than polling
  any of the above.

Every procedure still enforces the same `requireProjectAccess`/
`requireOrgRole` checks (`P1-06`) regardless of whether the caller is a
human session or an API key - a key created with `VIEWER` role can read
but not post results; use `EDITOR` for a CI-reporting key (matches what
`ci-integrations/*/report.sh`'s setup instructions already say).

## Batched calls (what the web app's own client does, not required for you)

The web app's tRPC client batches multiple queries fired in the same tick
into one comma-joined request (`/trpc/a,b,c?batch=1&input=...`). This is a
client-side optimization, not a server requirement - every example above
is a plain, unbatched call, which is simpler and is exactly what external
integrations should use.

## What's still open

A real, generated OpenAPI spec (so external tools can auto-generate a
client, get inline docs, etc.) is real, per-procedure annotation work
across the whole router - genuinely invasive, not attempted here. This
document is the practical, immediately-usable version: how to actually
call the API today, verified against a real running server, not a
speculative spec for tooling that doesn't exist yet.

**A real attempt was made and reverted (2026-09-04)**, worth knowing before
trying again: `trpc-to-openapi` (the actively-maintained fork of the
abandoned `trpc-openapi`) is otherwise a good fit - `.meta({ openapi: {...}
})` per procedure, a real `generateOpenApiDocument()`, adapters for every
major HTTP framework - and its zod-v3-compatible major version
(`trpc-to-openapi@2.4.0` + `zod-openapi@4.2.4`; the current `3.x` line
requires zod v4's internal schema representation, which our zod 3.25.x
`import { z } from "zod"` usage across the whole codebase doesn't satisfy)
does correctly generate a real OpenAPI document against our actual router.
The blocker is downstream of that: **its Fastify adapter
(`fastifyTRPCOpenApiPlugin`) crashes with `RangeError: Maximum call stack
size exceeded` in `Reply.get`** on a real request against our exact stack
(Fastify 5.12.1) - confirmed reproducible, and confirmed to be Fastify-
adapter-specific, not a deeper library bug: the same router, same
generated document, and the same request dispatched through
`createOpenApiHttpHandler` (their plain `node:http` adapter) works
correctly with no recursion. A real fix exists in principle - bridge
Fastify's raw `request.raw`/`reply.raw` into the `node:http` handler by
hand, bypassing the buggy `Reply` decoration entirely - but that's a
routing change to the production HTTP server with its own real risk
(catch-all route ordering against the existing `/trpc`, `/health`, and
webhook routes), not something to push through unattended. If revisiting
this: start from the `node:http` handler bridge, not the Fastify plugin.
