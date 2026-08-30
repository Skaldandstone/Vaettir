# Mobile build and device handoff

Status: no externally distributable package accepted. Configuration or a local compile-only APK does not close this gate.

App identifiers: com.skaldandstone.vaettir (Android and iOS).
Version: 0.1.0, initial native build 1. Increment the build number before every distributed update.
API: https://vaettir.skaldandstone.com/api.
Native stack: Expo 52, React Native 0.76.9, React 18.3.1; AsyncStorage 1.23.1 is used only to purge obsolete case caches. No new persistent case caching.

## Signing/build prerequisites

- Confirm the intended production Clerk publishable key and corresponding live backend instance. EXPO_PUBLIC values are embedded publicly in the app; never put secret keys there.
- Link the approved Expo project and store credentials using Expo's protected credential manager or an approved encrypted local signing store. Back up the Android signing key; an upgrade must use the same certificate.
- Preview profile creates an APK. Disable unauthenticated access to internal builds in Expo project settings before distributing. Internal links are otherwise accessible to anyone who has the URL. [Expo internal distribution](https://docs.expo.dev/build/internal-distribution/).
- Confirm available build quota/cost with James before cloud builds. No paid capacity was enabled by this implementation.
- Windows Android Gradle compilation uses the generated debug signing configuration and a compile-only key for local checks. Such an output is NOT a beta distribution artifact.
- Windows cannot generate the iOS native project with this Expo toolchain. Use EAS or an approved Mac/Linux generation host; a Mac/EAS Xcode build and Apple signing are still required.

After access and costs are approved, from apps/mobile:

```powershell
eas build --platform android --profile preview
eas build --platform ios --profile ios-testflight
eas submit --platform ios --profile ios-testflight
```

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

Record iOS as UNVERIFIED until every required physical-device workflow passes. Android can proceed independently once its own gates and all shared beta gates are satisfied.
