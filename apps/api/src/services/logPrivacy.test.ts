import { expect, it } from "vitest";
import Fastify from "fastify";
import { safeErrorLog, safeRequestLog } from "./logPrivacy.js";

it("reduces requests to finite route and method categories", () => {
  expect(safeRequestLog({ method: "GET", url: "/api/trpc/case.get?input=private-payload" })).toEqual({ method: "GET", route: "trpc" });
  expect(safeRequestLog({ method: "private-payload", url: "/private-payload" })).toEqual({ method: "OTHER", route: "other" });
  expect(safeRequestLog({ method: "GET", url: "/health/detailed" }).route).toBe("health");
});

it("excludes error message, stack and custom name", () => {
  const error = new Error("private-payload"); error.name = "private-payload";
  expect(safeErrorLog(error)).toEqual({ type: "Error", message: "Application error; details excluded.", stack: "" });
  expect(safeErrorLog(new TypeError("private-payload"))).toMatchObject({ type: "TypeError" });
});

it("keeps actual Fastify request/error log output payload-free", async () => {
  const lines: string[] = [];
  const server = Fastify({ logger: { serializers: { req: safeRequestLog, err: safeErrorLog, res: response => ({ statusCode: response.statusCode }) }, stream: { write: line => { lines.push(line); } } } });
  server.get("/api/trpc/example", async request => {
    request.log.error({ err: new Error("private-payload") }, "Unhandled API error");
    return { ok: true };
  });
  await server.inject({ method: "GET", url: "/api/trpc/example?input=private-payload", headers: { authorization: "private-payload", cookie: "private-payload" } });
  await server.close();
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.join("")).not.toContain("private-payload");
  expect(lines.join("")).toContain('"route":"trpc"');
});
