// app.json stays the source of truth for everything static. This file
// layers the per-environment pieces on top of it, mirroring Kall's
// apps/mobile/app.config.js:
//
// - Sentry (P10-05, mobile half). The DSN is public by design (it can
//   only *send* events to one project), so it lives directly in
//   app.json's `extra.sentryDsn` - the one value both `eas build` (which
//   evaluates this file with EAS build-profile env applied) and
//   `eas update` (OTA; it never sees `eas.json` `env`, only whatever
//   `extra` already resolved to when the update manifest was generated)
//   end up shipping. EXPO_PUBLIC_SENTRY_DSN (set per EAS build profile
//   in eas.json, or exported locally) still overrides it for local/dev
//   builds. The result lands in `extra.sentryDsn`, which lib/sentry.ts
//   reads through expo-constants. It is deliberately NOT read via
//   process.env inside lib/sentry.ts: EXPO_PUBLIC_* inlining is a Metro
//   feature and this keeps a single resolution point that `expo config`
//   can print. No DSN -> Sentry stays fully disabled (lib/sentry.ts gates
//   on it).
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
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || config.extra?.apiUrl;
  const releaseCommit = process.env.EXPO_PUBLIC_RELEASE_COMMIT || config.extra?.releaseCommit;
  const buildProfile = process.env.EAS_BUILD_PROFILE;

  if (["preview", "production"].includes(buildProfile) && !apiUrl?.startsWith("https://")) {
    throw new Error(
      `[app.config.js] ${buildProfile} builds require an HTTPS EXPO_PUBLIC_API_URL; received ${apiUrl || "no URL"}.`,
    );
  }
  if (["preview", "production"].includes(buildProfile) && !/^[a-f0-9]{40}$/i.test(releaseCommit ?? "")) {
    throw new Error(
      `[app.config.js] ${buildProfile} builds require EXPO_PUBLIC_RELEASE_COMMIT to be the exact 40-character source commit.`,
    );
  }

  if (!sentryDsn) {
    // Not fatal: a build/update without error reporting is still valid.
    // Loud enough to notice in the EAS build log (or a local `expo config`/
    // `expo start`), though - this covers both the `eas build` path (no
    // EXPO_PUBLIC_SENTRY_DSN env and no app.json `extra.sentryDsn`) and the
    // `eas update` / OTA path, which never reads `eas.json` build-profile
    // `env` at all and depends entirely on `config.extra?.sentryDsn`.
    console.warn(
      "[app.config.js] No Sentry DSN (checked EXPO_PUBLIC_SENTRY_DSN and app.json extra.sentryDsn) - Sentry error reporting will be disabled.",
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
      apiUrl,
      releaseCommit,
      sentryDsn,
    },
  };
};
