# Vaettir mobile

## OTA updates (EAS Update)

A JS/asset-only change does not need a new store submission. `expo-updates`
is configured with `runtimeVersion.policy: "fingerprint"` (`app.json`), so a
build's compatibility with an update is computed from what's actually native
about it rather than a hand-maintained version number.

| Channel       | Build profile | Reaches                    |
| ------------- | -------------- | ---------------------------- |
| `development` | `development`  | Local dev client builds      |
| `preview`     | `preview`      | Internal testers             |
| `production`  | `production`   | Store/TestFlight candidates  |

Publish with:

```bash
npm run update:preview      # or: npm run update:development
```

**What this does NOT cover.** Anything that changes the native fingerprint --
a new native module, a changed permission, an `app.json`/`expo-build-properties`
change, a bumped native dependency, anything in `plugins` -- requires a new
build (and, for a permission/capability change, a new store submission)
regardless.

#### Keeping native builds rare

A native build costs real EAS build minutes and forces every user through
a store update, so treat crossing the fingerprint boundary as a real cost:

- Prefer a pure-JS approach over a new native module/config plugin when the
  difference doesn't matter for the feature.
- Don't add a permission or capability speculatively -- add it in the same
  change that uses it, and expect that change to need a real build.
- Batch unavoidable native-forcing changes together rather than shipping
  them one at a time.
- If a change is store-listing-only (screenshots, description, keywords),
  it never needs a build at all -- that's a Play Console / App Store
  Connect edit, independent of the app binary.

## Bundling inside the pnpm workspace

`package.json` points `main` at a local `index.js` rather than Expo's default
`node_modules/expo/AppEntry.js`. Under pnpm the real path of `AppEntry.js` is
inside the virtual store (`node_modules/.pnpm/expo@.../`), so its
`import App from '../../App'` cannot reach this package's `App.tsx`; `index.js`
registers the root component from here instead. `@babel/runtime` is also a
direct dependency because Metro's transformed output requires its helpers from
this package and pnpm does not hoist it. Both are required for `expo start`
and `expo export` to work from `apps/mobile`; keep them if you change the
entry or dependencies.

## Build identity and release endpoints

Android and iOS use the shared native identity `com.skaldandstone.vaettir`.
Committed icon, adaptive-icon, and splash assets use the same dark umber and
muted-sage visual system as the web workspace. Android backup is disabled so
Clerk tokens and local app state are not copied into device backups, and unused
legacy storage/overlay permissions are explicitly blocked.
The `preview` profile creates a restricted-distribution Android APK and a
physical-device iOS build; `production` is the store/TestFlight candidate
profile. Both profiles fail configuration early unless their API endpoint is
HTTPS and `EXPO_PUBLIC_RELEASE_COMMIT` is the exact 40-character candidate
commit. The current candidate endpoint is the deployed CloudFront `/api`
origin. The same commit identifier is attached to sanitized Sentry events.
Local `expo start` still defaults to `http://localhost:4000`, and can be
pointed elsewhere with `EXPO_PUBLIC_API_URL`.

Store submission profiles and credentials remain intentionally unconfigured.
Creating them requires the Apple/Google owner accounts and is not proven by
the local build/export checks in this repository.

Also note: this app is currently pinned to Expo SDK 52 (`expo: ~52.0.0`)
while Kall/Wispling/Savortome are on SDK 57 -- see the open Expo SDK
upgrade tracked separately (SSE-178) before assuming parity with those
apps' native tooling.

## Error tracking (Sentry)

P10-05, mobile half. `@sentry/react-native` reports to the `vaettir-mobile`
project in the `skald-and-stone` org (api and web have their own projects -
see `NEEDS_ATTENTION.md`). Wiring:

- `app.config.js` resolves `EXPO_PUBLIC_SENTRY_DSN` -> `extra.sentryDsn` and
  adds the `@sentry/react-native/expo` config plugin. The DSN is public by
  design (it can only *send* events to one project), so it lives in
  `eas.json` per build profile, not in a secrets store.
- `lib/sentry.ts` initialises the SDK; `App.tsx` calls it first and exports
  `Sentry.wrap(App)`. `environment` is the EAS Update channel
  (`Updates.channel`: `development` / `preview`), falling back to `__DEV__`.
- **No DSN, or a `__DEV__` bundle, means Sentry is disabled** - a dev client
  or `expo start` session never reports. To verify capture from a dev
  bundle, run with `EXPO_PUBLIC_SENTRY_DEBUG=1` (mobile counterpart of the
  API's `SENTRY_DEBUG=1`); that also turns on the SDK's own console logging.
- Privacy: `sendDefaultPii: false`, `tracesSampleRate: 0`, no session
  replay, `maxBreadcrumbs: 0`, and `beforeSend` drops `user`, breadcrumbs
  and any request URL (a URL can carry a Clerk ticket or a shareable
  test-status link token). Same stance as Kall's `sentry-shared.ts`.

Adding the SDK is a native change (config plugin + native module), so it
crosses the fingerprint boundary: **existing `development`/`preview` builds
must be rebuilt** before an OTA update can carry this code.

### Sourcemap upload (not enabled yet)

The config plugin wires sentry-cli into the generated Xcode/Gradle build,
which needs `SENTRY_AUTH_TOKEN` (a real secret). Until that exists,
`eas.json` sets `SENTRY_DISABLE_AUTO_UPLOAD=true` on every profile so a
build succeeds without it; stack traces will be minified but still
grouped correctly. To turn upload on:

1. Create an org auth token in Sentry with `project:releases` +
   `org:read` (Settings -> Auth Tokens), scoped to `vaettir-mobile`.
2. `eas env:create --scope project --name SENTRY_AUTH_TOKEN --value <token>`
   `--visibility secret --environment preview` (repeat per environment).
   Never put it in `eas.json`, `app.config.js`, `.env`, or git.
3. Remove `SENTRY_DISABLE_AUTO_UPLOAD` from the profile's `env` in `eas.json`
   (or set it to `false`) and rebuild. `metro.config.js` already uses
   `getSentryExpoConfig`, so bundles carry the Debug IDs uploads need.

Check what a build will see with `npx expo config --type public` (prints
`extra.sentryDsn` and the resolved `plugins`).
