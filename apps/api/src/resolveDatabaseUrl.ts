import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

// Composes DATABASE_URL from the RDS-managed master-user secret's live
// username/password, instead of trusting a pre-composed
// `vaettir/database-url` secret that goes stale every time RDS auto-rotates
// the managed password (every 7 days - see docs/AWS_DEPLOYMENT.md, "It goes
// stale every 7 days"). This is permanent fix (b) from that doc.
//
// Extracted as a standalone function (not just an import side effect)
// because the app server isn't the only process that needs a working
// DATABASE_URL: the container's own CMD runs `prisma migrate deploy` as a
// SEPARATE process *before* node server.js ever starts (see Dockerfile.api -
// migrations need to run from inside the VPC, so the running task is the
// only thing with network access to RDS). A first deploy attempt of this
// fix missed that entirely: composing DATABASE_URL only inside server.ts's
// own process left `prisma migrate deploy` with no DATABASE_URL at all once
// the static secret was removed from the task definition - P1012, not the
// P1000 this was meant to fix. printDatabaseUrl.ts (a thin CLI wrapper
// around this same function) is what the Dockerfile CMD now calls first,
// exporting the result into the shell before either the migration or the
// server process runs - see Dockerfile.api's CMD for the exact chain.
//
// Returns undefined (not an error) when DB_SECRET_ID isn't set - "not
// configured to compose one" is a valid state for local dev and any
// deployment that sets DATABASE_URL directly instead.
export async function resolveDatabaseUrlFromManagedSecret(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const secretId = env.DB_SECRET_ID;
  if (!secretId) return undefined;

  const host = env.DB_HOST;
  const port = env.DB_PORT ?? "5432";
  const name = env.DB_NAME ?? "postgres";
  const sslmode = env.DB_SSLMODE ?? "require";
  if (!host) {
    throw new Error("DB_SECRET_ID is set but DB_HOST is missing - both are required to compose DATABASE_URL");
  }

  const client = new SecretsManagerClient({ region: env.AWS_REGION ?? "us-east-2" });
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!response.SecretString) {
    throw new Error(`Secret ${secretId} (DB_SECRET_ID) has no SecretString`);
  }

  const { username, password } = JSON.parse(response.SecretString) as { username?: string; password?: string };
  if (!username || !password) {
    throw new Error(`Secret ${secretId} (DB_SECRET_ID) is missing username/password fields`);
  }

  return `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${name}?sslmode=${sslmode}`;
}

// Inert for local dev and any deployment that already sets DATABASE_URL
// directly (e.g. via .env) - only composes one when DATABASE_URL isn't
// already set and DB_SECRET_ID points at the RDS-managed secret.
//
// Imported first in server.ts, before "@vaettir/db" (which reads
// process.env.DATABASE_URL when its PrismaClient is constructed at module
// load time) - top-level await here blocks that later import until this
// resolves, the same ordering trick "./instrument.js" already relies on.
// Belt-and-suspenders alongside printDatabaseUrl.ts's Dockerfile-level fix:
// harmless if DATABASE_URL is already set by the shell preamble by the time
// this runs (the early return above makes it a no-op), and still correct on
// its own for any future entry point that runs the server without going
// through that CMD chain (e.g. a local `node apps/api/dist/server.js`).
if (!process.env.DATABASE_URL) {
  const resolved = await resolveDatabaseUrlFromManagedSecret();
  if (resolved) process.env.DATABASE_URL = resolved;
}
