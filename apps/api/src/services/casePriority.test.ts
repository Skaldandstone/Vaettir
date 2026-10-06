import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const locks = vi.hoisted(() => ({ project: vi.fn(), actor: vi.fn(), read: vi.fn() }));
vi.mock("./caseFields.js", async original => ({ ...await original<typeof import("./caseFields.js")>(), lockCaseFieldProject: locks.project }));
vi.mock("./caseFieldReadScope.js", async original => ({ ...await original<typeof import("./caseFieldReadScope.js")>(), lockCurrentCaseFieldActor: locks.actor, lockCaseFieldReadScope: locks.read }));
import { casePriorityInput, casePriorityLegacyOutput, casePriorityRequestHash, previewCasePriority, setCasePriority } from "./casePriority.js";
import { testCaseContentRevision } from "./testCaseContentRevision.js";
const readScope = { projectId: "project", organizationId: "org", actorId: "native", actorClerkUserId: "clerk" };
function fixture() {
  const current = { id: "case", projectId: "project", title: " Exact title ", background: "", given: ["", "same", "same"], when: ["Click"], then: ["Visible response"], tags: [" exact,tag "], testType: "FUNCTIONAL" as const, priority: "MEDIUM" as const, suitePath: null, testPlanId: null, validationDomain: "SOFTWARE" as const, verificationProfile: { unknown: { retained: [null, false, 0, ""] } } as unknown, archived: false, sharedStepGroupId: null as string | null, sharedStepGroup: null as null | { id: string; projectId: string; steps: unknown }, steps: [{ id: "step", testCaseId: "case", order: 0, action: "Click button", expectedActionOrData: "onClick GET /exact", expectedResult: "", expectedResponse: null, mediaAttachmentIds: [] }] };
  const input = { projectId: "project", caseId: "case", priority: "HIGH" as const, expectedCaseRevision: testCaseContentRevision(current), requestId: randomUUID(), originalOrganizationId: "org", expectedClerkActorId: "clerk" };
  const events: string[] = [], queries: string[] = [], state = { organizationId: "org", role: "EDITOR", seatType: "FULL", prior: null as null | { organizationId: string; metadata: unknown }, bytes: 1000n, baseBytes: 400n, steps: 1n, sharedSteps: 0, frozenBytes: 500n, profileExact: true, sharedExact: true, foreignShared: false, missingShared: false, maxVersion: 2, insertRows: 1, unsafeProfile: false };
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async (raw: { sql: string } | readonly string[], ..._params: unknown[]) => {
      const sql = Array.isArray(raw) ? raw.join(" ? ") : (raw as { sql: string }).sql; queries.push(sql);
      if (sql.includes('FROM "TestCase" WHERE') && sql.includes("FOR UPDATE")) { events.push("case-lock"); return [{ id: "case" }]; }
      if (sql.includes('AS "foreignShared"')) { events.push("relationship"); return [{ foreignShared: state.foreignShared, missingShared: state.missingShared }]; }
      if (sql.includes('AS "baseBytes"')) { events.push("native-preflight"); return [{ bytes: state.bytes, baseBytes: state.baseBytes, steps: state.steps, sharedSteps: state.sharedSteps }]; }
      if (sql.includes("FOR SHARE")) { events.push("procedure-lock"); return [{ count: 1n }]; }
      if (sql.includes('AS "profileExact"')) { events.push("native-roundtrip"); return [{ profileExact: state.profileExact, sharedExact: state.sharedExact }]; }
      if (sql.includes("::jsonb::text")) { events.push("frozen-size"); return [{ bytes: state.frozenBytes }]; }
      if (sql.includes('INSERT INTO "TestCaseVersion"')) { events.push("native-version-copy"); return Array.from({ length: state.insertRows }, () => ({ id: randomUUID(), versionNumber: state.maxVersion + 1 })); }
      throw Error("Unexpected synthetic priority query");
    }),
    project: { findUniqueOrThrow: vi.fn(async () => ({ organizationId: state.organizationId })) },
    membership: { findUniqueOrThrow: vi.fn(async () => ({ role: state.role, seatType: state.seatType })) },
    testCase: { findFirstOrThrow: vi.fn(async ({ select }: { select: Record<string, unknown> }) => {
      if (select.title) { events.push("private-projection"); expect(select).not.toHaveProperty("customFields"); expect(select).not.toHaveProperty("aiSnapshot"); expect(select.sharedStepGroup).toEqual({ select: { id: true, projectId: true, steps: true } }); return current; }
      events.push("scalar-identity"); return { priority: current.priority, archived: current.archived };
    }), update: vi.fn(async ({ data, select }: { data: unknown; select: unknown }) => { events.push("priority-only-update"); expect(select).toEqual({ id: true }); return { id: "case", data }; }) },
    testCaseVersion: { findFirst: vi.fn(async () => { events.push("version-number"); return { versionNumber: state.maxVersion }; }), create: vi.fn(() => { throw Error("No Prisma JSON profile reserialization"); }) },
    auditLog: { findFirst: vi.fn(async () => { events.push("prior-receipt"); return state.prior; }), create: vi.fn(async () => { events.push("audit"); return {}; }) },
  };
  const db = { $transaction: vi.fn(async (fn: (arg: typeof tx) => unknown, options: unknown) => { expect(options).toMatchObject({ isolationLevel: "RepeatableRead", timeout: 10000, maxWait: 5000 }); return fn(tx); }) };
  locks.project.mockImplementation(async () => { events.push("full-editor-lock"); }); locks.actor.mockImplementation(async () => { events.push("native-actor-lock"); return "clerk"; }); locks.read.mockImplementation(async () => { events.push("native-read-lock"); return readScope; });
  return { current, input, state, events, queries, tx, db: db as never };
}
beforeEach(() => { Object.values(locks).forEach(lock => lock.mockReset()); });
describe("priority-only native preview/snapshot mocked contracts; actual SQL NOT RUN", () => {
  it("preserves exact legacy property-order hash and original three-field output; reviewed native pin is not inner payload", () => {
    const h = fixture(), parsed = casePriorityInput.parse({ ...h.input }); expect(casePriorityRequestHash(parsed)).toBe(createHash("sha256").update(JSON.stringify(h.input)).digest("hex"));
    expect(Object.keys(parsed)).toEqual(["projectId", "caseId", "priority", "expectedCaseRevision", "requestId", "originalOrganizationId", "expectedClerkActorId"]);
    expect(casePriorityLegacyOutput.parse({ priority: "HIGH", replayed: true, requestId: h.input.requestId, requestHash: "a".repeat(64), readScope })).toEqual({ priority: "HIGH", replayed: true, requestId: h.input.requestId });
  });
  it("new priority writes only priority/author; native profile column copy preserves complete existing effective version semantics", async () => {
    const h = fixture(), saved = await setCasePriority(h.db, "native", h.input, { clerkActorId: "clerk" }, "native");
    expect(saved).toMatchObject({ priority: "HIGH", replayed: false, readScope, requestId: h.input.requestId, requestHash: casePriorityRequestHash(casePriorityInput.parse(h.input)) });
    expect(h.tx.testCase.update.mock.calls[0]![0].data).toEqual({ priority: "HIGH", updatedById: "native" }); expect(h.tx.testCaseVersion.create).not.toHaveBeenCalled();
    expect(h.events.indexOf("native-preflight")).toBeLessThan(h.events.indexOf("private-projection")); expect(h.events.indexOf("native-roundtrip")).toBeLessThan(h.events.indexOf("priority-only-update"));
    expect(h.queries.find(sql => sql.includes('INSERT INTO "TestCaseVersion"'))).toContain('c."verificationProfile"'); expect(h.tx.auditLog.create.mock.calls[0]![0]).toMatchObject({ data: { entityType: "TestCasePriority", metadata: { mode: "MANUAL", from: "MEDIUM", to: "HIGH", requestId: h.input.requestId } } });
  });
  it("own-version JSON freezes exactly six procedure fields, preserving NULL/empty/multiline/order/repeated text but no relational IDs", async () => {
    const h = fixture(); h.current.steps[0]!.action = "  Click\n button  "; h.current.steps[0]!.expectedActionOrData = ""; h.current.steps[0]!.expectedResult = " Exact result\nline "; h.current.steps[0]!.expectedResponse = null;
    h.current.steps.push({ ...h.current.steps[0]!, id: "second-internal-id", order: 1 }); h.state.steps = 2n; h.input.expectedCaseRevision = testCaseContentRevision(h.current);
    await setCasePriority(h.db, "native", h.input, { clerkActorId: "clerk" }, "native");
    const insertion = h.tx.$queryRaw.mock.calls.find(([raw]) => (raw as readonly string[]).join?.("?").includes('INSERT INTO "TestCaseVersion"'))!;
    const encoded = insertion.slice(1).find(value => typeof value === "string" && value.startsWith("[")) as string, steps = JSON.parse(encoded);
    expect(steps).toEqual(h.current.steps.map(({ order, action, expectedActionOrData, expectedResult, expectedResponse, mediaAttachmentIds }) => ({ order, action, expectedActionOrData, expectedResult, expectedResponse, mediaAttachmentIds })));
    for (const step of steps) { expect(Object.keys(step)).toEqual(["order", "action", "expectedActionOrData", "expectedResult", "expectedResponse", "mediaAttachmentIds"]); expect(step).not.toHaveProperty("id"); expect(step).not.toHaveProperty("testCaseId"); }
    expect(h.current.steps[0]!.id).toBe("step"); expect(h.current.steps[1]!.id).toBe("second-internal-id"); expect(h.input.expectedCaseRevision).toBe(testCaseContentRevision(h.current));
  });
  it("old exact receipt recovers before later oversize/deep/archived data and contains same-transaction native ACK", async () => {
    const h = fixture(); h.state.prior = { organizationId: "org", metadata: { requestHash: casePriorityRequestHash(casePriorityInput.parse(h.input)), to: "HIGH" } }; h.state.bytes = 3000000000n; h.current.archived = true; h.current.verificationProfile = null;
    const saved = await setCasePriority(h.db, "native", h.input, { clerkActorId: "clerk" }, "native"); expect(saved.replayed).toBe(true); expect(saved.readScope).toEqual(readScope); expect(h.events).toEqual(["full-editor-lock", "native-actor-lock", "prior-receipt"]); expect(h.tx.testCase.update).not.toHaveBeenCalled();
  });
  it.each(["full-editor", "native-author", "organization", "Clerk", "old-receipt-org"])("current original %s denial precedes private body/write and exact recovery", async reason => {
    const h = fixture(); let native = "native";
    if (reason === "full-editor") locks.project.mockRejectedValue(new TRPCError({ code: "FORBIDDEN" }));
    if (reason === "native-author") native = "replacement";
    if (reason === "organization") h.state.organizationId = "foreign";
    if (reason === "Clerk") locks.actor.mockResolvedValue("other-clerk");
    if (reason === "old-receipt-org") h.state.prior = { organizationId: "foreign", metadata: { requestHash: casePriorityRequestHash(casePriorityInput.parse(h.input)), to: "HIGH" } };
    await expect(setCasePriority(h.db, "native", h.input, { clerkActorId: "clerk" }, native)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(h.events).not.toContain("private-projection"); expect(h.tx.testCase.update).not.toHaveBeenCalled();
  });
  it.each([{ bytes: 524289n }, { bytes: 3000000000n }, { bytes: -1n }, { steps: 501n }, { sharedSteps: 501 }, { missingShared: true }])("whole native case/procedure bounds refuse before body without slicing", async patch => {
    const h = fixture(); Object.assign(h.state, patch); await expect(setCasePriority(h.db, "native", h.input, { clerkActorId: "clerk" }, "native")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(h.events).not.toContain("private-projection"); expect(h.tx.testCase.update).not.toHaveBeenCalled();
  });
  it("foreign shared procedure refuses before its text/size and never contributes a body or count", async () => {
    const h = fixture(); h.state.foreignShared = true; await expect(setCasePriority(h.db, "native", h.input, { clerkActorId: "clerk" }, "native")).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(h.events).not.toContain("native-preflight"); expect(h.events).not.toContain("private-projection");
  });
  it.each(["profileExact", "sharedExact"] as const)("native %s precision disagreement refuses before version/audit/update, no decoded numeric substitution", async key => {
    const h = fixture(); h.state[key] = false; await expect(setCasePriority(h.db, "native", h.input, { clerkActorId: "clerk" }, "native")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(h.tx.testCase.update).not.toHaveBeenCalled(); expect(h.events).not.toContain("native-version-copy"); expect(h.events).not.toContain("audit");
  });
  it("deep native metadata refuses before recursive hashing/stringification; no default profile repairs", async () => {
    const h = fixture(); let deep: unknown = null; for (let n = 0; n < 66; n++) deep = { retained: deep }; h.current.verificationProfile = deep;
    await expect(setCasePriority(h.db, "native", h.input, { clerkActorId: "clerk" }, "native")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(h.events).not.toContain("native-roundtrip"); expect(h.tx.testCase.update).not.toHaveBeenCalled();
  });
  it.each([null, false, 0, [], { unknown: { retained: [null, false, 0, ""] } }])("native profile root is retained by column copy, not Prisma JsonNull coercion or {} repair", async profile => {
    const h = fixture(); h.current.verificationProfile = profile; h.input.expectedCaseRevision = testCaseContentRevision(h.current); await setCasePriority(h.db, "native", h.input, { clerkActorId: "clerk" }, "native"); expect(h.tx.testCaseVersion.create).not.toHaveBeenCalled(); expect(h.events).toContain("native-version-copy");
  });
  it("fresh preview is schema-independent; read-only sees actual priority but cannot change/recover", async () => {
    const h = fixture(); h.state.role = "VIEWER"; h.state.seatType = "READ_ONLY"; const result = await previewCasePriority(h.db, "native", { projectId: "project", caseId: "case", requestId: randomUUID() }, { clerkActorId: "clerk" });
    expect(result).toMatchObject({ priority: "MEDIUM", canChange: false, canRecover: false, caseRevision: null }); expect(h.events).not.toContain("private-projection");
    h.state.role = "EDITOR"; h.state.seatType = "FULL"; const editable = await previewCasePriority(h.db, "native", { projectId: "project", caseId: "case", requestId: randomUUID(), expectedNativeActorId: "native" }, { clerkActorId: "clerk" }); expect(editable.canChange).toBe(true); expect(editable.caseRevision).toBe(h.input.expectedCaseRevision);
  });
  it("later unavailable preview retains exact recovery permission, not a fabricated new revision", async () => {
    const h = fixture(); h.state.profileExact = false; const result = await previewCasePriority(h.db, "native", { projectId: "project", caseId: "case", requestId: randomUUID() }, { clerkActorId: "clerk" }); expect(result).toMatchObject({ canRecover: true, canChange: false, caseRevision: null }); expect(result.blockedReason).toContain("No case fields");
  });
  it("stale CAS/archived/version overflow/frozen snapshot expansion refuses before priority update", async () => {
    for (const kind of ["CAS", "archive", "version", "frozen"]) { const h = fixture(); if (kind === "CAS") h.input.expectedCaseRevision = "b".repeat(64); if (kind === "archive") h.current.archived = true; if (kind === "version") h.state.maxVersion = 2147483647; if (kind === "frozen") h.state.frozenBytes = 524288n;
      await expect(setCasePriority(h.db, "native", h.input, { clerkActorId: "clerk" }, "native")).rejects.toMatchObject({ code: kind === "CAS" ? "CONFLICT" : kind === "archive" ? "BAD_REQUEST" : "PRECONDITION_FAILED" }); expect(h.tx.testCase.update).not.toHaveBeenCalled();
    }
  });
  it("strict shared normalization preserves old effective NULL/empty/media behavior and does not detach library", async () => {
    const h = fixture(); h.current.sharedStepGroupId = "group"; h.current.sharedStepGroup = { id: "group", projectId: "project", steps: [{ order: 0, action: "Shared", expectedActionOrData: "", expectedResult: null, expectedResponse: "200" }] }; h.state.sharedSteps = 1; h.input.expectedCaseRevision = testCaseContentRevision(h.current);
    await setCasePriority(h.db, "native", h.input, { clerkActorId: "clerk" }, "native"); expect(h.tx.testCase.update.mock.calls[0]![0].data).not.toHaveProperty("sharedStepGroupId");
    const insertion = h.tx.$queryRaw.mock.calls.find(([raw]) => (raw as readonly string[]).join?.("?").includes('INSERT INTO "TestCaseVersion"'))!; const encoded = insertion.slice(1).find(value => typeof value === "string" && value.startsWith("[")) as string;
    expect(JSON.parse(encoded)).toEqual([{ order: 0, action: "Shared", expectedActionOrData: "", expectedResult: null, expectedResponse: "200", mediaAttachmentIds: [] }]);
  });
  it("scoped source contains native round-trip/copy, no custom schema or generic risk/business override change", () => {
    const source = readFileSync(new URL("./casePriority.ts", import.meta.url), "utf8"); expect(source).not.toMatch(/caseFieldSchema\.parse|assertCaseFieldAuthoring|snapshotTestCaseVersion|riskAssessedAt\s*:/); expect(source).toContain('IS NOT DISTINCT FROM'); expect(source).toContain('c."verificationProfile"'); expect(source).toContain('LIMIT 501 FOR SHARE');
  });
});
