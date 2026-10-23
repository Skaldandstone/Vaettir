# API browser-origin policy evidence - 2026-09-24

Vaettir's API previously configured `@fastify/cors` with `origin: true`, which
reflected any browser-supplied origin. The candidate replaces that behavior
with an exact allowlist.

## Contract

- Production permits browser cross-origin responses only for the origin in
  `WEB_APP_URL` and exact origins listed in `CORS_ALLOWED_ORIGINS`.
- Wildcards, credentials, paths, queries, fragments, malformed values, and
  non-HTTP schemes fail startup validation rather than broadening access.
- Production does not inherit local-development origins.
- Local development permits the documented web ports on `localhost` and
  `127.0.0.1`; other local ports remain blocked unless explicitly configured.
- Requests without an `Origin` header remain allowed. This preserves health
  probes, signed webhooks, native clients, and server-to-server traffic.
- Same-origin browser requests do not require a CORS response header and are
  unaffected when no production cross-origin origin is configured.

## Local evidence

- Six focused Vitest cases pass, including a real Fastify injection probe.
- The probe confirms an approved origin receives
  `Access-Control-Allow-Origin` and an unapproved origin does not.
- API typecheck, lint, and production TypeScript build pass.
- Focused Prettier and `git diff --check` pass.

## Acceptance boundary

These tests prove local policy construction and Fastify response-header
behavior. They do not prove a deployed task has the intended environment
values, CDN behavior, authenticated browser acceptance, native-device
acceptance, or protection from non-browser clients. Authorization and tenant
isolation remain server-side controls; CORS is only a browser boundary.

No deployment, provider/account change, credential use, production data
mutation, or public release occurred in this slice.
