// Windows-only isolated PostgreSQL fixture. Never reads a configured database URL,
// provider secret, existing cluster or .env. Retains its stopped data for review.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

assert.equal(process.platform, "win32", "Use the documented Windows PostgreSQL fixture");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
assert.ok(process.argv.slice(2).every(arg => arg === "--generated-baseline"), "Unknown fixture argument");
const migrationMode = process.argv.includes("--generated-baseline") ? "generated-baseline" : "historical-chain";
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
const files = ["scripts/identity-directory-postgres.mjs", "scripts/identity-migration-canary.sql", "apps/api/src/services/identityDirectoryStore.integration.test.ts",
  "apps/api/src/services/identityDirectoryStore.ts", "packages/db/src/constraintCheckedClient.ts", "packages/db/src/index.ts",
  "packages/db/prisma/schema.prisma", "packages/db/prisma/migrations/20261022025000_identity_directory_observations/migration.sql", "pnpm-lock.yaml"];
const migrationsRoot = join(root, "packages/db/prisma/migrations");
const migrationNames = readdirSync(migrationsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
assert.ok(migrationNames.length > 0 && migrationNames.every(name => /^[0-9]{14}_[a-z0-9_]+$/.test(name)), "Unexpected migration inventory");
const migrationHashes = Object.fromEntries(migrationNames.map(name => [name,
  createHash("sha256").update(readFileSync(join(migrationsRoot, name, "migration.sql"))).digest("hex")]));
const owner = { purpose: "identity-directory-postgres-fixture", fixture, data, database, port,
  migrationMode, migrationHashes,
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
  const psql = (sql, db = database) => run(join(pgBin, "psql.exe"), ["-X", "-t", "-A", "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql });
  psql(`CREATE DATABASE "${database}";`, "postgres");
  const testEnv = { ...env, DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${database}?schema=public&connection_limit=5`,
    VAETTIR_IDENTITY_POSTGRES_FIXTURE: fixture };
  if (migrationMode === "historical-chain") {
    // Copy only reviewed schema/migration source into the owned fixture so
    // Prisma cannot discover repository .env files or a configured datasource.
    const schema = join(fixture, "schema.prisma");
    copyFileSync(join(root, "packages/db/prisma/schema.prisma"), schema);
    const migrations = join(fixture, "migrations"); mkdirSync(migrations);
    copyFileSync(join(migrationsRoot, "migration_lock.toml"), join(migrations, "migration_lock.toml"));
    const copyMigration = name => {
      mkdirSync(join(migrations, name));
      copyFileSync(join(migrationsRoot, name, "migration.sql"), join(migrations, name, "migration.sql"));
    };
    const identityMigrations = ["20261021190000_identity_access_draft", "20261022025000_identity_directory_observations"];
    assert.deepEqual(migrationNames.slice(-2), identityMigrations, "Review upgrade boundary when migration inventory changes");
    migrationNames.slice(0, -2).forEach(copyMigration);
    const deploy = () => run(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schema], { cwd: fixture, env: testEnv });
    writeFileSync(join(fixture, "baseline-migrations.txt"), deploy());
    psql(readFileSync(join(root, "scripts/identity-migration-canary.sql"), "utf8"));
    const readNative = () => JSON.parse(psql(`SELECT json_build_object(
      'tiers', (SELECT json_agg(t ORDER BY t.id) FROM "PlanTier" t),
      'organizations', (SELECT json_agg(o ORDER BY o.id) FROM "Organization" o),
      'users', (SELECT json_agg(u ORDER BY u.id) FROM "User" u),
      'memberships', (SELECT json_agg(m ORDER BY m.id) FROM "Membership" m));`));
    const nativeBefore = readNative();
    writeFileSync(join(fixture, "native-before.json"), JSON.stringify(nativeBefore, null, 2));
    copyMigration(identityMigrations[0]);
    writeFileSync(join(fixture, "draft-migration.txt"), deploy());
    psql(`INSERT INTO "IdentityAccessDraft" ("organizationId", "revision", "configuration", "updatedAt")
      VALUES ('identity-upgrade-active', 7, '{"schemaVersion":1,"roles":[],"groups":[]}', '2026-01-01');`);
    const readDraft = () => JSON.parse(psql('SELECT json_agg(d ORDER BY d."organizationId") FROM "IdentityAccessDraft" d;'));
    const draftBefore = readDraft();
    copyMigration(identityMigrations[1]);
    writeFileSync(join(fixture, "journal-migration.txt"), deploy());
    // A second deployment must be a no-op with the same completed receipts.
    writeFileSync(join(fixture, "migration-replay.txt"), deploy());
    const receipts = JSON.parse(psql('SELECT COALESCE(json_agg(row_to_json(m)), \'[]\'::json) FROM (SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations" ORDER BY migration_name) m;'));
    assert.deepEqual(receipts?.map(row => row.migration_name), migrationNames, "Migration receipts must match the exact committed inventory");
    for (const row of receipts) {
      assert.equal(row.checksum, migrationHashes[row.migration_name]);
      assert.equal(row.finished, true); assert.equal(row.rolled_back, false);
    }
    writeFileSync(join(fixture, "migration-receipts.json"), JSON.stringify(receipts, null, 2));
    const nativeAfter = readNative();
    assert.deepEqual(nativeAfter, nativeBefore, "Identity migrations must preserve native rows including roles, seats, subjects and suspension");
    assert.deepEqual(readDraft(), draftBefore, "Directory migration must preserve draft revision and contents");
    assert.equal(psql('SELECT (SELECT count(*) FROM "IdentityDirectoryConnection") + (SELECT count(*) FROM "IdentityDirectorySubject") + (SELECT count(*) FROM "IdentityDirectoryReceipt");').trim(), "0", "Migration must not activate connections or create grants");
    writeFileSync(join(fixture, "native-after.json"), JSON.stringify(nativeAfter, null, 2));
    writeFileSync(join(fixture, "upgrade-checks.json"), JSON.stringify({ migrations: receipts.length,
      nativeRowsUnchanged: true, draftUnchanged: true, journalEmpty: true, redeployNoOp: true }, null, 2));
  } else {
  // Known previous identity checkpoint, rather than any live database dump.
  const baseline = run("git", ["show", "cf16363da8193dc58488560d6ad529c2b99714b0:packages/db/prisma/schema.prisma"]);
  const schema = join(fixture, "baseline.prisma"); writeFileSync(schema, baseline);
  psql(run(process.execPath, [prismaCli, "migrate", "diff", "--from-empty", "--to-schema-datamodel", schema, "--script"], { cwd: fixture }));
  psql(readFileSync(join(root, "packages/db/prisma/migrations/20261022025000_identity_directory_observations/migration.sql"), "utf8"));
  }
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
  scope: `local PostgreSQL17, ${migrationMode}; not populated production upgrade/provider/deployment acceptance` }, null, 2));
  console.log(`Retained fixture evidence: ${fixture}`);
}
