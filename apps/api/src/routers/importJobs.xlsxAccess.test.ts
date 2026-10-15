import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
import { router } from "../trpc.js";
import Fastify from "fastify";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { XLSX_HTTP_BODY_BYTES } from "../services/xlsxImportLimits.js";

const mocks = vi.hoisted(() => ({ parse: vi.fn(), commit: vi.fn() }));
vi.mock("../services/xlsxImportIsolation.js", () => ({ parseXlsxWorkbookIsolated: mocks.parse }));
vi.mock("../services/importCommit.js", () => ({ commitImportedTestCases: mocks.commit }));
import { importJobsRouter } from "./importJobs.js";

const sheet = {
  name: "Cases", headerRow: 1, csvText: "Title\r\nLogin works", headers: ["Title"],
  rowCount: 1, suggestedMapping: { title: "Title" },
};

function fixture() {
  const original = { id: "synthetic-user", memberships: [{ organizationId: "synthetic-org", role: "EDITOR", seatType: "FULL" }] };
  let current: typeof original | null = original;
  const findUser = vi.fn(async () => current);
  const ctx = {
    user: original,
    prisma: {
      user: { findUnique: findUser },
      project: { findUnique: vi.fn(async () => ({ id: "synthetic-project", organizationId: "synthetic-org" })) },
      organization: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    },
  } as unknown as Context;
  return {
    caller: importJobsRouter.createCaller(ctx), findUser, ctx,
    afterParse(user: typeof original | null) {
      mocks.parse.mockImplementation(async () => { current = user; return [sheet]; });
    },
  };
}

beforeEach(() => { mocks.parse.mockReset(); mocks.commit.mockReset(); });

describe("Excel post-parse access", () => {
  it("commits only actual cases and passes the reviewed non-case exclusions to the audit service", async () => {
    const f = fixture();
    const csvText = 'ID,Title,Steps,Expected\r\nSection B,,,\r\nTC-1,Login works,Open login,Dashboard shown';
    mocks.parse.mockResolvedValue([{ ...sheet, csvText, rowCount: 2 }]);
    mocks.commit.mockImplementation(async (_db, input) => ({ importJobId: "synthetic-job", createdCount: input.rows.length, updatedCount: 0, skipped: input.skipped }));
    const result = await f.caller.commitXlsx({ projectId: "synthetic-project", fileBase64: "dGVzdA==", sheets: [{ name: "Cases", mapping: { title: "Title", externalId: "ID", when: "Steps", then: "Expected" } }] });
    expect(result.createdCount).toBe(1);
    expect(result.skipped).toEqual([{ rowNumber: 2, reason: "Cases: section label or ID only; no test-case definition" }]);
    expect(mocks.commit.mock.calls[0]![1].rows).toEqual([expect.objectContaining({ title: "Login works", when: ["Open login"], externalId: "Cases:TC-1" })]);
  });
  it("still blocks missing-title rows that contain actual test content before any commit", async () => {
    const f = fixture();
    mocks.parse.mockResolvedValue([{ ...sheet, csvText: 'ID,Title,Steps\r\nTC-2,,Open login', rowCount: 1 }]);
    await expect(f.caller.commitXlsx({ projectId: "synthetic-project", fileBase64: "dGVzdA==", sheets: [{ name: "Cases", mapping: { title: "Title", externalId: "ID", when: "Steps" } }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("accepts a synthetic workbook upload larger than the old HTTP and schema caps", async () => {
    const f = fixture();
    f.afterParse({ id: "synthetic-user", memberships: [{ organizationId: "synthetic-org", role: "EDITOR", seatType: "FULL" }] });
    const app = Fastify({ bodyLimit: XLSX_HTTP_BODY_BYTES });
    await app.register(fastifyTRPCPlugin, { prefix: "/trpc", trpcOptions: { router: router({ importJobs: importJobsRouter }), createContext: async () => f.ctx } });
    try {
      const payload = { projectId: "synthetic-project", requestId: "10000000-0000-4000-8000-000000000040", fileBase64: Buffer.alloc(12 * 1024 * 1024).toString("base64") };
      const response = await app.inject({ method: "POST", url: "/trpc/importJobs.startXlsxRead", payload });
      expect(response.statusCode).toBe(200);
      expect(response.json().result.data.requestId).toBe(payload.requestId);
      expect(mocks.parse.mock.calls[0]![0].byteLength).toBe(12 * 1024 * 1024);
      expect(mocks.commit).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it("returns a background read identity promptly and rechecks access on every result poll", async () => {
    const f = fixture();
    f.afterParse({ id: "synthetic-user", memberships: [] });
    const requestId = "10000000-0000-4000-8000-000000000041";
    expect(await f.caller.startXlsxRead({ projectId: "synthetic-project", requestId, fileBase64: "dGVzdA==" })).toEqual({ requestId });
    await expect(f.caller.xlsxReadStatus({ projectId: "synthetic-project", requestId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.caller.cancelXlsxRead({ projectId: "synthetic-project", requestId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("exposes a completed read-only preview only to the current project member", async () => {
    const f = fixture();
    f.afterParse({ id: "synthetic-user", memberships: [{ organizationId: "synthetic-org", role: "EDITOR", seatType: "FULL" }] });
    const requestId = "10000000-0000-4000-8000-000000000042";
    await f.caller.startXlsxRead({ projectId: "synthetic-project", requestId, fileBase64: "dGVzdA==" });
    await vi.waitFor(async () => expect((await f.caller.xlsxReadStatus({ projectId: "synthetic-project", requestId })).status).toBe("READY"));
    const result = await f.caller.xlsxReadStatus({ projectId: "synthetic-project", requestId });
    expect(result.preview?.sheets[0]?.previewRows[0]?.title).toBe("Login works");
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(f.findUser.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it.each(["previewXlsx", "previewXlsxSheet"] as const)("rejects %s if membership was revoked during parsing", async (procedure) => {
    const f = fixture();
    f.afterParse({ id: "synthetic-user", memberships: [] });
    const input = { projectId: "synthetic-project", fileBase64: "dGVzdA==", sheetName: "Cases", mapping: { title: "Title" } };
    await expect(f.caller[procedure](input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.parse).toHaveBeenCalledOnce();
    expect(f.findUser).toHaveBeenCalledWith({ where: { id: "synthetic-user" }, include: { memberships: true } });
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it.each(["revoked", "downgraded"] as const)("rejects commit when editor membership was %s during parsing, without writes", async (change) => {
    const f = fixture();
    f.afterParse({ id: "synthetic-user", memberships: change === "revoked" ? [] : [{ organizationId: "synthetic-org", role: "VIEWER", seatType: "FULL" }] });
    await expect(f.caller.commitXlsx({ projectId: "synthetic-project", fileBase64: "dGVzdA==", sheets: [{ name: "Cases", mapping: { title: "Title" } }] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.parse).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("fails closed when the actor no longer exists", async () => {
    const f = fixture();
    f.afterParse(null);
    await expect(f.caller.previewXlsx({ projectId: "synthetic-project", fileBase64: "dGVzdA==" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("retains ordinary preview behavior with current authorized membership", async () => {
    const f = fixture();
    f.afterParse({ id: "synthetic-user", memberships: [{ organizationId: "synthetic-org", role: "EDITOR", seatType: "FULL" }] });
    const preview = await f.caller.previewXlsx({ projectId: "synthetic-project", fileBase64: "dGVzdA==" });
    expect(preview.sheets[0]?.previewRows[0]?.title).toBe("Login works");
    expect(f.findUser).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
