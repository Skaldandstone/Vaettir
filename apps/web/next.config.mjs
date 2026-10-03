import { withSentryConfig } from "@sentry/nextjs";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  deploymentId: process.env.NEXT_PUBLIC_RELEASE_COMMIT,
  transpilePackages: ["@vaettir/core"],
  async headers() {
    return ["gitlab", "github"].map(provider => ({ source: `/connections/${provider}/callback`, headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "no-store" },
    ] }));
  },
  // Traces and copies only the node_modules this app actually needs into
  // .next/standalone -- the production Docker image runs that instead of
  // shipping the whole monorepo's node_modules tree.
  // Windows developer shells commonly cannot create pnpm's standalone
  // symlinks. Local validation may opt out without changing the default
  // artifact produced by CI and Docker builds.
  output: process.env.VAETTIR_LOCAL_BUILD === "1" ? undefined : "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  // Sharp loads this native bundle's version receipt through a dynamic require.
  // Keep the actual package receipt in standalone, not a hand-written copy or
  // an assertion fallback that hides missing embedded-library provenance.
  outputFileTracingIncludes: {
    "/*": [
      "../../node_modules/.pnpm/@img+sharp-libvips-linux-x64@1.3.4/node_modules/@img/sharp-libvips-linux-x64/versions.json",
    ],
  },
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
