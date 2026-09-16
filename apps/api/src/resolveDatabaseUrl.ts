import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

// Composes DATABASE_URL at process startup from the RDS-managed master-user
// secret's live username/password, instead of trusting a pre-composed
// `vaettir/database-url` secret that goes stale every time RDS auto-rotates
// the managed password (every 7 days - see docs/AWS_DEPLOYMENT.md, "It goes
// stale every 7 days"). This is permanent fix (b) from that doc: every fresh
// process start now always has a working password, with nothing to manually
// re-sync.
//
// Inert for local dev and any deployment that already sets DATABASE_URL
// directly (e.g. via .env) - this only runs when DATABASE_URL isn't already
// set and DB_SECRET_ID points at the RDS-managed secret.
//
// Imported first in server.ts, before "@vaettir/db" (which reads
// process.env.DATABASE_URL when its PrismaClient is constructed at module
// load time) - top-level await here blocks that later import until this
// resolves, the same ordering trick "./instrument.js" already relies on.
if (!process.env.DATABASE_URL) {
  const secretId = process.env.DB_SECRET_ID;
  if (secretId) {
    const host = process.env.DB_HOST;
    const port = process.env.DB_PORT ?? "5432";
    const name = process.env.DB_NAME ?? "postgres";
    const sslmode = process.env.DB_SSLMODE ?? "require";
    if (!host) {
      throw new Error("DB_SECRET_ID is set but DB_HOST is missing - both are required to compose DATABASE_URL");
    }

    const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-2" });
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!response.SecretString) {
      throw new Error(`Secret ${secretId} (DB_SECRET_ID) has no SecretString`);
    }

    const { username, password } = JSON.parse(response.SecretString) as { username?: string; password?: string };
    if (!username || !password) {
      throw new Error(`Secret ${secretId} (DB_SECRET_ID) is missing username/password fields`);
    }

    process.env.DATABASE_URL = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${name}?sslmode=${sslmode}`;
  }
}
