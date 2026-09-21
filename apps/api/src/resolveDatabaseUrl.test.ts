import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();
vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: vi.fn().mockImplementation(function FakeSecretsManagerClient() {
    return { send: sendMock };
  }),
  GetSecretValueCommand: vi.fn().mockImplementation(function FakeGetSecretValueCommand(input: unknown) {
    return { input };
  }),
}));

// Dynamic import after mocking, and reset modules between tests: this
// module has top-level await side effects (it reads process.env.DATABASE_URL
// at import time), so each test needs a fresh module instance under its own
// env, not the one import-cached from a previous test's env.
async function importFresh() {
  vi.resetModules();
  return import("./resolveDatabaseUrl.js");
}

describe("resolveDatabaseUrlFromManagedSecret", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("returns undefined when DB_SECRET_ID isn't set - not an error state", async () => {
    const { resolveDatabaseUrlFromManagedSecret } = await importFresh();
    const result = await resolveDatabaseUrlFromManagedSecret({ DATABASE_URL: "postgresql://already:set@host/db" });
    expect(result).toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("throws when DB_SECRET_ID is set but DB_HOST is missing", async () => {
    const { resolveDatabaseUrlFromManagedSecret } = await importFresh();
    await expect(resolveDatabaseUrlFromManagedSecret({ DB_SECRET_ID: "rds!db-abc" })).rejects.toThrow(/DB_HOST is missing/);
  });

  it("composes a real postgresql:// URL from the managed secret's username/password, URL-encoding both", async () => {
    sendMock.mockResolvedValue({ SecretString: JSON.stringify({ username: "vaettir_admin", password: "p@ss/word!" }) });
    const { resolveDatabaseUrlFromManagedSecret } = await importFresh();
    const url = await resolveDatabaseUrlFromManagedSecret({
      DB_SECRET_ID: "rds!db-abc",
      DB_HOST: "vaettir-postgres.example.rds.amazonaws.com",
    });
    expect(url).toBe(
      "postgresql://vaettir_admin:p%40ss%2Fword!@vaettir-postgres.example.rds.amazonaws.com:5432/postgres?sslmode=require",
    );
  });

  it("respects DB_PORT/DB_NAME/DB_SSLMODE overrides", async () => {
    sendMock.mockResolvedValue({ SecretString: JSON.stringify({ username: "u", password: "pw" }) });
    const { resolveDatabaseUrlFromManagedSecret } = await importFresh();
    const url = await resolveDatabaseUrlFromManagedSecret({
      DB_SECRET_ID: "rds!db-abc",
      DB_HOST: "host",
      DB_PORT: "5433",
      DB_NAME: "vaettir",
      DB_SSLMODE: "prefer",
    });
    expect(url).toBe("postgresql://u:pw@host:5433/vaettir?sslmode=prefer");
  });

  it("throws when the secret has no SecretString", async () => {
    sendMock.mockResolvedValue({});
    const { resolveDatabaseUrlFromManagedSecret } = await importFresh();
    await expect(resolveDatabaseUrlFromManagedSecret({ DB_SECRET_ID: "rds!db-abc", DB_HOST: "host" })).rejects.toThrow(
      /has no SecretString/,
    );
  });

  it("throws when the secret is missing username or password fields", async () => {
    sendMock.mockResolvedValue({ SecretString: JSON.stringify({ username: "u" }) });
    const { resolveDatabaseUrlFromManagedSecret } = await importFresh();
    await expect(resolveDatabaseUrlFromManagedSecret({ DB_SECRET_ID: "rds!db-abc", DB_HOST: "host" })).rejects.toThrow(
      /missing username\/password/,
    );
  });
});

describe("module-load side effect (server.ts's own import)", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("does not overwrite an already-set DATABASE_URL", async () => {
    process.env.DATABASE_URL = "postgresql://existing@host/db";
    delete process.env.DB_SECRET_ID;
    await importFresh();
    expect(process.env.DATABASE_URL).toBe("postgresql://existing@host/db");
    expect(sendMock).not.toHaveBeenCalled();
    delete process.env.DATABASE_URL;
  });

  it("sets process.env.DATABASE_URL when unset and DB_SECRET_ID/DB_HOST are configured", async () => {
    delete process.env.DATABASE_URL;
    process.env.DB_SECRET_ID = "rds!db-abc";
    process.env.DB_HOST = "host.example.com";
    sendMock.mockResolvedValue({ SecretString: JSON.stringify({ username: "u", password: "pw" }) });
    await importFresh();
    expect(process.env.DATABASE_URL).toBe("postgresql://u:pw@host.example.com:5432/postgres?sslmode=require");
    delete process.env.DATABASE_URL;
    delete process.env.DB_SECRET_ID;
    delete process.env.DB_HOST;
  });
});
