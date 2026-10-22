// Run only after explicit operator authority with a clean child environment.
// No tsx watch, dotenv, --env-file, NODE_OPTIONS, npm or pnpm launchers.
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createRequire } from "node:module";
import { assertNoGeneratedPrismaEnvironment, loadIdentityAcceptanceApplication } from "./identityAcceptancePreflight.js";

try {
  const path = process.argv[2];
  if (process.argv.length !== 3 || !path || !isAbsolute(path) || process.execArgv.length) {
    throw new Error("An absolute reviewed manifest path and plain Node invocation are required.");
  }
  const manifest: unknown = JSON.parse(readFileSync(path, "utf8"));
  const { application, permit } = await loadIdentityAcceptanceApplication(process.env, manifest, async () => {
    // Resolve paths only; no require/import of Prisma occurs before this check.
    const require = createRequire(import.meta.url);
    const databaseRequire = createRequire(require.resolve("@vaettir/db"));
    const clientRequire = createRequire(databaseRequire.resolve("@prisma/client"));
    const generated = clientRequire.resolve(".prisma/client/index");
    assertNoGeneratedPrismaEnvironment(readFileSync(generated, "utf8"));
    return import("./serverApplication.js");
  });
  await application.startApiServer(permit);
} catch {
  // Never echo keys, environment values, database URL or raw loader errors.
  console.error("Identity acceptance startup refused. Check the reviewed manifest and clean environment.");
  process.exitCode = 1;
}
