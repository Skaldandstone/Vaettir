// Windows-only isolated PostgreSQL fixture. Never reads a configured database URL,
// provider secret, existing cluster or .env. Retains its stopped data for review.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

assert.equal(process.platform, "win32", "Use the documented Windows PostgreSQL fixture");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pgBin = "C:/Program Files/PostgreSQL/17/bin";
for (const executable of ["initdb.exe", "pg_ctl.exe", "psql.exe"]) assert.ok(existsSync(join(pgBin, executable)), "PostgreSQL17 tools required");
const requireApi = createRequire(join(root, "apps/api/package.json"));
const requireDb = createRequire(join(root, "packages/db/package.json"));
const prismaCli = join(dirname(requireDb.resolve("prisma/package.json")), "build/index.js");
const vitestCli = join(dirname(requireApi.resolve("vitest/package.json")), "vitest.mjs");
const env = {};
for (const key of ["SystemRoot", "WINDIR", "PATH", "Path", "TEMP", "TMP", "USERPROFILE", "COMSPEC", "PATHEXT"])
  if (process.env[key]) env[key] = process.env[key];
env.NODE_ENV = "test";
env.NO_COLOR = "1";
function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, windowsHide: true, encoding: "utf8", timeout: 60000,
    maxBuffer: 16 * 1024 * 1024, env, ...options });
  if (result.error || result.status !== 0) {
    // Only isolated fixture tools run here; never include an inherited env.
    throw new Error(`Fixture command failed: ${args[0] ?? executable}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
  return result.stdout ?? "";
}
const local = join(root, ".local"); mkdirSync(local, { recursive: true });
const fixture = mkdtempSync(join(local, "identity-postgres-"));
const data = join(fixture, "data");
const database = `vaettir_identity_test_${Date.now()}`;
const reservation = createServer();
await new Promise((done, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", done); });
const port = reservation.address().port;
await new Promise(done => reservation.close(done));
assert.notEqual(port, 5432, "Existing local database port is out of scope");
const files = ["scripts/identity-directory-postgres.mjs", "apps/api/src/services/identityDirectoryStore.integration.test.ts",
  "apps/api/src/services/identityDirectoryStore.ts", "packages/db/src/constraintCheckedClient.ts", "packages/db/src/index.ts",
  "packages/db/prisma/schema.prisma", "packages/db/prisma/migrations/20261022025000_identity_directory_observations/migration.sql", "pnpm-lock.yaml"];
const owner = { purpose: "identity-directory-postgres-fixture", fixture, data, database, port,
  source: run("git", ["rev-parse", "HEAD"]).trim(), postgresVersion: run(join(pgBin, "pg_ctl.exe"), ["--version"]).trim(),
  fileHashes: Object.fromEntries(files.map(file => [file, createHash("sha256").update(readFileSync(join(root, file))).digest("hex")])) };
writeFileSync(join(fixture, "owner.json"), JSON.stringify(owner, null, 2));
let started = false;
let passed = false;
try {
  // Trust is limited to this newly initialized synthetic loopback cluster; no
  // production credentials, Windows accounts or existing database roles change.
  run(join(pgBin, "initdb.exe"), ["-D", data, "-U", "postgres", "--auth=trust", "--encoding=UTF8", "--locale=C"]);
  // On Windows the detached server can retain pg_ctl's piped handles even with
  // -l. Ignore launcher stdio; the owned log remains the startup diagnostic.
  run(join(pgBin, "pg_ctl.exe"), ["-D", data, "-l", join(fixture, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "-t", "30", "start"], { stdio: "ignore" });
  started = true;
  const psql = (sql, db = database) => run(join(pgBin, "psql.exe"), ["-X", "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql });
  psql(`CREATE DATABASE "${database}";`, "postgres");
  // Known previous identity checkpoint, rather than any live database dump.
  const baseline = run("git", ["show", "cf16363da8193dc58488560d6ad529c2b99714b0:packages/db/prisma/schema.prisma"]);
  const schema = join(fixture, "baseline.prisma"); writeFileSync(schema, baseline);
  psql(run(process.execPath, [prismaCli, "migrate", "diff", "--from-empty", "--to-schema-datamodel", schema, "--script"], { cwd: fixture }));
  psql(readFileSync(join(root, "packages/db/prisma/migrations/20261022025000_identity_directory_observations/migration.sql"), "utf8"));
  const testEnv = { ...env, DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${database}?schema=public&connection_limit=5`,
    VAETTIR_IDENTITY_POSTGRES_FIXTURE: fixture };
  const output = run(process.execPath, [vitestCli, "run", "src/services/identityDirectoryStore.integration.test.ts"], {
    cwd: join(root, "apps/api"), env: testEnv, timeout: 60000,
  });
  writeFileSync(join(fixture, "tests.txt"), output);
  process.stdout.write(output);
  passed = true;
} finally {
  // Scoped stop only: never discovers/stops a Windows service or another cluster.
  if (started || existsSync(join(data, "postmaster.pid"))) {
    const marker = JSON.parse(readFileSync(join(fixture, "owner.json"), "utf8"));
    assert.equal(marker.data, data); assert.equal(marker.port, port);
    run(join(pgBin, "pg_ctl.exe"), ["-D", data, "-m", "fast", "-w", "-t", "30", "stop"], { stdio: "ignore" });
  }
  writeFileSync(join(fixture, "result.json"), JSON.stringify({ ...owner, passed, stopped: !existsSync(join(data, "postmaster.pid")),
    scope: "local PostgreSQL17, prior generated schema plus journal migration; not historical migrations/provider/deployment acceptance" }, null, 2));
  console.log(`Retained fixture evidence: ${fixture}`);
}
