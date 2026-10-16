import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
import { importJobsRouter } from "./importJobs.js";
import { importTypeAnalysis } from "../services/importTypeAnalysis.js";
const requestId = "20000000-0000-4000-8000-000000000001";
const c = { id: '["",2]', title: "Verify dashboard count", given: [], when: ["Open dashboard"], then: ["Count matches backend"], tags: [] };
function fixture(role = "EDITOR") {
  const original = { id: "actor", memberships: [{ organizationId: "org", role, seatType: "FULL" }] };
  let user: typeof original | null = original;
  const prisma = { user: { findUnique: vi.fn(async () => user) }, project: { findUnique: vi.fn(async () => ({ id: "project", organizationId: "org" })) }, organization: { findUnique: vi.fn(async () => ({ suspendedAt: null })) } };
  const caller = importJobsRouter.createCaller({ user: original, prisma, authenticatedClerkSubject: "clerk" } as unknown as Context);
  return { caller, prisma, revoke: () => { user = null; } };
}
afterEach(() => vi.restoreAllMocks());
describe("automatic import type review authorization", () => {
  it("starts only an authorized free preview and refreshes authorization inside the worker", async () => {
    const f = fixture(); let authorize: (() => Promise<unknown>) | undefined;
    const start = vi.spyOn(importTypeAnalysis, "start").mockImplementation((_scope, id, _cases, guard) => { authorize = guard; return { requestId: id }; });
    expect(await f.caller.startTypeAnalysis({ projectId: "project", requestId, cases: [c] })).toEqual({ requestId });
    expect(start.mock.calls[0]![0]).toEqual({ actorId: "actor", clerkSubject: "clerk", organizationId: "org", projectId: "project" });
    await authorize!(); f.revoke(); await expect(authorize!()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(Object.keys(f.prisma).sort()).toEqual(["organization", "project", "user"]);
  });
  it("denies viewer-funded inference and revoked-user result reads before touching the manager", async () => {
    const start = vi.spyOn(importTypeAnalysis, "start"), status = vi.spyOn(importTypeAnalysis, "status");
    await expect(fixture("VIEWER").caller.startTypeAnalysis({ projectId: "project", requestId, cases: [c] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const f = fixture(); f.revoke();
    await expect(f.caller.typeAnalysisStatus({ projectId: "project", requestId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(start).not.toHaveBeenCalled(); expect(status).not.toHaveBeenCalled();
  });
  it("rejects empty analysis without any provider or import operation", async () => {
    const start = vi.spyOn(importTypeAnalysis, "start");
    await expect(fixture().caller.startTypeAnalysis({ projectId: "project", requestId, cases: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(start).not.toHaveBeenCalled();
  });
});
