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

## Not yet configured

This app has no `android.package` or `ios.bundleIdentifier` set in
`app.json`, and no `submit` profiles in `eas.json` -- there is no store
identity yet, so builds are internal-only (`development`/`preview`). Add
bundle identifiers and a `production` build + submit profile (matching
Kall's `eas.json` as a reference) when Vaettir mobile is ready for its
first real device/store target.

Also note: this app is currently pinned to Expo SDK 52 (`expo: ~52.0.0`)
while Kall/Wispling/Savortome are on SDK 57 -- see the open Expo SDK
upgrade tracked separately (SSE-178) before assuming parity with those
apps' native tooling.
