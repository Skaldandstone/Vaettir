import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@vaettir/core"],
  // Next also vendors image-size, outside pnpm's patched Metro dependency.
  // Keep these unused entry points off until that parser is independently fixed
  // and reviewed. This does not remove the bundled parser or approve an exception.
  images: { unoptimized: true, disableStaticImages: true },
  // Traces and copies only the node_modules this app actually needs into
  // .next/standalone -- the production Docker image runs that instead of
  // shipping the whole monorepo's node_modules tree.
  // Explicit local-only escape hatch for Windows hosts without symlink rights.
  // CI and container builds keep standalone packaging; this is not deployment evidence.
  output: process.env.VAETTIR_LOCAL_BUILD === "1" ? undefined : "standalone",
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
