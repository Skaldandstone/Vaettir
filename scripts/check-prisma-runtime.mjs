import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Build-only native-link check. It neither opens a database nor reads source
// credentials. Generate the client in the same Linux image before invoking it.
export function prismaEngineTarget(platform, arch) {
  if (platform !== "linux")
    throw new Error("Prisma image smoke check requires Linux");
  if (arch === "x64") return "debian-openssl-3.0.x";
  if (arch === "arm64") return "linux-arm64-openssl-3.0.x";
  throw new Error("Unsupported Prisma image architecture");
}

function resolveEngineFiles(target) {
  const dbRequire = createRequire(
    new URL("../packages/db/package.json", import.meta.url),
  );
  const clientRequire = createRequire(dbRequire.resolve("@prisma/client"));
  const generated = dirname(clientRequire.resolve(".prisma/client/default"));
  const prismaRequire = createRequire(dbRequire.resolve("prisma/package.json"));
  const engines = dirname(
    prismaRequire.resolve("@prisma/engines/package.json"),
  );
  return {
    query: join(generated, `libquery_engine-${target}.so.node`),
    schema: join(engines, `schema-engine-${target}`),
  };
}

export function checkPrismaRuntime({
  platform = process.platform,
  arch = process.arch,
  resolveFiles = resolveEngineFiles,
  loadNative = createRequire(import.meta.url),
  runSchema = spawnSync,
} = {}) {
  const target = prismaEngineTarget(platform, arch);
  const files = resolveFiles(target);
  // require() links the actual generated native addon, failing on missing
  // libssl/libcrypto or incompatible libc rather than deferring to startup.
  loadNative(files.query);
  const result = runSchema(files.schema, ["--version"], {
    timeout: 10_000,
    maxBuffer: 8_192,
    encoding: "utf8",
    env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" },
  });
  if (
    result.error ||
    result.status !== 0 ||
    !/^schema-engine-cli\s+[a-f0-9]{40}\s*$/m.test(result.stdout ?? "")
  ) {
    throw new Error(
      "Prisma schema engine failed its bounded native startup check",
    );
  }
  return target;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(
      `Prisma native query/schema engines verified: ${checkPrismaRuntime()}`,
    );
  } catch {
    // Do not dump child output, inherited environment, or database URLs.
    console.error(
      "Prisma image smoke check failed: verify generated engines and OpenSSL 3 libraries",
    );
    process.exitCode = 1;
  }
}
