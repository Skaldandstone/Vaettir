# Mobile build and device handoff

Status: no externally distributable package accepted. Configuration or a local compile-only APK does not close this gate.

App identifiers: com.skaldandstone.vaettir (Android and iOS).
Version: 0.1.0, initial native build 1. Increment the build number before every distributed update.
API: https://vaettir.skaldandstone.com/api.
Native stack: Expo 52, React Native 0.76.9, React 18.3.1; AsyncStorage 1.23.1 is used only to purge obsolete case caches. No new persistent case caching.

## Mobile lane implementation

The native Gradle entry adapter resolves the entry file to an absolute path before calling Expo. React Native 0.76's Windows CLI arguments are app-relative while Expo 52's Metro server root is the monorepo; this fixes that mismatch without patching dependencies. Metro's transform cache is isolated under apps/mobile/.expo/metro-cache so a native reset cannot clear another project's cache. Two Metro workers bound parallel build load.

The app's react-native.config.js also retains Expo's own expo.modules.ExpoModulesPackage Android import. Expo 52's in-memory dependency-config loader loses pnpm's realpath and otherwise falls back to an invalid expo.core import. Regenerate native projects after changing this configuration; do not hand-edit generated PackageList.java.

Build the shared core package before native bundling. The EAS post-install hook now does this on clean cloud checkouts. For local typecheck, generate Prisma and build core, db and ai-agent first (or use the repository's topological typecheck workflow). Missing generated declarations are not mobile source errors.

Mobile recovery changes include: purge completion is required after foreground return, old-session responses cannot expire a new session, workspace switching clears the old selection immediately, explicit refresh controls, bounded network wait, readable authentication/access/offline errors, sign-off history loading/error states, and case-review/sign-off recovery that asks the user to reload before resubmitting an uncertain mutation. No paid AI request is automatically retried. Android app backup is disabled and unused external-storage, overlay and vibration permissions are blocked. Keyboard avoidance and accessibility labels cover the companion forms; actual device acceptance remains open.

Run focused tests from the repository root with pnpm --filter @vaettir/mobile test. They use Node's built-in runner with TypeScript stripping; use Node 22.18+ or Node 24. Tests cover entry adaptation, cache/session gating, batched unauthorized responses, safe recovery messages and release-configuration refusal.

## Signing/build prerequisites

- Confirm the intended production Clerk publishable key and corresponding live backend instance. EXPO_PUBLIC values are embedded publicly in the app; never put secret keys there.
- Set EXPO_PROJECT_ID to the approved Expo project's UUID. app.config.js supplies extra.eas.projectId without inventing or creating an account/project. Preview and TestFlight profiles both use the production EAS environment.
- Link the approved Expo project and store credentials using Expo's protected credential manager or an approved encrypted local signing store. Back up the Android signing key; an upgrade must use the same certificate.
- Preview profile creates an APK. Disable unauthenticated access to internal builds in Expo project settings before distributing. Internal links are otherwise accessible to anyone who has the URL. [Expo internal distribution](https://docs.expo.dev/build/internal-distribution/).
- Confirm available build quota/cost with James before cloud builds. No paid capacity was enabled by this implementation.
- Windows Android Gradle compilation uses the generated debug signing configuration and a compile-only key for local checks. Such an output is NOT a beta distribution artifact.
- Windows cannot generate the iOS native project with this Expo toolchain. Use EAS or an approved Mac/Linux generation host; a Mac/EAS Xcode build and Apple signing are still required.
- Current Apple upload rules require Xcode 26+ with the iOS 26+ SDK for App Store Connect uploads. The existing Expo 52 stack has NOT been validated on that toolchain. Select and validate a compatible EAS/Mac image before claiming a TestFlight-ready build; a coordinated stack upgrade may be necessary and must be handled with dependency security. Do not treat an old successful iOS bundle or Xcode image as upload acceptance. [Apple SDK requirement](https://developer.apple.com/news/upcoming-requirements/?id=02032026a).

After access and costs are approved, set the approved environment locally and run the static preflight from apps/mobile before submitting any build. It fails closed for missing/test Clerk keys, missing Expo project identity, wrong endpoints and wrong native identifiers. It does not verify credentials, billing, signing or restricted access. Cloud EAS builds also run this validation during config evaluation.

```powershell
pnpm check:release
eas build --platform android --profile preview
eas build --platform ios --profile ios-testflight
eas submit --platform ios --profile ios-testflight
```

Both build profiles increment native build versions. Before an update, confirm the effective generated build number exceeds the last distributed build on that platform. Do not rely on a locally unchanged app.json after a remote build; record the value from the actual artifact.

The [EAS lifecycle hook](https://docs.expo.dev/build-reference/npm-hooks/) prepares the shared core build. Keep publicly embedded values in the appropriate [EAS environment](https://docs.expo.dev/eas/environment-variables/usage/); approval is still required before changing account configuration.

Use a reviewed/pinned EAS CLI version and capture it in the release record. EAS Submit uploads to App Store Connect/TestFlight; it is not physical-device acceptance. Configure the app record and named testers rather than a public invitation link. [Expo iOS submission](https://docs.expo.dev/submit/ios/).

## Artifact record

Record release SHA, pnpm lockfile hash, Expo/React Native/CLI versions, API host, public-key instance (not secrets), package ID, version/build, architecture, signing certificate fingerprint, SHA-256 file hash, EAS build ID, restricted download location and tester. Never commit keystores, passwords, tokens, provisioning secrets or API secret keys.

## Android physical-device checklist

For each row record device/model, OS, build, tester, timestamp, result and recording/screenshot reference:

- Fresh install and upgrade from the prior signed build without losing the ability to sign in.
- Correct icon, splash, safe area, keyboard avoidance, text contrast, large text and TalkBack labels.
- Valid password sign-in, wrong password, MFA, expired session, sign-out and account switching.
- Organization and project selection; no previous team's cases flash or persist after switching/sign-out.
- Empty organization/project/case/release/framework, slow request, failed request, offline and retry.
- Case detail; full editor AI review; read-only controls absent and server rejection verified.
- Release state agrees with web for the same project and candidate timestamp.
- Authorized compliance sign-off, read-only denial, period/statement validation and history refresh.
- Background/foreground and process restart require fresh data validation. Old case caches are purged.
- DSN-configured synthetic crash/error reaches the intended alert recipient without sensitive payloads.

## iOS friend checklist

Use the same workflow checklist on a physical iPhone via TestFlight. Add: invitation acceptance, installation, initial launch, Apple keyboard/safe-area behavior, large text/VoiceOver, background resume, upgrade, expiry/sign-out and screenshots/recordings. The tester sends results privately to James, without secrets or regulated data.

Use a named external tester group for James's friend, with the first build submitted for TestFlight App Review and explicit test information. Do not grant App Store Connect administrative access just to make testing easier. Keep public invitation links disabled. [Apple external testing guidance](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers).

Record iOS as UNVERIFIED until every required physical-device workflow passes. Android can proceed independently once its own gates and all shared beta gates are satisfied.
