import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const SOURCE_NAME = /^vaettir_[a-z0-9_]*restore_source_test$/;
const TARGET_NAME = /^vaettir_[a-z0-9_]*restore_target_test$/;
const ALLOWED_QUERY_KEYS = new Set([
  "schema",
  "connection_limit",
  "pool_timeout",
]);

export function validateRestoreDrillUrls(sourceValue, targetValue) {
  const source = validateUrl(sourceValue, "source", SOURCE_NAME);
  const target = validateUrl(targetValue, "target", TARGET_NAME);
  if (source.database === target.database)
    throw new Error("restore source and target databases must differ");
  for (const key of ["hostname", "port", "username"]) {
    if (source[key] !== target[key])
      throw new Error(`restore source and target ${key} must match`);
  }
  return { source, target };
}

function validateUrl(value, label, databasePattern) {
  if (!value) throw new Error(`${label} database URL is required`);
  const url = new URL(value);
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol))
    throw new Error(`${label} must use PostgreSQL`);
  if (!LOCAL_HOSTS.has(url.hostname))
    throw new Error(`${label} database must be local`);
  if (!url.username) throw new Error(`${label} database user is required`);
  if (
    [...url.searchParams.keys()].some((key) => !ALLOWED_QUERY_KEYS.has(key))
  ) {
    throw new Error(`${label} database URL contains an unsupported option`);
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!databasePattern.test(database)) {
    throw new Error(
      `${label} database name does not match the restore-drill safety pattern`,
    );
  }
  return {
    hostname: url.hostname,
    port: url.port || "5432",
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

export function compareRestoreEvidence(source, target) {
  if (source.migrations.length === 0)
    throw new Error("source has no completed Prisma migrations");
  if (source.tables.length === 0)
    throw new Error("source has no application tables");
  if (JSON.stringify(source) !== JSON.stringify(target)) {
    throw new Error("restored database evidence does not match the source");
  }
  return true;
}

function resolvePgTool(name, env = process.env) {
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  if (env.PG_BIN) {
    const candidate = join(env.PG_BIN, executable);
    if (!existsSync(candidate))
      throw new Error(`${name} was not found under PG_BIN`);
    return candidate;
  }
  if (process.platform === "win32") {
    const root = "C:\\Program Files\\PostgreSQL";
    if (existsSync(root)) {
      const versions = readdirSync(root).sort((a, b) => Number(b) - Number(a));
      for (const version of versions) {
        const candidate = join(root, version, "bin", executable);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return executable;
}

function connectionArgs(config, database = config.database) {
  return [
    "--host",
    config.hostname,
    "--port",
    config.port,
    "--username",
    config.username,
    "--dbname",
    database,
  ];
}

function run(tool, args, config, options = {}, env = process.env) {
  const dockerContainer = env.PG_DOCKER_CONTAINER;
  const command = dockerContainer ? env.DOCKER_COMMAND || "docker" : tool;
  const toolArgs = dockerContainer
    ? args.map((value, index) => {
        if (args[index - 1] === "--host") return "127.0.0.1";
        if (args[index - 1] === "--port") return "5432";
        return value;
      })
    : args;
  const commandArgs = dockerContainer
    ? [
        "exec",
        "-i",
        "--env",
        `PGPASSWORD=${config.password}`,
        dockerContainer,
        tool,
        ...toolArgs,
      ]
    : toolArgs;
  return execFileSync(command, commandArgs, {
    encoding: options.binary ? null : "utf8",
    env: dockerContainer
      ? process.env
      : { ...process.env, PGPASSWORD: config.password },
    input: options.input,
    stdio: [
      options.input ? "pipe" : "ignore",
      options.capture === false ? "inherit" : "pipe",
      "pipe",
    ],
  });
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function readEvidence(psql, config, env) {
  const tablesOutput = run(
    psql,
    [
      ...connectionArgs(config),
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--field-separator",
      "\t",
      "--command",
      "SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;",
    ],
    config,
    {},
    env,
  );
  const tables = tablesOutput
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split("\t"));
  const counts = Object.fromEntries(
    tables.map(([schema, table]) => {
      const count = run(
        psql,
        [
          ...connectionArgs(config),
          "--no-psqlrc",
          "--tuples-only",
          "--no-align",
          "--command",
          `SELECT count(*) FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)};`,
        ],
        config,
        {},
        env,
      ).trim();
      return [`${schema}.${table}`, Number(count)];
    }),
  );
  const migrations = run(
    psql,
    [
      ...connectionArgs(config),
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--command",
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;',
    ],
    config,
    {},
    env,
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  return {
    migrations,
    tables: Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  };
}

function dropTarget(psql, target, env) {
  run(
    psql,
    [
      ...connectionArgs(target, "postgres"),
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${target.database}' AND pid <> pg_backend_pid();`,
    ],
    target,
    {},
    env,
  );
  run(
    psql,
    [
      ...connectionArgs(target, "postgres"),
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      `DROP DATABASE IF EXISTS ${quoteIdentifier(target.database)};`,
    ],
    target,
    {},
    env,
  );
}

export function runLocalRestoreDrill(env = process.env) {
  if (env.ALLOW_LOCAL_RESTORE_DRILL !== "1") {
    throw new Error(
      "set ALLOW_LOCAL_RESTORE_DRILL=1 to confirm the isolated local target may be recreated",
    );
  }
  const { source, target } = validateRestoreDrillUrls(
    env.DATABASE_URL,
    env.RESTORE_DATABASE_URL,
  );
  const pgDump = env.PG_DOCKER_CONTAINER
    ? "pg_dump"
    : resolvePgTool("pg_dump", env);
  const pgRestore = env.PG_DOCKER_CONTAINER
    ? "pg_restore"
    : resolvePgTool("pg_restore", env);
  const psql = env.PG_DOCKER_CONTAINER ? "psql" : resolvePgTool("psql", env);
  const workDir = mkdtempSync(join(tmpdir(), "vaettir-restore-drill-"));
  const dumpPath = join(workDir, "source.dump");
  const startedAt = Date.now();
  let targetCreated = false;

  try {
    const sourceEvidence = readEvidence(psql, source, env);
    const dump = run(
      pgDump,
      [
        ...connectionArgs(source),
        "--format",
        "custom",
        "--no-owner",
        "--no-privileges",
      ],
      source,
      { binary: true },
      env,
    );
    writeFileSync(dumpPath, dump);
    dropTarget(psql, target, env);
    run(
      psql,
      [
        ...connectionArgs(target, "postgres"),
        "--no-psqlrc",
        "--set",
        "ON_ERROR_STOP=1",
        "--command",
        `CREATE DATABASE ${quoteIdentifier(target.database)};`,
      ],
      target,
      {},
      env,
    );
    targetCreated = true;
    run(
      pgRestore,
      [
        ...connectionArgs(target),
        "--exit-on-error",
        "--no-owner",
        "--no-privileges",
      ],
      target,
      { capture: false, input: readFileSync(dumpPath) },
      env,
    );
    const targetEvidence = readEvidence(psql, target, env);
    compareRestoreEvidence(sourceEvidence, targetEvidence);
    return {
      status: "passed",
      sourceDatabase: source.database,
      targetDatabase: target.database,
      migrationCount: sourceEvidence.migrations.length,
      tableCount: sourceEvidence.tables.length,
      rowCount: sourceEvidence.tables.reduce(
        (total, [, count]) => total + count,
        0,
      ),
      dumpSha256: createHash("sha256")
        .update(readFileSync(dumpPath))
        .digest("hex"),
      elapsedMs: Date.now() - startedAt,
      targetRemoved: true,
    };
  } finally {
    if (targetCreated) dropTarget(psql, target, env);
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  basename(process.argv[1]) === basename(fileURLToPath(import.meta.url))
) {
  try {
    process.stdout.write(
      `${JSON.stringify(runLocalRestoreDrill(), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
