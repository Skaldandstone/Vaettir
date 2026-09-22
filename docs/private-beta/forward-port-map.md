# Private-beta forward-port map

Checked on 2026-09-22 against `main` at `b02c936` and the preserved
`codex/private-beta-readiness` line at `6ed6a78`.

The preserved branch cannot be merged wholesale. A no-commit merge produced
conflicts across API authorization, billing, Prisma, Clerk, Sentry, web UI,
mobile configuration, workflows, and the lockfile. It was aborted without
retaining conflicted files. Forward-port each security boundary with its own
tests instead.

## Mobile lineage

| Source | Dependency | Forward-port status |
| --- | --- | --- |
| `a6b5554` | `organization.mine`, `project.list`, `organization.seatUsage`, `organization.aiCreditStatus`, membership role/seat fields | Core companion ported: organization/project selection, server allowance display, read-only control gating, explicit offline/error/empty states, sign-out, and removal of persistent case caching. Current API response shapes were used instead of copying obsolete reserved-seat fields. |
| `9173809` | Cache purge before reveal, foreground/session gate, tRPC 401/207 handling, actionable error mapping | Recovery and tRPC transport ported. Native wrapper/plugin scripts were not copied because current main has a later pnpm entry and Sentry Metro configuration; Android/iOS Hermes exports prove those current paths instead. |
| `9774876` | Fail-closed permission tests and immutable release telemetry | Permission/recovery tests ported. Immutable release identity was adapted into the current privacy-scrubbed Sentry initializer and Expo config instead of restoring the obsolete telemetry initializer. |
| `e9607e3` | Release evidence collector and CI contracts | No mobile UI source changes exist in this commit. Collector/CI integration remains a separate operations forward-port. |

The port deliberately preserves current-main push routing and Sentry privacy
scrubbing. Push project IDs are only selected after they match a project
returned for the active organization. No project records are written to local
storage; startup removes only obsolete `vaettir:cases:*` keys before revealing
workspace data.

## Browser lineage

`c4bcf1e` depends on the fixture framework introduced in `a6b5554`, current
membership response fields, and dozens of page-level permission changes. The
current production UI/onboarding files have since diverged substantially.
Copying the commit would overwrite later Clerk, Sentry, and visual work.

The minimal first browser slice is complete: Playwright authentication setup is
an explicit dependency of the authenticated project, so signed-out checks run
without Clerk credentials. The credential-free run passes four checks and
skips only the wrong-password case that requires a real identity.

Still to forward-port from `c4bcf1e`:

1. Disposable organization/project fixtures and teardown.
2. Read-only route and control coverage across every project surface.
3. Membership-derived mutation visibility plus server-denial recovery.
4. Onboarding, failed-import, exhausted-credit, session-expiry, and network
   recovery scenarios.

These must be reconciled page by page against the current UI rather than
reintroduced as one historical patch.

## Evidence and remaining gates

- Mobile unit checks: 4 passed for permissions, cache/session reveal, batched
  expiration detection, and sanitized actionable errors.
- Expo Doctor: 18/18 passed.
- Android and iOS Hermes exports passed after the forward-port.
- Expo public config resolves the production API, native identifiers, disabled
  Android backup, and committed icon/splash assets.
- Physical-device installation, signing, Clerk-authenticated flows, push
  delivery, Sentry delivery, TestFlight, and store acceptance remain unproved.
- `https://vaettir.skaldandstone.com` and the CloudFront web root returned HTTP
  503 during this pass, while the CloudFront `/api/health/detailed` endpoint was
  healthy earlier. Mobile recovery links therefore still require live web-route
  restoration evidence.
