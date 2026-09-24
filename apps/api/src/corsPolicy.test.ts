import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { allowedCorsOrigins, createCorsOriginPolicy } from "./corsPolicy.js";

function checkOrigin(env: Record<string, string | undefined>, origin?: string) {
  const callback = vi.fn();
  createCorsOriginPolicy(env)(origin, callback);
  expect(callback).toHaveBeenCalledOnce();
  return callback.mock.calls[0];
}

describe("production CORS policy", () => {
  it("allows only exact configured browser origins", () => {
    const env = {
      NODE_ENV: "production",
      WEB_APP_URL: "https://vaettir.skaldandstone.com",
      CORS_ALLOWED_ORIGINS:
        "https://preview.example.com, https://admin.example.com:8443",
    };

    expect(checkOrigin(env, "https://vaettir.skaldandstone.com")).toEqual([
      null,
      true,
    ]);
    expect(checkOrigin(env, "https://preview.example.com")).toEqual([
      null,
      true,
    ]);
    expect(checkOrigin(env, "https://admin.example.com:8443")).toEqual([
      null,
      true,
    ]);
    expect(checkOrigin(env, "https://evil.example.com")).toEqual([null, false]);
    expect(checkOrigin(env, "https://preview.example.com.evil.test")).toEqual([
      null,
      false,
    ]);
  });

  it("permits requests without an Origin header but not the opaque null origin", () => {
    const env = {
      NODE_ENV: "production",
      WEB_APP_URL: "https://vaettir.skaldandstone.com",
    };

    expect(checkOrigin(env)).toEqual([null, true]);
    expect(checkOrigin(env, "null")).toEqual([null, false]);
  });

  it("fails closed on wildcard, credentials, paths, queries, and unsupported schemes", () => {
    for (const CORS_ALLOWED_ORIGINS of [
      "*",
      "https://user:password@example.com",
      "https://example.com/path",
      "https://example.com?tenant=one",
      "https://example.com#fragment",
      "file:///tmp/demo",
      "not-an-origin",
    ]) {
      expect(() =>
        allowedCorsOrigins({ NODE_ENV: "production", CORS_ALLOWED_ORIGINS }),
      ).toThrow();
    }
  });

  it("does not add development origins in production when no allowlist is configured", () => {
    expect([...allowedCorsOrigins({ NODE_ENV: "production" })]).toEqual([]);
    expect(
      checkOrigin({ NODE_ENV: "production" }, "http://localhost:3000"),
    ).toEqual([null, false]);
  });

  it("sets the response header only for an allowed origin through Fastify", async () => {
    const app = Fastify();
    await app.register(cors, {
      origin: createCorsOriginPolicy({
        NODE_ENV: "production",
        WEB_APP_URL: "https://vaettir.skaldandstone.com",
      }),
    });
    app.get("/probe", async () => ({ ok: true }));

    const allowed = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { origin: "https://vaettir.skaldandstone.com" },
    });
    const denied = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { origin: "https://evil.example.com" },
    });

    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "https://vaettir.skaldandstone.com",
    );
    expect(denied.statusCode).toBe(200);
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });
});

describe("development CORS policy", () => {
  it("allows the supported local web ports without opening arbitrary local origins", () => {
    const env = { NODE_ENV: "development" };

    expect(checkOrigin(env, "http://localhost:3000")).toEqual([null, true]);
    expect(checkOrigin(env, "http://127.0.0.1:3001")).toEqual([null, true]);
    expect(checkOrigin(env, "http://localhost:3999")).toEqual([null, false]);
  });
});
