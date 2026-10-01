import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";

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
    caller: importJobsRouter.createCaller(ctx), findUser,
    afterParse(user: typeof original | null) {
      mocks.parse.mockImplementation(async () => { current = user; return [sheet]; });
    },
  };
}

beforeEach(() => { mocks.parse.mockReset(); mocks.commit.mockReset(); });

describe("Excel post-parse access", () => {
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
