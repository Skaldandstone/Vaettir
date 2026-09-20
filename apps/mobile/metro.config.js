// Sentry's Metro wrapper around Expo's default config. It injects Debug
// IDs into bundles/sourcemaps so uploaded sourcemaps match their bundle
// once SENTRY_AUTH_TOKEN-backed upload is enabled (see README.md); it is
// harmless (plain Expo defaults) until then. Same shape as Kall's
// apps/mobile/metro.config.js.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

module.exports = getSentryExpoConfig(__dirname);
