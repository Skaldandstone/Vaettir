import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const source = readFileSync(new URL("../Dockerfile.api", import.meta.url), "utf8");
const command = JSON.parse(source.match(/^CMD (\[.*\])$/m)[1]);
const shell = process.platform === "win32"
  ? join(process.env.ProgramFiles ?? "C:/Program Files", "Git/bin/bash.exe") : "/bin/sh";
const url = "postgresql://synthetic:p%24ss@localhost/fixture?schema=public&literal=$(no-command)";

// Execute the real shell command with synthetic node/package-manager delegates.
// No actual resolver, Prisma engine, database, server or package manager runs.
function startup({ resolverExit = 0, migrationExit = 0, serverExit = 0, resolved = url } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "vaettir-api-startup-"));
  mkdirSync(join(cwd, "bin"));
  const node = `#!/bin/sh
case "$1" in
  apps/api/dist/printDatabaseUrl.js)
    printf 'resolve\\n' >> trace
    printf '%s' "$SYNTHETIC_RESOLVED_URL"
    exit "$SYNTHETIC_RESOLVER_EXIT" ;;
  packages/db/node_modules/prisma/build/index.js)
    printf 'migrate\\n' >> trace
    printf '%s\\n' "$@" > migration-args
    printf '%s' "$DATABASE_URL" > migration-env
    exit "$SYNTHETIC_MIGRATION_EXIT" ;;
  apps/api/dist/server.js)
    printf 'server\\n' >> trace
    printf '%s' "$DATABASE_URL" > server-env
    exit "$SYNTHETIC_SERVER_EXIT" ;;
  *) exit 99 ;;
esac
`;
  writeFileSync(join(cwd, "bin/node"), node, { mode: 0o755 });
  for (const name of ["pnpm", "npm", "npx", "corepack"])
    writeFileSync(join(cwd, "bin", name), "#!/bin/sh\nprintf 'package-manager\\n' >> trace\nexit 98\n", { mode: 0o755 });
  assert.deepEqual(command.slice(0, 2), ["sh", "-c"]);
  const result = spawnSync(shell, ["-c", 'PATH="$PWD/bin:$PATH"; export PATH; ' + command[2]], {
    cwd, encoding: "utf8", timeout: 5000,
    env: { ...process.env, DATABASE_URL: "old-synthetic-value", SYNTHETIC_RESOLVED_URL: resolved,
      SYNTHETIC_RESOLVER_EXIT: String(resolverExit), SYNTHETIC_MIGRATION_EXIT: String(migrationExit),
      SYNTHETIC_SERVER_EXIT: String(serverExit) },
  });
  assert.ifError(result.error); assert.equal(result.signal, null);
  const read = name => existsSync(join(cwd, name)) ? readFileSync(join(cwd, name), "utf8") : null;
  return { result, read, trace: read("trace")?.trim().split("\n") };
}

test("startup resolves and exports the same URL, migrates through packaged CLI, then starts server", () => {
  const r = startup(); assert.equal(r.result.status, 0);
  assert.deepEqual(r.trace, ["resolve", "migrate", "server"]);
  assert.equal(r.read("migration-env"), url); assert.equal(r.read("server-env"), url);
  assert.deepEqual(r.read("migration-args").trim().split("\n"), [
    "packages/db/node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "packages/db/prisma/schema.prisma",
  ]);
  assert.equal(r.result.stdout, ""); assert.equal(r.result.stderr, "");
});

test("resolver failure cannot be masked by export, even with partial stdout", () => {
  const r = startup({ resolverExit: 31 }); assert.equal(r.result.status, 31);
  assert.deepEqual(r.trace, ["resolve"]); assert.equal(r.read("migration-env"), null); assert.equal(r.read("server-env"), null);
});

test("empty resolved URL stops before migration", () => {
  const r = startup({ resolved: "" }); assert.notEqual(r.result.status, 0); assert.deepEqual(r.trace, ["resolve"]);
});

test("failed migration stops startup without retry or server launch", () => {
  const r = startup({ migrationExit: 23 }); assert.equal(r.result.status, 23);
  assert.deepEqual(r.trace, ["resolve", "migrate"]); assert.equal(r.read("server-env"), null);
});

test("server exit is propagated after successful migration", () => {
  const r = startup({ serverExit: 17 }); assert.equal(r.result.status, 17);
  assert.deepEqual(r.trace, ["resolve", "migrate", "server"]);
  assert.match(command[2], /&& exec node apps\/api\/dist\/server\.js$/);
});

test("CI migration also uses packaged CLI with an explicit schema", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const migrations = ci.split(/\r?\n/).filter(line => line.includes("migrate deploy"));
  assert.deepEqual(migrations.map(line => line.trim()), [
    "run: node packages/db/node_modules/prisma/build/index.js migrate deploy --schema packages/db/prisma/schema.prisma",
  ]);
});
