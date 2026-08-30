import { expect } from "vitest";

if (expect.getState().testPath?.endsWith(".integration.test.ts")) {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Integration tests require an explicitly isolated DATABASE_URL");
  const target = new URL(raw);
  if (!["localhost", "127.0.0.1", "postgres"].includes(target.hostname) || !/^\/vaettir_[a-z0-9_]*test$/.test(target.pathname)) {
    throw new Error("Refusing integration tests outside a local vaettir_*test database. Never point this suite at production or shared dev data.");
  }
}
