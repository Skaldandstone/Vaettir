// app.json stays the source of truth for everything static. This file
// layers the per-environment pieces on top of it, mirroring Kall's
// apps/mobile/app.config.js:
//
// - Sentry (P10-05, mobile half). The DSN is public by design (it can
//   only *send* events to one project), so it travels as a plain
//   EXPO_PUBLIC_SENTRY_DSN build-time env var (set per EAS build
//   profile in eas.json) and lands in `extra.sentryDsn`, which App.tsx
//   reads through expo-constants. It is deliberately NOT read via
//   process.env inside App.tsx: EXPO_PUBLIC_* inlining is a Metro
//   feature and this keeps a single resolution point that `expo config`
//   can print. No DSN -> Sentry stays fully disabled (App.tsx gates on it).
//
// - The `@sentry/react-native/expo` config plugin wires the native
//   sourcemap/debug-file upload steps into the generated Xcode/Gradle
//   projects (android/ and ios/ are gitignored - Continuous Native
//   Generation, so this runs at `eas build` time). Those upload steps
//   need SENTRY_AUTH_TOKEN, which is a real secret and is NOT wired yet;
//   eas.json sets SENTRY_DISABLE_AUTO_UPLOAD=true so a build without the
//   token succeeds instead of failing in sentry-cli. See README.md
//   ("Error tracking (Sentry)") for how to turn upload on.
module.exports = ({ config }) => {
  const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN || config.extra?.sentryDsn;

  if (!sentryDsn && process.env.EAS_BUILD === "true") {
    // Not fatal: an internal/dev build without error reporting is still a
    // valid build. Loud enough to notice in the EAS build log, though.
    console.warn(
      "[app.config.js] EXPO_PUBLIC_SENTRY_DSN is not set - Sentry error reporting will be disabled in this build.",
    );
  }

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      [
        "@sentry/react-native/expo",
        {
          organization: "skald-and-stone",
          project: "vaettir-mobile",
          // authToken intentionally omitted: supply SENTRY_AUTH_TOKEN as an
          // EAS secret instead (never in this file or in eas.json).
        },
      ],
    ],
    extra: {
      ...config.extra,
      sentryDsn,
    },
  };
};
