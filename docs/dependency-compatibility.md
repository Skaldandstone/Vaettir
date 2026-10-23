# Dependency compatibility checkpoint

Reviewed on 2026-10-22 when integrating the open dependency PRs.

The mobile cohort follows the [Expo SDK compatibility matrix](https://docs.expo.dev/versions/v58.0.0/): Expo 58, React Native 0.88 and React 19.3. Expo modules follow `expo/bundledNativeModules.json`; the web app uses matching React and React DOM versions. TypeScript 6 projects explicitly declare their Node globals. The ESLint JavaScript config matches the installed ESLint major, and the optional native UTF-8 validator matches Metro's WebSocket dependency.

The integration retains the newer Stripe 23 release dependency rather than downgrading to the older dependency PR. Existing native-runtime security overrides remain in place. Minimum Next.js 15.5.28, Sentry Next.js 10.75.2 and Fastify 5.12.6 include the available compatible patches; bounded overrides cover affected shell-quote, Undici 6, source-map-js, compression and ip-address versions.

## Unresolved mobile dependency findings

The package audit still reports six advisories through the mobile dependency graph. These are recorded findings, not an audit pass:

| Dependency | Finding | Reviewed scope |
| --- | --- | --- |
| node-forge | [Signature verification, high, no published fix](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Expo CLI and code-signing tooling. Absent from the Android JavaScript export source map. |
| braces | [Pattern recursion, high, no published fix](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Metro's file matching tools. Absent from the Android JavaScript export source map. |
| uuid | [Buffer bounds, moderate](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | Legacy wallet dependencies of Clerk Expo. The affected npm package is absent from the Android JavaScript export source map. Expo's separate internal UUID implementation is present. |
| stream-json | [Nested filter cost](https://github.com/advisories/GHSA-528h-pc64-c93x), [comment parsing cost](https://github.com/advisories/GHSA-hqr4-qq8f-hg3x), [assembler prototype pollution](https://github.com/advisories/GHSA-mjw6-4jj6-33hc), moderate | Legacy wallet/Jayson dependencies. Absent from the Android JavaScript export source map. The patched major is ESM and cannot safely replace the older CommonJS dependency without a separate compatibility change. |

The audit paths for these remaining findings originate only in `apps/mobile`, not the web or API dependency importers. An export source map establishes only the JavaScript module graph for that export. It does not establish native APK contents, installed-device behavior or build-tool safety. Native publishing and code-signing acceptance remain pending review; these findings must be reassessed before the mobile release. No new wallet, signing or publishing capability is enabled by the dependency integration.
