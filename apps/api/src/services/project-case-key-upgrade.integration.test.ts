import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PrismaClient, Prisma } from "@vaettir/db";
import { assertOwnedTestDatabase } from "../testOnlyDatabaseSafety.js";
import { waitForOwnedEmptyFixtureDatabase,type OwnedFixtureDatabase } from "../testOnlyFixtureDatabaseCleanup.js";
import { saveProjectCaseKey, resolveProjectCaseReference } from "./projectCaseKeys.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OLD_SCHEMA_SHA = "641a8219eea8e46df07f54b2a82f7fccec45293b969795dc936699df511a563e";
const CURRENT_SCHEMA_SHA = "a9aac0fb2b547921f83deb214d1fb6823877f346b75eab0d2273f4aae5bc369d";
const OLD_MIGRATIONS_SHA = "3d85e91fddfa359cf3d4ab0e149be51c306d6bc288f89ab4406424b3e3e2c730";
const NEW_MIGRATION = "20261012090000_project_case_key_aliases";
const NEW_MIGRATION_SHA = "4bf9422e94fb21186567317301ce515b416b1a1c1df2d0c74c4fa83ac5e287c6";
// This proof targets the historical 97->98 transition. Keep its genuine
// whole-byte endpoint frozen when later additive migrations extend the product.
const SCHEMA_98 = join(ROOT, "apps/api/src/services/fixtures/project-case-key/schema98.prisma");
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function admitInstalledClient(store: string, packageDirectory: string) {
  const within = relative(store, packageDirectory);
  assert.ok(within && !isAbsolute(within) && within !== ".." && !within.startsWith(".." + sep));
  assert.ok(packageDirectory.endsWith(join("node_modules", "@prisma", "client")));
  return packageDirectory;
}
function lf(value: string) {
  assert.ok(!value.includes("\r") || !value.replaceAll("\r\n", "").includes("\r"));
  return value.replaceAll("\r\n", "\n");
}
function schemaTokens(value: string) {
  // Consume every byte except inter-token formatting whitespace. Maximal
  // identifiers/numbers prevent whitespace removal from joining tokens;
  // quoted values/escapes and comments remain exact, ordered token contents.
  const text = lf(value), tokens: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    const rest = text.slice(offset);
    const whitespace = /^[ \t\n]+/.exec(rest);
    if (whitespace) { offset += whitespace[0].length; continue; }
    const token = /^(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\[^\n])*"|[A-Za-z_][A-Za-z0-9_]*|[0-9]+(?:\.[0-9]+)?|@@?|[{}()[\],.:=?+-])/.exec(rest);
    assert.ok(token, "Unrecognized schema token at byte " + offset);
    tokens.push(token[0]); offset += token[0].length;
  }
  return tokens;
}
function assertSchemaFormattingOnly(emitted: string, original: string) {
  assert.deepEqual(schemaTokens(emitted), schemaTokens(original));
}
export function exactOldSchema(current: string) {
  const text = lf(current); assert.equal(sha(text), CURRENT_SCHEMA_SHA);
  const changed = "  // Live labels use this prefix plus immutable caseNumber. Historical prefixes\n  // remain reserved aliases; stored displayId and frozen evidence never change.";
  const original = "  // Database allocation covers imports and older clients too. Once a number\n  // has been allocated the prefix cannot change, so references stay stable.";
  assert.equal(text.split(changed).length, 2);
  let old = text.replace(changed, original)
    .replace("  caseKeyRevision              Int                      @default(0)\n", "")
    .replace("  @@unique([id, organizationId])\n", "");
  const start = old.indexOf("// Prefix reservation is project/organization-scoped");
  const end = old.indexOf("// Requirement wording/direct-link baselines", start);
  assert.ok(start > 0 && end > start); old = old.slice(0, start) + old.slice(end);
  assert.equal(sha(old), OLD_SCHEMA_SHA); // WHOLE bytes from actual 90341958 schema.
  return old;
}
function migrationInputs() {
  const base = join(ROOT, "packages/db/prisma/migrations");
  const names = readdirSync(base).filter(name => name <= NEW_MIGRATION && existsSync(join(base, name, "migration.sql"))).sort();
  assert.equal(names.length, 98); assert.equal(names[97], NEW_MIGRATION);
  const files = names.map(name => ({ name, sql: lf(readFileSync(join(base, name, "migration.sql"), "utf8")) }));
  const manifest = files.slice(0, 97).map(({ name, sql }) => ({ name, sha256: sha(sql), bytes: Buffer.byteLength(sql) }));
  assert.equal(sha(JSON.stringify(manifest)), OLD_MIGRATIONS_SHA);
  assert.equal(sha(files[97]!.sql), NEW_MIGRATION_SHA);
  return { files, manifest };
}
const q = (value: string) => { assert.match(value, /^[A-Za-z_][A-Za-z0-9_]{0,127}$/); return '"' + value + '"'; };
type RowEvidence = { table: string; count: number; sha256: string };
async function inventory(client: PrismaClient, stripRevision = false) {
  const tables = await client.$queryRaw<Array<{ name: string }>>`SELECT tablename::text AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename COLLATE "C"`;
  assert.ok(tables.length >= 100 && tables.length <= 200);
  const output: RowEvidence[] = [];
  let totalBytes = 0;
  for (const { name } of tables) {
    const table = Prisma.raw(q(name));
    const expression = stripRevision && name === "Project" ? Prisma.sql`to_jsonb(t)-'caseKeyRevision'` : Prisma.sql`to_jsonb(t)`;
    const [size] = await client.$queryRaw<Array<{ count: bigint; bytes: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS count,coalesce(sum(octet_length((${expression})::text)),0)::bigint AS bytes FROM ${table} t`);
    assert.ok(size && size.count <= 1000n && size.bytes <= 4194304n);
    totalBytes += Number(size.bytes); assert.ok(totalBytes <= 4194304);
    const rows = await client.$queryRaw<Array<{ data: Prisma.JsonValue }>>(Prisma.sql`SELECT ${expression} AS data FROM ${table} t ORDER BY (${expression})::text COLLATE "C"`);
    assert.equal(rows.length, Number(size.count));
    output.push({ table: name, count: rows.length, sha256: sha(JSON.stringify(rows.map(row => row.data))) });
  }
  return output;
}
async function ledger(client: PrismaClient) {
  return client.$queryRaw<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null; applied_steps_count: number }>>`
    SELECT migration_name,checksum,finished_at,rolled_back_at,applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name`;
}
async function schemaEvidence(client: PrismaClient) {
  // Complete native schema definition/constraints/indexes/functions/triggers.
  // OIDs are not portable across a real restore, so compare actual definitions.
  return client.$queryRaw<Array<{ kind: string; name: string; body: string }>>`
    SELECT 'column'::text AS kind,c.relname||'.'||a.attname AS name,
      concat(format_type(a.atttypid,a.atttypmod),'|',a.attnotnull,'|',coalesce(pg_get_expr(d.adbin,d.adrelid),'')) AS body
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
    UNION ALL SELECT 'constraint',c.relname||'.'||k.conname,pg_get_constraintdef(k.oid,true)
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    UNION ALL SELECT 'index',indexname,indexdef FROM pg_indexes WHERE schemaname='public'
    UNION ALL SELECT 'function',p.proname,pg_get_functiondef(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
    UNION ALL SELECT 'trigger',c.relname||'.'||t.tgname,pg_get_triggerdef(t.oid,true)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
    UNION ALL SELECT 'enum',t.typname,jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)::text
      FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' GROUP BY t.typname
    ORDER BY kind,name,body`;
}
describe("closed old97 upgrade source contracts", () => {
  it("reconstructs genuine whole-byte 90341958 schema and rejects any other edit", () => {
    const source = readFileSync(SCHEMA_98, "utf8");
    expect(sha(exactOldSchema(source))).toBe(OLD_SCHEMA_SHA);
    expect(() => exactOldSchema(source + "\n")).toThrow();
    expect(() => exactOldSchema(source.replace("model User", "model ChangedUser"))).toThrow();
    expect(migrationInputs().manifest).toHaveLength(97);
  });
  it("admits only the installed pnpm client package, never a foreign dependency or adjacent store", () => {
    const store = join(ROOT, "node_modules/.pnpm");
    const installed = join(store, "@prisma+client@6", "node_modules/@prisma/client");
    expect(admitInstalledClient(store, installed)).toBe(installed);
    expect(() => admitInstalledClient(store, join(ROOT, "foreign/node_modules/@prisma/client"))).toThrow();
    expect(() => admitInstalledClient(store, join(ROOT, "node_modules/.pnpm-foreign/node_modules/@prisma/client"))).toThrow();
    expect(() => admitInstalledClient(store, join(store, "foreign/node_modules/@prisma/other"))).toThrow();
    expect(() => admitInstalledClient(store, store)).toThrow();
  });
  it("accepts formatting only, retaining every model, field, annotation, string, comment and token boundary", () => {
    const schema = '// Exact comment\nmodel Example {\n  id String @id @default(cuid())\n  label String @default("literal  spaces \\" | value")\n  otherId String?\n  other Other? @relation(fields: [otherId], references: [id], onDelete: Restrict)\n  @@index([label, otherId])\n}\n';
    const formatted = schema.replace("  id String", "  id      String").replace("  label String", "  label   String")
      .replace("fields: [otherId], references:", "fields: [otherId],   references:").replaceAll("\n", "\r\n");
    expect(() => assertSchemaFormattingOnly(formatted, schema)).not.toThrow();
    for (const changed of [
      schema.replace("model Example", "model OtherExample"), schema.replace("id String", "id Int"),
      schema.replace("otherId String?", "differentId String?"), schema.replace("String?", "String"),
      schema.replace("Restrict", "Cascade"), schema.replace("[label, otherId]", "[otherId, label]"),
      schema.replace("literal  spaces", "literal spaces"), schema.replace("Exact comment", "Changed comment"),
      schema.replace("id String", "idString"), schema + "model Extra { id String @id }\n",
    ]) expect(() => assertSchemaFormattingOnly(changed, schema)).toThrow();
    const old = exactOldSchema(readFileSync(SCHEMA_98, "utf8"));
    expect(() => assertSchemaFormattingOnly(old.replace(/^ {2}([A-Za-z_][A-Za-z0-9_]*) +/gm, "    $1   "), old)).not.toThrow();
  });
});

describe.skipIf(process.platform !== "linux" || (process.env.CI !== "true" && process.env.GITHUB_ACTIONS !== "true"))("genuine old97 client, 97→98 upgrade and separate database restore (CI synthetic only)", () => {
  it("preserves original rows/history, accepts old allocation, refuses old key rewrites, restores both97 and98 without downmigration", async () => {
    assert.equal(assertOwnedTestDatabase(process.env.DATABASE_URL).route, "GITHUB_SERVICE");
    assert.equal(process.platform, "linux"); assert.ok(process.env.RUNNER_TEMP);
    const currentSchema = lf(readFileSync(SCHEMA_98, "utf8"));
    const oldSchema = exactOldSchema(currentSchema), { files, manifest } = migrationInputs();
    const work = mkdtempSync(join(process.env.RUNNER_TEMP!, "vaettir-key-upgrade-"));
    const token = randomUUID(), marker = "vaettir-97-98-synthetic:" + token;
    const baseUrl = new URL(process.env.DATABASE_URL!);
    assert.ok(baseUrl.username && baseUrl.password);
    const started = Date.now(), timestamp = Date.now();
    const databases = [0, 1, 2].map(offset => "vaettir_day_test_" + (timestamp + offset));
    const urls = databases.map(name => { const url = new URL(baseUrl); url.pathname = "/" + name; assertOwnedTestDatabase(url.toString()); return url.toString(); });
    const clients: PrismaClient[] = [], created = new Set<string>();
    const bootstrap = new PrismaClient({ datasources: { db: { url: baseUrl.toString() } } });
    // The server image is16, not necessarily the runner's client installation.
    // Prefer16; a newer installed trio must report one matching actual major.
    // No package installation, Docker bootstrap or mismatch fallback.
    const toolDirectory = readdirSync("/usr/lib/postgresql").filter(v => /^[0-9]+$/.test(v) && Number(v) >= 16)
      .sort((a, b) => Number(a) - Number(b)).map(v => "/usr/lib/postgresql/" + v + "/bin")
      .find(path => ["psql", "pg_dump", "pg_restore"].every(name => existsSync(join(path, name))));
    assert.ok(toolDirectory);
    const tools = ["psql", "pg_dump", "pg_restore"].map(name => join(toolDirectory, name));
    const run = (command: string, args: string[], env = process.env, binary = false) => {
      assert.ok(Date.now() - started < 210000);
      try {
        return execFileSync(command, args, { cwd: join(ROOT, "packages/db"), env, encoding: binary ? undefined : "utf8", timeout: 90000, maxBuffer: 64 * 1024 * 1024 });
      } catch (error) {
        const failure = error as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number | null };
        // Retain exact synthetic command output locally, never connection URLs
        // or credentials in CI stdout/exception messages.
        const redact = (value: Buffer | string | undefined) => String(value ?? "").replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/g, "[database-url-redacted]").replaceAll(baseUrl.password, "[password-redacted]");
        writeFileSync(join(work, "command-failure.json"), JSON.stringify({ command: command.split("/").at(-1), status: failure.status,
          stdoutSha256: sha(String(failure.stdout ?? "")), stderrSha256: sha(String(failure.stderr ?? "")),
          stdout: redact(failure.stdout), stderr: redact(failure.stderr) }, null, 2), { flag: "wx" });
        if (error instanceof Error) {
          error.message = redact(error.message); error.stack = redact(error.stack);
          Object.assign(error, { stdout: redact(failure.stdout), stderr: redact(failure.stderr) });
        }
        throw new Error("Synthetic migration proof command refused; retained local diagnostic", { cause: error });
      }
    };
    const pgArgs = (name: string) => ["--host", baseUrl.hostname, "--port", "5432", "--username", decodeURIComponent(baseUrl.username), "--dbname", name];
    const pgEnv = { ...process.env, PGPASSWORD: decodeURIComponent(baseUrl.password) };
    const client = (index: number) => { const c = new PrismaClient({ datasources: { db: { url: urls[index]! } } }); clients.push(c); return c; };
    try {
      const clientVersions = tools.map(tool => String(run(tool, ["--version"])));
      const clientMajors = clientVersions.map(v => /PostgreSQL\) ([0-9]+)\./.exec(v)?.[1]);
      assert.ok(clientMajors.every(v => v === clientMajors[0]) && Number(clientMajors[0]) >= 16);
      const [identity] = await bootstrap.$queryRaw<Array<{ database: string; role: string; owner: string; version: string }>>`
        SELECT current_database()::text AS database,current_user::text AS role,
          pg_get_userbyid(datdba)::text AS owner,current_setting('server_version_num')::text AS version
        FROM pg_database WHERE datname=current_database()`;
      assert.ok(identity && identity.database === "vaettir_test" && identity.role === identity.owner && /^16[0-9]{4}$/.test(identity.version));
      for (const name of databases) {
        assert.equal((await bootstrap.$queryRaw<Array<{ name: string }>>`SELECT datname::text AS name FROM pg_database WHERE datname=${name}`).length, 0);
        await bootstrap.$executeRawUnsafe("CREATE DATABASE " + q(name));
        created.add(name);
        await bootstrap.$executeRawUnsafe("COMMENT ON DATABASE " + q(name) + " IS '" + marker + "'");
      }
      const staged = join(work, "old97"); mkdirSync(join(staged, "migrations"), { recursive: true });
      const oldOutput = join(work, "old-client");
      const generatedSchema = oldSchema.replace('  provider = "prisma-client-js"\n', '  provider = "prisma-client-js"\n  output = "' + oldOutput.replaceAll("\\", "/") + '"\n');
      assert.equal(generatedSchema.replace('  output = "' + oldOutput.replaceAll("\\", "/") + '"\n', ""), oldSchema);
      writeFileSync(join(staged, "schema.prisma"), generatedSchema);
      writeFileSync(join(staged, "migrations/migration_lock.toml"), 'provider = "postgresql"\n');
      for (const file of files.slice(0, 97)) { mkdirSync(join(staged, "migrations", file.name)); writeFileSync(join(staged, "migrations", file.name, "migration.sql"), file.sql); }
      const cliEnv = { ...process.env, DATABASE_URL: urls[0]!, PRISMA_GENERATE_SKIP_AUTOINSTALL: "1", NODE_PATH: join(ROOT, "packages/db/node_modules") };
      const dbRequire = createRequire(join(ROOT, "packages/db/package.json"));
      const installedPackageJson = realpathSync(dbRequire.resolve("@prisma/client/package.json"));
      const installedPackageDirectory = admitInstalledClient(realpathSync(join(ROOT, "node_modules/.pnpm")), dirname(installedPackageJson));
      const installedRequire = createRequire(installedPackageJson);
      const installedIndex = installedRequire.resolve(".prisma/client/index.js");
      const installedDirectory = dirname(installedIndex);
      const workspaceClientFiles = readdirSync(installedDirectory).filter(name => name.endsWith(".js") || name === "schema.prisma" || name.endsWith(".node"));
      const workspaceClientPins = workspaceClientFiles.map(name => ({ name, sha256: sha(readFileSync(join(installedDirectory, name))) }));
      // Prisma resolves this dependency beside its schema, not through NODE_PATH.
      // Link only the exact existing package into this fresh temporary schema;
      // never install a package or change the workspace generated client.
      const stagedClient = join(staged, "node_modules/@prisma/client");
      mkdirSync(dirname(stagedClient), { recursive: true });
      assert.equal(existsSync(stagedClient), false);
      symlinkSync(installedPackageDirectory, stagedClient, "dir");
      assert.equal(realpathSync(stagedClient), installedPackageDirectory);
      assert.equal(realpathSync(createRequire(join(staged, "schema.prisma")).resolve("@prisma/client/package.json")), installedPackageJson);
      run("pnpm", ["exec", "prisma", "generate", "--schema", join(staged, "schema.prisma")], cliEnv);
      assert.deepEqual(workspaceClientFiles.map(name => ({ name, sha256: sha(readFileSync(join(installedDirectory, name))) })), workspaceClientPins);
      assert.equal(sha(oldSchema), OLD_SCHEMA_SHA);
      assertSchemaFormattingOnly(readFileSync(join(oldOutput, "schema.prisma"), "utf8"), generatedSchema);
      const oldIndex = readFileSync(join(oldOutput, "index.js"), "utf8");
      assert.ok(oldIndex.includes("./runtime/library.js")); assert.ok(!/caseKeyRevision|ProjectCaseKeyAlias|ProjectCaseKeyWrite/.test(oldIndex));
      const oldRuntime = readFileSync(join(oldOutput, "runtime/library.js"));
      assert.equal(sha(oldRuntime), sha(readFileSync(dbRequire.resolve("@prisma/client/runtime/library.js"))));
      run("pnpm", ["exec", "prisma", "migrate", "deploy", "--schema", join(staged, "schema.prisma")], cliEnv);
      const require = createRequire(import.meta.url);
      const oldModule = require(join(oldOutput, "index.js")) as { PrismaClient: typeof PrismaClient };
      const oldClient = new oldModule.PrismaClient({ datasources: { db: { url: urls[0]! } } }); clients.push(oldClient);
      const tier = await oldClient.planTier.create({ data: { key: token, name: "Synthetic97", sortOrder: 0, minFullSeats: 1 } });
      const org = await oldClient.organization.create({ data: { name: token, slug: token, planTierId: tier.id } });
      const actor = await oldClient.user.create({ data: { clerkUserId: token, email: token + "@example.com", memberships: { create: { organizationId: org.id, role: "OWNER", seatType: "FULL" } } } });
      const project = await oldClient.project.create({ data: { organizationId: org.id, name: "Synthetic97", slug: token, caseKey: "upgrade-old" } });
      const tc = await oldClient.testCase.create({ data: { projectId: project.id, title: "Exact original97 case", testType: "FUNCTIONAL", given: ["original setup\nline two"], when: ["original action"], then: ["original result"], tags: ["literal | tag"] } });
      await oldClient.testCaseStep.create({ data: { testCaseId: tc.id, order: 0, action: "do | literal\nnext line", expectedActionOrData: "", expectedResult: "result\nline two", expectedResponse: null } });
      await oldClient.testCaseSource.create({ data: { testCaseId: tc.id, filePath: "synthetic/97.csv", framework: "synthetic", externalTestId: "SOURCE-97", importSnapshot: { action: "do | literal\nnext line" } } });
      await oldClient.testCaseVersion.create({ data: { testCaseId: tc.id, versionNumber: 1, title: tc.title, given: tc.given, when: tc.when, then: tc.then, tags: tc.tags, steps: [{ action: "frozen\nexact", expectedResult: "" }], priority: "MEDIUM", testType: "FUNCTIONAL", createdById: actor.id } });
      await oldClient.testRun.create({ data: { projectId: project.id, ciProvider: "manual", commitSha: "manual", branch: "manual", startedAt: new Date("2020-01-01T00:00:00Z"),
        manualTestCaseIds: [tc.id], manualPrerequisites: { [tc.id]: { displayId: tc.displayId, procedure: "frozen\nexact" } }, executionContext: { original: "literal evidence" } } });
      const historyRun = await oldClient.testRun.create({ data: { projectId: project.id, ciProvider: "synthetic-offline", commitSha: "synthetic", branch: "fixture", startedAt: new Date("2020-01-01T00:00:00Z") } });
      await oldClient.testResult.create({ data: { testRunId: historyRun.id, testCaseId: tc.id, status: "FAIL", note: "original observation\nunchanged", observations: { literal: 0 } } });
      const before = await inventory(oldClient), beforeLedger = await ledger(oldClient), beforeSchema = await schemaEvidence(oldClient);
      assert.equal(beforeLedger.length, 97);
      beforeLedger.forEach((row, i) => { assert.equal(row.migration_name, manifest[i]!.name); assert.equal(row.checksum, manifest[i]!.sha256); assert.ok(row.finished_at && !row.rolled_back_at && row.applied_steps_count === 1); });
      const dump97 = run(tools[1]!, [...pgArgs(databases[0]!), "--format=custom", "--no-owner", "--no-privileges"], pgEnv, true) as Buffer;
      writeFileSync(join(work, "backup97.dump"), dump97);
      mkdirSync(join(staged, "migrations", NEW_MIGRATION)); writeFileSync(join(staged, "migrations", NEW_MIGRATION, "migration.sql"), files[97]!.sql);
      run("pnpm", ["exec", "prisma", "migrate", "deploy", "--schema", join(staged, "schema.prisma")], cliEnv);
      const current = client(0), after = await inventory(current, true), afterLedger = await ledger(current);
      assert.equal(afterLedger.length, 98); assert.deepEqual(afterLedger.slice(0, 97), beforeLedger);
      const newLedger = afterLedger[97]!; assert.equal(newLedger.checksum, NEW_MIGRATION_SHA); assert.ok(newLedger.finished_at && !newLedger.rolled_back_at && newLedger.applied_steps_count === 1);
      const legacyAfter = after.filter(row => !["ProjectCaseKeyAlias", "ProjectCaseKeyWrite", "_prisma_migrations"].includes(row.table));
      assert.deepEqual(legacyAfter, before.filter(row => row.table !== "_prisma_migrations"));
      const upgradedSchema = await schemaEvidence(current);
      for (const definition of beforeSchema) {
        if (definition.kind === "function" && definition.name === "vaettir_project_case_key") continue;
        assert.ok(upgradedSchema.some(row => row.kind === definition.kind && row.name === definition.name && row.body === definition.body));
      }
      const oldRead = await oldClient.testCase.findUniqueOrThrow({ where: { id: tc.id }, include: { steps: true, source: true, versions: true } });
      assert.equal(oldRead.displayId, "upgrade-old-01"); assert.equal(oldRead.source?.externalTestId, "SOURCE-97");
      const request = { projectId: project.id, originalOrganizationId: org.id, expectedNativeActorId: actor.id, expectedClerkActorId: token, requestId: randomUUID(), expectedCaseKey: "upgrade-old", expectedRevision: 0, caseKey: "upgrade-new" };
      await saveProjectCaseKey(current, actor.id, request, { clerkActorId: token });
      assert.deepEqual(await oldClient.testCase.findUniqueOrThrow({ where: { id: tc.id }, include: { steps: true, source: true, versions: true } }), oldRead);
      await expect(oldClient.project.update({ where: { id: project.id }, data: { caseKey: "bare-old-write" } })).rejects.toThrow();
      const issued = await oldClient.testCase.create({ data: { projectId: project.id, title: "Old client after upgrade", testType: "FUNCTIONAL" } });
      assert.equal(issued.caseNumber, 2); assert.equal(issued.displayId, "upgrade-new-02");
      for (const prefix of ["upgrade-old", "upgrade-new"]) assert.equal((await resolveProjectCaseReference(current, actor.id, project.id, prefix + "-01", { clerkActorId: token }))?.id, tc.id);
      assert.equal((await saveProjectCaseKey(current, actor.id, request, { clerkActorId: token })).replayed, true);
      const full98 = await inventory(current), schema98 = await schemaEvidence(current);
      const dump98 = run(tools[1]!, [...pgArgs(databases[0]!), "--format=custom", "--no-owner", "--no-privileges"], pgEnv, true) as Buffer;
      writeFileSync(join(work, "backup98.dump"), dump98);
      for (const [index, dump] of [[1, dump97], [2, dump98]] as const) {
        const path = join(work, "backup" + (index === 1 ? "97" : "98") + ".dump");
        assert.equal(sha(readFileSync(path)), sha(dump));
        run(tools[2]!, [...pgArgs(databases[index]!), "--exit-on-error", "--no-owner", "--no-privileges", path], pgEnv);
      }
      const restored97 = new oldModule.PrismaClient({ datasources: { db: { url: urls[1]! } } }); clients.push(restored97);
      const restored98 = client(2);
      assert.deepEqual(await inventory(restored97), before); assert.deepEqual(await schemaEvidence(restored97), beforeSchema);
      assert.deepEqual(await inventory(restored98), full98); assert.deepEqual(await schemaEvidence(restored98), schema98);
      assert.deepEqual(await ledger(restored97), beforeLedger); assert.deepEqual(await ledger(restored98), afterLedger);
      assert.equal((await restored97.testCase.findUniqueOrThrow({ where: { id: tc.id } })).displayId, "upgrade-old-01");
      assert.equal((await restored97.testCase.create({ data: { projectId: project.id, title: "Recovered97 old allocation", testType: "FUNCTIONAL" } })).caseNumber, 2);
      assert.deepEqual(await inventory(current), full98); // Source98 was never reset/downmigrated.
      const evidence = { purpose: "synthetic-project-key-97-to-98-upgrade-and-restore", sourceCommit: process.env.GITHUB_SHA, oldClientSchemaCommit: "90341958b941b4e34ac9635aa5c41b8e9d1f5505",
        oldSchemaSha256: OLD_SCHEMA_SHA, sourceMigrationManifestSha256: OLD_MIGRATIONS_SHA, newMigrationSha256: NEW_MIGRATION_SHA,
        serverVersion: identity.version, postgresClientMajor: clientMajors[0], oldClientRuntimeSha256: sha(oldRuntime), workspaceClientUnchanged: true,
        tableFingerprints97Sha256: sha(JSON.stringify(before)), tableFingerprints98Sha256: sha(JSON.stringify(full98)),
        schema97Sha256: sha(JSON.stringify(beforeSchema)), schema98Sha256: sha(JSON.stringify(schema98)), backup97Sha256: sha(dump97), backup98Sha256: sha(dump98),
        syntheticUpgrade: true, genuineOldGeneratedClient: true, syntheticRestore97: true, syntheticRestore98: true,
        productionMigration: false, deployedAcceptance: false, authenticatedAcceptance: false, fullOldApiBinaryAcceptance: false };
      writeFileSync(join(work, "evidence.json"), JSON.stringify(evidence, null, 2), { flag: "wx" });
      console.log("VAETTIR_PROJECT_KEY_UPGRADE_PROOF=" + JSON.stringify(evidence));
    } finally {
      for (const c of clients) await c.$disconnect();
      const cleanupDeadline=Date.now()+2000; // One shared drain budget, not per database.
      // Never terminate sessions/reuse/reset an existing database. Exact fresh
      // owner+purpose marker and no other session are required even for cleanup.
      for (const name of created) {
        const owned=await waitForOwnedEmptyFixtureDatabase(async()=>{
        const [row] = await bootstrap.$queryRaw<Array<OwnedFixtureDatabase>>`
          SELECT pg_get_userbyid(d.datdba)::text AS owner,current_user::text AS role,shobj_description(d.oid,'pg_database') AS marker,
            (SELECT count(*) FROM pg_stat_activity WHERE datname=d.datname)::bigint AS sessions FROM pg_database d WHERE datname=${name}`;
        return row;
        },marker,cleanupDeadline);
        assert.ok(owned && owned.owner === owned.role && owned.marker === marker && owned.sessions === 0n);
        await bootstrap.$executeRawUnsafe("DROP DATABASE " + q(name));
      }
      await bootstrap.$disconnect();
    }
  }, 240000);
});
