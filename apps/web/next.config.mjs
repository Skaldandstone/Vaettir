/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@vaettir/core"],
  // Traces and copies only the node_modules this app actually needs into
  // .next/standalone -- the production Docker image runs that instead of
  // shipping the whole monorepo's node_modules tree.
  output: "standalone",
};

export default nextConfig;
