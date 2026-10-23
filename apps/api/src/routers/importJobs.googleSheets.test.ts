import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
const mocks = vi.hoisted(() => ({ commit: vi.fn() }));
vi.mock("../services/importCommit.js", () => ({ commitImportedTestCases: mocks.commit }));
import { importJobsRouter } from "./importJobs.js";

function caller(role = "EDITOR", organizationId = "synthetic-org") {
  return importJobsRouter.createCaller({
    user: { id: "synthetic-user", memberships: [{ organizationId, role, seatType: "FULL" }] },
    prisma: { project: { findUnique: vi.fn(async () => ({ id: "synthetic-project", organizationId: "synthetic-org" })) }, organization: { findUnique: vi.fn(async () => ({ suspendedAt: null })) } },
  } as unknown as Context);
}
const sheet = (sheetId: number) => ({ source: { spreadsheetId: "synthetic_book", sheetId }, name: `Tab ${sheetId}`, csvText: "Case ID,Title\n1,Example case", mapping: { title: "Title", externalId: "Case ID" } });
const input = { projectId: "synthetic-project", sourceLabel: "Synthetic sheet selection", sheets: [sheet(0), sheet(1)] };
beforeEach(() => { mocks.commit.mockReset().mockResolvedValue({ importJobId: "synthetic-job", createdCount: 2, updatedCount: 0, skipped: [] }); });
describe("Google Sheets import authorization and atomic entry", () => {
  it("submits all validated tabs through exactly one existing atomic commit, bound to the current actor and tenant", async () => {
    await caller().commitGoogleSheets(input);
    expect(mocks.commit).toHaveBeenCalledOnce();
    const args = mocks.commit.mock.calls[0]![1];
    expect(args).toMatchObject({ projectId: "synthetic-project", organizationId: "synthetic-org", actorId: "synthetic-user", framework: "google-sheets", keyPrefix: "google-sheets:synthetic_book" });
    expect(args.rows.map((row: { externalId: string }) => row.externalId)).toEqual(["0:1", "1:1"]);
  });
  it("rejects a bad second tab before entering the commit transaction", async () => {
    await expect(caller().commitGoogleSheets({ ...input, sheets: [sheet(0), { ...sheet(1), csvText: "Case ID,Title\n,Missing ID" }] })).rejects.toThrow(/case ID/);
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("denies viewers and foreign workspace access for both configuration and writes", async () => {
    for (const denied of [caller("VIEWER"), caller("EDITOR", "foreign-org")]) {
      await expect(denied.googleSheetsConfig({ projectId: input.projectId })).rejects.toThrow();
      await expect(denied.commitGoogleSheets(input)).rejects.toThrow();
    }
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("has no credential, AI grant, organization override or analysis request input", async () => {
    for (const addition of [{ token: "never-save" }, { organizationId: "foreign" }, { typeAnalysisRequestId: "00000000-0000-4000-8000-000000000000" }]) {
      await expect(caller().commitGoogleSheets({ ...input, ...addition } as typeof input)).rejects.toThrow();
    }
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
