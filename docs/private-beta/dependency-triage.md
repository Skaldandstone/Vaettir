# Dependency PR triage

Read-only GitHub inspection on 2026-08-30 returned ten open PRs, not the eleven in the earlier assessment. No PR was merged or updated by this work. Each requires a separate reviewed result; being listed here is not dependency acceptance.

| PR | Change | Disposition and required proof |
|---|---|---|
| [12](https://github.com/Skaldandstone/Vaettir/pull/12) | @fastify/cors 10 -> 11 | Hold major upgrade; review Fastify compatibility and credentialed/browser preflight tests |
| [11](https://github.com/Skaldandstone/Vaettir/pull/11) | @clerk/nextjs 6 -> 7 | Hold for coordinated auth migration; sign-in/MFA/invite/session and middleware matrix |
| [10](https://github.com/Skaldandstone/Vaettir/pull/10) | Prisma CLI 5 -> 7 | Pair with client PR 7 at exactly matching versions; schema/config/adapter/migrate/restore testing |
| [9](https://github.com/Skaldandstone/Vaettir/pull/9) | @clerk/backend 1 -> 3 | Review together with auth stack and verification/error semantics; no isolated major merge |
| [8](https://github.com/Skaldandstone/Vaettir/pull/8) | expo-status-bar 2 -> 57 | Do not merge into Expo 52; upgrade Expo/RN/React/native modules as one stack with device acceptance |
| [7](https://github.com/Skaldandstone/Vaettir/pull/7) | Prisma client 5 -> 7 | Coupled to PR 10; current proposed versions differ and cannot be accepted independently |
| [6](https://github.com/Skaldandstone/Vaettir/pull/6) | minimatch 9 -> 10 | Test repo scanning, path policy, Windows separators, glob semantics and Node engine |
| [5](https://github.com/Skaldandstone/Vaettir/pull/5) | fast-xml-parser 4 -> 5 | JUnit/coverage malformed XML, entities, coercion and fixture regression required |
| [2](https://github.com/Skaldandstone/Vaettir/pull/2) | actions/checkout 4 -> 7 | Runner/Node/action policy review; verify in a separate CI run after billing resolution |
| [1](https://github.com/Skaldandstone/Vaettir/pull/1) | Docker Node 22 -> 25 | Keep the current coordinated Node 22 CI/container baseline for beta; reconsider as a separate runtime upgrade |

This candidate changes only the Expo-52-compatible native packages needed for the companion and adds Clerk's test helper. The frozen lockfile is the release source of truth. Security advisories still need a recorded vulnerability triage; do not treat deferred major upgrades as evidence of safety.

## Audit release blocker

The local pnpm audit --prod snapshot on 2026-08-30 reports 26 advisories: one critical, 18 high and seven moderate. Release remains HOLD. Counts include transitive development/build tooling reachable through production-declared Expo dependencies, not just shipped API code. No advisory has been suppressed or marked accepted.

| Package | Review / patch target from audit | Required evidence |
|---|---|---|
| tar | Critical decompression DoS plus path traversal/recursion issues; audit identifies fixes through 7.5.21 | Inspect Expo CLI/cacache paths; reviewed compatible parent/override change and archive/build tests |
| @xmldom/xmldom | Serialization injection/recursion, fixed at 0.8.15 | Inspect Expo config/XML consumers; regenerate native projects and test parsing |
| postcss | Source-map file disclosure and stringification issues; fixes through 8.5.23 | Inspect Next/Expo Metro paths; CSS/source-map regression and clean production build |
| sharp | Inherited libvips vulnerabilities, fixed at 0.35.0 | Native runtime compatibility and image pipeline verification, including Next image handling |
| image-size | ICNS/JXL/HEIF denial of service; audit supplied no patched version | Upstream resolution or documented restriction of attacker-controlled input; no blanket ignore |
| fast-xml-parser | Moderate XMLBuilder comment/CDATA injection | Inspect actual parser/builder use; coordinate with PR 5 rather than blind major update |
| uuid | Moderate v3/v5/v6 supplied-buffer bounds issue | Determine affected call sites and safe parent upgrade |

The current implementation does not claim these are exploitable in every deployment path, or that they are safe. Engineering must trace each affected path and record a fix or reviewed non-exposure decision before the dependency gate can pass. Example critical advisory: [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw).
