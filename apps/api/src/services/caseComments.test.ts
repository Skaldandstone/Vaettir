import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const locked = vi.hoisted(() => vi.fn());
vi.mock("./caseFieldReadScope.js", async original => ({ ...await original<typeof import("./caseFieldReadScope.js")>(), lockCaseFieldReadScope: locked }));
import { readCaseCommentAccess, listCaseComments, createCaseComment, caseCommentRequestHash, commentCreateInput } from "./caseComments.js";
const scope = { projectId: "project", organizationId: "org", actorClerkUserId: "clerk", actorId: "native" };
const input = () => ({ projectId: "project", caseId: "case", originalOrganizationId: "org", expectedClerkActorId: "clerk", requestId: randomUUID(), body: "Literal <script>not HTML</script>\nObservation" });
function fixture() {
  const events: string[] = [], row = { id: randomUUID(), body: input().body, createdAt: new Date("2026-10-06T04:00:00Z"), authorName: "Synthetic member", isOwn: true };
  const state = { unsupported: false, bytes: 20n, savedBody: row.body, rows: [row] };
  const tx = { project: { findUnique: vi.fn(() => { throw Error("No private schema/profile should load"); }) }, $executeRaw: vi.fn(async () => { events.push("insert"); return 1; }), $queryRaw: vi.fn(async (query: { sql: string }) => {
    if (query.sql.includes(" AS unsupported")) { events.push("native-size"); return [{ bytes: state.bytes, unsupported: state.unsupported }]; }
    events.push("private-comments"); return query.sql.includes('c."requestId"') ? [{ ...row, body: state.savedBody }] : state.rows;
  }) };
  const db = { $transaction: vi.fn(async (fn: (value: typeof tx) => unknown, options: unknown) => { events.push("RR"); expect(options).toMatchObject({ isolationLevel: "RepeatableRead", timeout: 10000, maxWait: 5000 }); return fn(tx); }) };
  locked.mockImplementation(async () => { events.push("current-scope"); return scope; });
  return { db: db as never, tx, state, row, events };
}
beforeEach(() => { locked.mockReset(); });
describe("case comments bounded scope/ACK service mocks; native SQL NOT RUN", () => {
  it("schema-independent bootstrap returns only current native scope/activation, no case/profile/schema bodies", async () => {
    const h = fixture(), requestId = randomUUID();
    const result = await readCaseCommentAccess(h.db, "native", { projectId: "project", caseId: "case", requestId }, { clerkActorId: "clerk" });
    expect(result).toEqual({ projectId: "project", caseId: "case", requestId, readScope: scope, canComment: true });
    expect(h.events).toEqual(["RR", "current-scope"]); expect(h.tx.project.findUnique).not.toHaveBeenCalled();
    expect(locked.mock.calls[0]![3]).toEqual({ clerkActorId: "clerk" });
  });
  it.each(["FORBIDDEN", "NOT_FOUND"] as const)("%s current original/native authorization refuses before page/private body or insertion", async code => {
    const h = fixture(); locked.mockRejectedValue(new TRPCError({ code, message: "Current native authorization refused" }));
    const request = input(), { requestId: _uuid, body: _body, ...pins } = request;
    await expect(readCaseCommentAccess(h.db, "native", { ...pins, requestId: request.requestId }, { clerkActorId: "clerk" })).rejects.toMatchObject({ code });
    await expect(listCaseComments(h.db, "native", pins, { clerkActorId: "clerk" })).rejects.toMatchObject({ code });
    await expect(createCaseComment(h.db, "native", request, { clerkActorId: "clerk" })).rejects.toMatchObject({ code });
    expect(h.tx.$queryRaw).not.toHaveBeenCalled(); expect(h.tx.$executeRaw).not.toHaveBeenCalled();
  });
  it("admits a complete page before text and echoes its exact activation; old calls omit the new optional echo", async () => {
    const h = fixture(), readRequestId = randomUUID(), { body: _body, requestId: _uuid, ...pins } = input();
    h.state.rows = [h.row, { ...h.row, id: randomUUID() }];
    const result = await listCaseComments(h.db, "native", { ...pins, readRequestId, limit: 1 }, { clerkActorId: "clerk" });
    expect(h.events).toEqual(["RR", "current-scope", "native-size", "private-comments"]); expect(result.readRequestId).toBe(readRequestId); expect(result.items).toHaveLength(1); expect(result.nextCursor?.id).toBe(h.row.id);
    const old = await listCaseComments(h.db, "native", pins, { clerkActorId: "clerk" }); expect(old).not.toHaveProperty("readRequestId");
  });
  it.each([{ unsupported: true, bytes: 2n }, { unsupported: false, bytes: 416001n }, { unsupported: false, bytes: 3000000000n }, { unsupported: false, bytes: -1n }])("native page bound refusal precedes all private text without truncation", async patch => {
    const h = fixture(); Object.assign(h.state, patch); const { body: _body, requestId: _uuid, ...pins } = input();
    await expect(listCaseComments(h.db, "native", pins, { clerkActorId: "clerk" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(h.events).not.toContain("private-comments");
  });
  it.each([{ body: "🎮".repeat(2001) }, { authorName: "🎮".repeat(101) }, { id: "malformed-retained-id" }])("retained nonBMP/malformed DTO refuses the complete page generically, never clips or echoes private text", async patch => {
    const h = fixture(); h.state.rows = [{ ...h.row }, { ...h.row, ...patch }]; const { body: _body, requestId: _uuid, ...pins } = input();
    try { await listCaseComments(h.db, "native", { ...pins, limit: 1 }, { clerkActorId: "clerk" }); throw Error("Expected refusal"); }
    catch (cause) { expect(cause).toMatchObject({ code: "PRECONDITION_FAILED" }); expect(String(cause)).not.toContain("🎮"); expect(String(cause)).not.toContain(h.row.body); expect(String(cause)).toContain("Nothing was clipped or replaced"); }
  });
  it("READ_ONLY collaboration lock remains intentional and exact UUID/body replay adds trustworthy scope/hash without changing input", async () => {
    const h = fixture(), request = input(); request.body = `  ${request.body}  `;
    const posted = await createCaseComment(h.db, "native", request, { clerkActorId: "clerk" }), replay = await createCaseComment(h.db, "native", request, { clerkActorId: "clerk" });
    expect(posted.id).toBe(replay.id); expect(posted.body).toBe(request.body.trim()); expect(posted.readScope).toEqual(scope); expect(posted.requestHash).toBe(caseCommentRequestHash(commentCreateInput.parse(request)));
    expect(posted.requestHash).toBe(createHash("sha256").update(JSON.stringify([request.projectId, request.caseId, request.originalOrganizationId, request.expectedClerkActorId, request.requestId, request.body.trim()])).digest("hex"));
    h.state.savedBody = "Other receipt text"; await expect(createCaseComment(h.db, "native", request, { clerkActorId: "clerk" })).rejects.toMatchObject({ code: "CONFLICT" });
    const source = readFileSync(new URL("./caseComments.ts", import.meta.url), "utf8"), nativeScope = readFileSync(new URL("./caseFieldReadScope.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/caseFieldSchema|assertCaseFieldAuthoring|lockCaseFieldProject/); expect(nativeScope).toContain('["FULL", "READ_ONLY"]'); expect(nativeScope).toContain('"VIEWER"');
  });
  it("unchanged body admission rejects invalid/null text before any current scope or transaction", async () => {
    const h = fixture(); for (const body of ["", " ", "x\0y", "x".repeat(4001)]) await expect(createCaseComment(h.db, "native", { ...input(), body }, { clerkActorId: "clerk" })).rejects.toThrow();
    expect(locked).not.toHaveBeenCalled(); expect(h.events).toEqual([]);
  });
});
