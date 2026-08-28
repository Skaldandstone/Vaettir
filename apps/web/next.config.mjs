import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@vaettir/core"],
  // Traces and copies only the node_modules this app actually needs into
  // .next/standalone -- the production Docker image runs that instead of
  // shipping the whole monorepo's node_modules tree.
  output: "standalone",
};

// P10-05: withSentryConfig also uploads source maps on build, which needs
// SENTRY_AUTH_TOKEN/SENTRY_ORG/SENTRY_PROJECT (none of which exist yet --
// see NEEDS_ATTENTION.md). Without SENTRY_AUTH_TOKEN it silently skips the
// upload step rather than failing the build, so wrapping unconditionally
// is safe either way; runtime error capture (instrumentation.ts /
// instrumentation-client.ts) doesn't depend on this at all.
export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
});
