import { withSentryConfig } from "@sentry/nextjs";
import { fileURLToPath } from "node:url";

// NodeNext API sources correctly import emitted .js paths. Webpack also reads
// their uncompiled TypeScript schemas in the browser, so permit that fallback
// without replacing a real .js dependency or discarding existing alias maps.
// https://webpack.js.org/configuration/resolve/#resolveextensionalias
export function withNodeNextSourceAliases(config) {
  config.resolve ??= {};
  const aliases = config.resolve.extensionAlias ?? {};
  const existing = aliases[".js"] ?? [".js"];
  config.resolve.extensionAlias = {
    ...aliases,
    ".js": [
      ...new Set([
        ...(Array.isArray(existing) ? existing : [existing]),
        ".js",
        ".ts",
        ".tsx",
      ]),
    ],
  };
  return config;
}

// PptxGenJS declares these modules browser:false, but Webpack rejects the
// node: URI before consulting that map. Strip only these package-local imports
// in the client build so its own browser map applies; never polyfill Node APIs.
export function withReportBrowserImports(config, { isServer, webpack }) {
  withNodeNextSourceAliases(config);
  if (!isServer) {
    config.plugins ??= [];
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(
      /^node:(fs|https)$/,
      (resource) => {
        if (/[\\/]pptxgenjs[\\/]dist(?:[\\/]|$)/.test(resource.context))
          resource.request = resource.request.slice(5);
      },
    ));
  }
  return config;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  deploymentId: process.env.NEXT_PUBLIC_RELEASE_COMMIT,
  transpilePackages: ["@vaettir/core"],
  webpack: withReportBrowserImports,
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
