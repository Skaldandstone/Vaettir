import { beforeEach, expect, it, vi } from "vitest";
import type { Prisma } from "@vaettir/db";
import { lockCaseFieldProject } from "./caseFields.js";
import { lockCurrentCaseFieldActor } from "./caseFieldReadScope.js";
import { createCaseWithReceipt } from "./caseCreateReceipt.js";
vi.mock("./caseFields.js", () => ({ lockCaseFieldProject: vi.fn() }));
vi.mock("./caseFieldReadScope.js", () => ({ lockCurrentCaseFieldActor: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(lockCurrentCaseFieldActor).mockResolvedValue("clerk"); });
const input = () => ({ projectId: "p", originalOrganizationId: "o", expectedClerkActorId: "clerk",
  requestId: "b88015c0-67b8-4cad-a39b-1ae11a358830", title: " Exact manual\nwording ", given: [""], customFields: { count: 0, enabled: false } });
function fixture() {
  const receipts = new Map<string, { organizationId: string; projectId: string; actorId: string; metadata: unknown }>();
  const cases = new Map<string, { id: string; projectId: string }>();
  const key = (where: { entityId: string }) => where.entityId;
  const db = {
    $queryRaw: vi.fn(async () => []),
    project: { findUniqueOrThrow: vi.fn(async ({ where }) => ({ organizationId: where.id === "p" ? "o" : "other-org" })) },
    auditLog: {
      findFirst: vi.fn(async ({ where }) => receipts.get(key(where)) ?? null),
      create: vi.fn(async ({ data }) => { receipts.set(key(data), { organizationId: data.organizationId, projectId: data.projectId, actorId: data.actorId, metadata: data.metadata }); }),
    },
    testCase: { findFirst: vi.fn(async ({ where }) => { const row = cases.get(where.id); return row?.projectId === where.projectId ? row : null; }) },
  };
  const create = vi.fn(async () => { const row = { id: `case-${cases.size + 1}`, projectId: "p" }; cases.set(row.id, row); return row; });
  const run = (request = input()) => createCaseWithReceipt(db as unknown as Prisma.TransactionClient, "actor", "clerk", request, create);
  return { db, create, run, receipts, cases };
}
it("recovers the same persisted case receipt without another create or audit write", async () => {
  const h = fixture(), original = input();
  const first = await h.run(original); // Treat the returned ACK as lost.
  const second = await h.run({ ...original, customFields: { enabled: false, count: 0 } });
  expect(second).toEqual({ ...first, replayed: true });
  expect(h.create).toHaveBeenCalledTimes(1); expect(h.db.auditLog.create).toHaveBeenCalledTimes(1);
  expect(lockCaseFieldProject).toHaveBeenCalledWith(h.db, "actor", "p");
  expect(lockCurrentCaseFieldActor).toHaveBeenCalledWith(h.db, "actor", { clerkActorId: "clerk" });
  expect(h.db.auditLog.create.mock.calls[0]![0].data.metadata).not.toHaveProperty("input");
});
it("refuses conflicting content or original workspace reuse before returning an old ID", async () => {
  const h = fixture(); await h.run();
  await expect(h.run({ ...input(), title: "Different content" })).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(h.run({ ...input(), originalOrganizationId: "other-org" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(h.create).toHaveBeenCalledTimes(1);
});
it("rejects a request ID reused by another project or database actor", async () => {
  const h = fixture(); await h.run();
  await expect(h.run({ ...input(), projectId: "other", originalOrganizationId: "other-org" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(createCaseWithReceipt(h.db as unknown as Prisma.TransactionClient, "other-actor", "clerk", input(), h.create)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(h.create).toHaveBeenCalledTimes(1);
});
it("will not recreate a deleted case or follow a forged cross-project receipt", async () => {
  const h = fixture(), saved = await h.run(); h.cases.delete(saved.id);
  await expect(h.run()).rejects.toMatchObject({ code: "NOT_FOUND" });
  h.cases.set(saved.id, { id: saved.id, projectId: "other" });
  await expect(h.run()).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(h.create).toHaveBeenCalledTimes(1);
});
it("rechecks project permission and current Clerk mapping before receipt lookup", async () => {
  const h = fixture();
  vi.mocked(lockCaseFieldProject).mockRejectedValueOnce(Error("Access revoked"));
  await expect(h.run()).rejects.toThrow("Access revoked");
  vi.mocked(lockCurrentCaseFieldActor).mockResolvedValueOnce("replacement");
  await expect(h.run()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(h.db.auditLog.findFirst).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled();
});
it("refuses an invalid original actor receipt and never records failed/foreign creations", async () => {
  const h = fixture(); await h.run();
  const receipt = [...h.receipts.values()][0]!;
  receipt.metadata = { ...(receipt.metadata as object), clerkActorId: "replacement" };
  await expect(h.run()).rejects.toMatchObject({ code: "FORBIDDEN" });
  const failed = fixture(); failed.create.mockRejectedValueOnce(Error("Transaction refused"));
  await expect(failed.run()).rejects.toThrow("Transaction refused"); expect(failed.receipts.size).toBe(0);
  failed.create.mockResolvedValueOnce({ id: "foreign", projectId: "other" });
  await expect(failed.run()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" }); expect(failed.receipts.size).toBe(0);
});
