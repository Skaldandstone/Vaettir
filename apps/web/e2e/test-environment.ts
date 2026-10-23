export function assertTestEnvironment(env: Record<string, string | undefined> = process.env) {
  const db = new URL(env.DATABASE_URL ?? "postgresql://invalid/invalid");
  const web = new URL(env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000");
  const api = new URL(env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000");
  const safeDatabase = ["postgresql:", "postgres:"].includes(db.protocol)
    && ["localhost", "127.0.0.1", "postgres"].includes(db.hostname)
    && /^\/vaettir_[a-z0-9_]*test$/.test(db.pathname)
    && [...db.searchParams.keys()].every((key) => ["schema", "connection_limit", "pool_timeout"].includes(key));
  if (!safeDatabase) {
    throw new Error("E2E requires an isolated local vaettir_*test database. Shared and production databases are forbidden.");
  }
  if (![web, api].every((url) => ["http:", "https:"].includes(url.protocol)
    && ["localhost", "127.0.0.1"].includes(url.hostname) && !url.username && !url.password)) {
    throw new Error("E2E permits local web/API endpoints only.");
  }
  if (!env.CLERK_SECRET_KEY?.startsWith("sk_test_") || !env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_")) {
    throw new Error("E2E requires Clerk TEST keys, never production credentials.");
  }
}
