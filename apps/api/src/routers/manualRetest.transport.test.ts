import { randomUUID, createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Context } from "../trpc.js";
import { manualRetestReadRequestKey } from "../services/manualRetestScopeSchema.js";
import { retestPreviewInputSchema, retestStartInputSchema, manualRetestRequestHash } from "../services/manualRetest.js";
import { boundedRetestReviewedOutput, retestReviewedReadKey, retestPreviewReviewedOutput } from "../services/manualRetestReviewedSchema.js";
const mocks = vi.hoisted(() => ({ access: vi.fn(), preview: vi.fn(), links: vi.fn(), start: vi.fn(), transaction: vi.fn(), verify: vi.fn(), mirror: vi.fn() }));
vi.mock("../services/manualRetest.js", async importOriginal => ({ ...await importOriginal<typeof import("../services/manualRetest.js")>(), prepareManualRetest: mocks.preview, listManualRetestLinks: mocks.links, startManualRetest: mocks.start }));
vi.mock("../services/manualRetestScope.js", () => ({ lockManualRetestAccess: mocks.access }));
vi.mock("../clerk.js", () => ({ verifyClerkSessionToken: mocks.verify, getOrCreateLocalUser: mocks.mirror }));
vi.mock("@vaettir/db", () => ({ prisma: { $transaction: mocks.transaction }, Prisma: {} }));
import { manualRetestRouter } from "./manualRetest.js";

const native = "native-N", subject = "verified-human", stored = "stored-DB-mapping", scope = { projectId: "p", organizationId: "o", clerkActorId: subject, actorId: native };
const expectedScope = { projectId: "p", organizationId: "o", clerkActorId: subject };
const tx = { syntheticTransaction: true };
const endpoints = ["accessReviewed", "previewReviewed", "linksReviewed", "startReviewed"] as const;
function fixture() {
  const request = retestPreviewInputSchema.parse({ projectId: "p", sourceRunId: "source", testCaseId: "case", expectedScope });
  const start = retestStartInputSchema.parse({ ...request, expectedReviewHash: "a".repeat(64), idempotencyKey: randomUUID() });
  const read = { request, readRequestId: randomUUID(), expectedNativeActorId: native }, links = { ...read, request: { ...request, before: "older" } };
  const definition = { testCaseId: "case", title: " Captured\n title ", validationDomain: "SOFTWARE", reviewStatus: "APPROVED", background: null, given: ["", " Raw Given "], when: [" Raw When "], then: [" Raw Then "], verificationProfile: { setup: "", safety: "", instruments: "", acceptanceCriteria: "" }, steps: [{ order: 0, action: " Click\n here ", expectedActionOrData: " GET\n /synthetic ", expectedResult: "", expectedResponse: null, mediaAttachmentIds: [] }] };
  const preview = { scope, requested: manualRetestReadRequestKey(request), stepFieldLabels: { action: " Tester action ", expectedActionOrData: " Technical behavior " }, projectId: "p", sourceRunId: "source", testCaseId: "case", displayId: "TC-1", reviewHash: start.expectedReviewHash, sourceOutcome: "FAIL" as const, configuration: { configuration: "", platform: "", build: "", hardwareRevision: "", firmwareVersion: "", rig: "", batchOrLot: "", environment: " Raw\n environment ", calibrationReference: "", protocolReference: "" }, caseDefinitions: [definition], sourceResults: [{ id: "result", testCaseId: "case", status: "FAIL" as const, note: "", errorMessage: null, observations: { specimen: "", hardwareRevision: "", firmwareVersion: "", environment: "", measurements: [{ name: " Voltage ", unit: " V ", value: 0, lowerLimit: 0, instrument: " Meter\n name " }] } }], prerequisiteCount: 0, credits: 0 as const, sourceDatasetExecution: null };
  const linked = { scope, requested: manualRetestReadRequestKey(links.request), original: null, retests: [{ testRunId: "retained", startedAt: new Date("2026-10-06T12:00:00.123Z"), status: "RUNNING" as const }], nextCursor: null };
  const ack = { testRunId: `retest_${createHash("sha256").update(JSON.stringify(["p", native, start.idempotencyKey])).digest("hex")}`, recovered: false, scope: { ...scope, sourceRunId: "source", testCaseId: "case", idempotencyKey: start.idempotencyKey, reviewHash: start.expectedReviewHash } };
  return { inputs: { accessReviewed: read, previewReviewed: read, linksReviewed: links, startReviewed: { request: start, expectedNativeActorId: native } }, request, start, preview, linked, ack };
}
function caller(subjectValue: unknown = subject, actor = native, signedIn = true, omitted = false) {
  const db = { $transaction: mocks.transaction }, user = signedIn ? { id: actor, clerkUserId: stored, memberships: [{ organizationId: "o", role: "OWNER", seatType: "FULL" }] } : null;
  return { db, user, api: manualRetestRouter.createCaller({ prisma: db, user, staff: null, ...(omitted ? {} : { authenticatedClerkSubject: subjectValue }) } as unknown as Context) };
}
function zeroNative() { for (const mock of [mocks.access, mocks.preview, mocks.links, mocks.start, mocks.transaction, mocks.verify, mocks.mirror]) expect(mock).not.toHaveBeenCalled(); }
beforeEach(() => {
  vi.resetAllMocks(); mocks.transaction.mockImplementation(async (work: (transaction: typeof tx) => unknown) => work(tx));
});
describe("actual retest protected input/output transport — native services, locks and JWT verification MOCKED, NOT native acceptance", () => {
  for (const endpoint of endpoints) {
    it.each([null, "", "   ", undefined, "x".repeat(201)])(`${endpoint} rejects missing/blank/unbounded independent subject before native discovery despite stored mapping`, async value => {
      const f = fixture(), h = caller(value === undefined ? null : value);
      await expect(h.api[endpoint](f.inputs[endpoint] as never)).rejects.toMatchObject({ code: "FORBIDDEN" }); zeroNative();
    });
    it(`${endpoint} rejects genuinely omitted provenance and an API-key backing user before native calls`, async () => {
      const f = fixture();
      await expect(caller(null, native, true, true).api[endpoint](f.inputs[endpoint] as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(null, "api-key-backing-user").api[endpoint](f.inputs[endpoint] as never)).rejects.toMatchObject({ code: "FORBIDDEN" }); zeroNative();
    });
    it(`${endpoint} explicit undefined provenance is not reconstructed from stored mapping`, async () => {
      const f = fixture(), h = manualRetestRouter.createCaller({ prisma: { $transaction: mocks.transaction }, user: { id: native, clerkUserId: stored, memberships: [] }, staff: null, authenticatedClerkSubject: undefined } as unknown as Context);
      await expect(h[endpoint](f.inputs[endpoint] as never)).rejects.toMatchObject({ code: "FORBIDDEN" }); zeroNative();
    });
    it(`${endpoint} remains protected signed-out even with fabricated provenance`, async () => {
      const f = fixture(); await expect(caller(subject, native, false).api[endpoint](f.inputs[endpoint] as never)).rejects.toMatchObject({ code: "UNAUTHORIZED" }); zeroNative();
    });
    it(`${endpoint} original N cannot silently follow a same-Clerk native M mapping`, async () => {
      const f = fixture(); await expect(caller(subject, "native-M").api[endpoint](f.inputs[endpoint] as never)).rejects.toMatchObject({ code: "FORBIDDEN" }); zeroNative();
    });
    it(`${endpoint} expected subject cannot use stored mapping in place of independent subject`, async () => {
      const f = fixture(); const input = { ...f.inputs[endpoint], request: { ...f.inputs[endpoint].request, expectedScope: { ...expectedScope, clerkActorId: stored } } };
      await expect(caller().api[endpoint](input as never)).rejects.toMatchObject({ code: "FORBIDDEN" }); zeroNative();
    });
    it(`${endpoint} strict envelope rejects injected authority/extra fields`, async () => {
      const f = fixture(); await expect(caller().api[endpoint]({ ...f.inputs[endpoint], actorId: "forged" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); zeroNative();
    });
  }
  it("metadata ACCESS uses locked original actor/verified subject with unchanged RR20s and includes no source/private body", async () => {
    const f = fixture(), h = caller(); mocks.access.mockResolvedValue(scope);
    expect(await h.api.accessReviewed(f.inputs.accessReviewed)).toEqual({ readContext: { requestId: f.inputs.accessReviewed.readRequestId, requested: retestReviewedReadKey(f.inputs.accessReviewed), projection: "ACCESS", scope }, basis: "CURRENT_PROJECT_MEMBER_ONLY", sourceRelationshipVerified: false });
    expect(mocks.access).toHaveBeenCalledWith(tx, native, f.request, false, subject); expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 20000, isolationLevel: "RepeatableRead" });
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.links).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled(); expect(h.user!.clerkUserId).toBe(stored);
  });
  it("initial ACCESS can omit native pin, but private preview/links/start cannot and no cached pin is fabricated", async () => {
    const f = fixture(), h = caller(); const { expectedNativeActorId: _pin, ...read } = f.inputs.accessReviewed; mocks.access.mockResolvedValue(scope);
    const out = await h.api.accessReviewed(read); expect(out.readContext.requested).toBe(retestReviewedReadKey(read));
    for (const name of ["previewReviewed", "linksReviewed", "startReviewed"] as const) {
      const { expectedNativeActorId: _required, ...missing } = f.inputs[name]; await expect(h.api[name](missing as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });
  it("preview forwards exact old request and verified subject under native transaction; normalization basis explicit and hidden frozen machinery absent", async () => {
    const f = fixture(), h = caller(); mocks.preview.mockResolvedValue({ ...f.preview, frozen: { privateMarker: "PRIVATE_FROZEN" }, ordered: ["case"], prerequisites: { case: [] } });
    const out = await h.api.previewReviewed(f.inputs.previewReviewed);
    expect(out.preview).toEqual(f.preview); expect(out.basis).toBe("LEGACY_BOUNDED_PREPARATION_V1"); expect(out.readContext.scope.actorId).toBe(native);
    expect(mocks.preview).toHaveBeenCalledWith(tx, native, f.request, false, subject); expect(JSON.stringify(out)).not.toContain("PRIVATE_FROZEN");
    expect(out.preview.caseDefinitions[0]!.steps[0]).toMatchObject({ action: " Click\n here ", expectedResult: "", expectedResponse: null }); expect(out.preview.sourceResults[0]!.observations.measurements[0]!.value).toBe(0);
  });
  it.each(["projectId", "sourceRunId", "testCaseId"] as const)("preview mismatched %s cannot be blessed by a freshly constructed current reader envelope", async field => {
    const f = fixture(); mocks.preview.mockResolvedValue({ ...f.preview, [field]: "foreign" });
    await expect(caller().api.previewReviewed(f.inputs.previewReviewed)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
  it("links pass exact cursor and subject through existing service transaction; current labels remain separate from captured outcome", async () => {
    const f = fixture(), h = caller(); mocks.links.mockResolvedValue(f.linked);
    const out = await h.api.linksReviewed(f.inputs.linksReviewed); expect(out.links).toEqual(f.linked); expect(mocks.links).toHaveBeenCalledWith(h.db, native, f.inputs.linksReviewed.request, subject); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each([false, true])("new or recovered legacy receipt (%s) preserves unchanged inner hash/N+UUID identity and exact old ACK", async recovered => {
    const f = fixture(), h = caller(), before = JSON.stringify(f.start), hash = manualRetestRequestHash(f.start); mocks.start.mockResolvedValue({ ...f.ack, recovered });
    expect(await h.api.startReviewed(f.inputs.startReviewed)).toEqual({ ...f.ack, recovered });
    expect(mocks.start).toHaveBeenCalledWith(h.db, native, f.start, subject); expect(JSON.stringify(mocks.start.mock.calls[0]![2])).toBe(before); expect(manualRetestRequestHash(mocks.start.mock.calls[0]![2])).toBe(hash);
    expect(f.start).not.toHaveProperty("expectedNativeActorId"); expect(f.start).not.toHaveProperty("readRequestId");
  });
  it.each(["native", "subject", "run", "UUID", "hash", "source", "case"])("a mismatched %s ACK is generic UNKNOWN-capable failure, not false success or private body", async field => {
    const f = fixture(), ack = structuredClone(f.ack);
    if (field === "native") ack.scope.actorId = "native-M"; if (field === "subject") ack.scope.clerkActorId = stored;
    if (field === "run") ack.testRunId = "retained-foreign"; if (field === "UUID") ack.scope.idempotencyKey = randomUUID(); if (field === "hash") ack.scope.reviewHash = "b".repeat(64); if (field === "source") ack.scope.sourceRunId = "foreign"; if (field === "case") ack.scope.testCaseId = "foreign";
    mocks.start.mockResolvedValue(ack); await expect(caller().api.startReviewed(f.inputs.startReviewed)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
  it.each(["accessReviewed", "previewReviewed", "linksReviewed"] as const)("%s refuses mismatched native output pin instead of exposing private projection", async name => {
    const f = fixture(); const foreign = { ...scope, actorId: "native-M" };
    mocks.access.mockResolvedValue(foreign); mocks.preview.mockResolvedValue({ ...f.preview, scope: foreign }); mocks.links.mockResolvedValue({ ...f.linked, scope: foreign });
    await expect(caller().api[name](f.inputs[name] as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["accessReviewed", "previewReviewed", "linksReviewed", "startReviewed"] as const)("%s never returns private native/retained error text", async name => {
    const f = fixture(), error = new TRPCError({ code: "PRECONDITION_FAILED", message: "PRIVATE_BODY_MARKER original note" });
    mocks.access.mockRejectedValue(error); mocks.preview.mockRejectedValue(error); mocks.links.mockRejectedValue(error); mocks.start.mockRejectedValue(error);
    const failed = caller().api[name](f.inputs[name] as never); await expect(failed).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); await expect(failed).rejects.not.toHaveProperty("message", expect.stringContaining("PRIVATE_BODY_MARKER"));
  });
  it("whole DTO bound and strict shape refuse rather than clip/default/normalize unsupported fields", () => {
    const f = fixture(), envelope = { readContext: { requestId: f.inputs.previewReviewed.readRequestId, requested: retestReviewedReadKey(f.inputs.previewReviewed), projection: "PREVIEW", scope }, basis: "LEGACY_BOUNDED_PREPARATION_V1", preview: f.preview };
    expect(boundedRetestReviewedOutput(retestPreviewReviewedOutput, envelope)).toEqual(envelope);
    expect(() => boundedRetestReviewedOutput(z.unknown(), { text: "x".repeat(2097152) })).toThrow();
    expect(() => boundedRetestReviewedOutput(z.unknown(), {}, Infinity)).toThrow(); expect(() => boundedRetestReviewedOutput(z.unknown(), {}, 2097153)).toThrow();
    const missing = structuredClone(envelope); Reflect.deleteProperty(missing.preview.caseDefinitions[0]!.steps[0]!, "expectedResponse"); expect(() => boundedRetestReviewedOutput(retestPreviewReviewedOutput, missing)).toThrow();
    expect(() => boundedRetestReviewedOutput(retestPreviewReviewedOutput, { ...envelope, unknown: "retain-not-drop" })).toThrow();
    const hook = vi.fn(() => "PRIVATE"), unsafe = Object.defineProperty({}, "private", { get: hook, enumerable: true }); expect(() => boundedRetestReviewedOutput(z.unknown(), unsafe)).toThrow(); expect(hook).not.toHaveBeenCalled();
    const labels = JSON.parse('{"__proto__":"retained"}') as Record<string, string>; expect(() => boundedRetestReviewedOutput(retestPreviewReviewedOutput, { ...envelope, preview: { ...f.preview, stepFieldLabels: labels } })).toThrow();
  });
  it("DTO admission refuses deep structures, array metadata and Date accessors without invoking hooks", () => {
    let deep: unknown = null; for (let i = 0; i < 66; i++) deep = { nested: deep };
    expect(() => boundedRetestReviewedOutput(z.unknown(), deep)).toThrow();
    const extra = [0]; Reflect.set(extra, Symbol("private"), "retained"); expect(() => boundedRetestReviewedOutput(z.unknown(), extra)).toThrow();
    const invoke = vi.fn(() => 0), badDate = Object.defineProperty(new Date(), "getTime", { get: invoke });
    expect(() => boundedRetestReviewedOutput(z.unknown(), { startedAt: badDate })).toThrow(); expect(invoke).not.toHaveBeenCalled();
  });
  it("legacy endpoints retain old parsing/optional scope omission/cached actor wire, not reviewed proof", async () => {
    const f = fixture(), h = caller(null), { expectedScope: _scope, ...legacy } = f.request;
    mocks.preview.mockResolvedValue({ ...f.preview, frozen: {}, ordered: [], prerequisites: {} }); mocks.links.mockResolvedValue(f.linked); mocks.start.mockResolvedValue({ testRunId: f.ack.testRunId, recovered: true });
    await h.api.preview(legacy); await h.api.links(legacy); const start = { ...legacy, expectedReviewHash: f.start.expectedReviewHash, idempotencyKey: f.start.idempotencyKey };
    expect(await h.api.start(start)).toEqual({ testRunId: f.ack.testRunId, recovered: true });
    expect(mocks.preview).toHaveBeenCalledWith(tx, native, legacy, false, stored); expect(mocks.links).toHaveBeenCalledWith(h.db, native, legacy, stored); expect(mocks.start).toHaveBeenCalledWith(h.db, native, start, stored);
    expect(mocks.access).not.toHaveBeenCalled(); expect(retestStartInputSchema.parse(start)).not.toHaveProperty("expectedScope");
  });
});
