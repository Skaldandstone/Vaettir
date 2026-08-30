export function assertTestEnvironment() {
  const db = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
  const web = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000");
  const api = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000");
  if (!["localhost", "127.0.0.1", "postgres"].includes(db.hostname) || !/^\/vaettir_[a-z0-9_]*test$/.test(db.pathname)) {
    throw new Error("E2E requires an isolated local vaettir_*test database. Shared and production databases are forbidden.");
  }
  if (![web, api].every((url) => ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("E2E permits local web/API endpoints only.");
  }
  if (!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_")) {
    throw new Error("E2E requires Clerk TEST keys, never production credentials.");
  }
}
