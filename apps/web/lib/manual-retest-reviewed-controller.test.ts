// Actual isolated controller + complete admitted synthetic DTOs. No RPC/native
// execution; SDK/cache listener behavior belongs to the separate access hook.
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManualRetestReviewedController, reviewedRetestRequestHash, type ReviewedRetestEnvelope, type ReviewedRetestFrame } from "./manual-retest-reviewed-controller";
import { admitRetestRead, retestReviewedBrowserKey, type RetestProjection, type RetestReviewedInput, type RetestReviewedSnapshot } from "./manual-retest-reviewed-read";
const scope = { projectId: "p", organizationId: "o", clerkActorId: "cl" };
const uuid = "88c47b3b-d1f7-43b5-bd88-b49ddf14b8c0", hash = "a".repeat(64);
const request = () => ({ projectId: "p", sourceRunId: "run", testCaseId: "case", expectedScope: { ...scope }, expectedReviewHash: hash, idempotencyKey: uuid });
function ack(r = request(), native = "n", recovered = false) { return { testRunId: `retest_${createHash("sha256").update(JSON.stringify([r.projectId, native, r.idempotencyKey])).digest("hex")}`, recovered, scope: { ...scope, actorId: native, sourceRunId: r.sourceRunId, testCaseId: r.testCaseId, idempotencyKey: r.idempotencyKey, reviewHash: r.expectedReviewHash } }; }
let nonce = 0;
function snapshot(projection: RetestProjection = "PREVIEW", session = "A", reviewHash = hash, ids: string[] = [], native = "n"): RetestReviewedSnapshot {
  const input: RetestReviewedInput = { request: { projectId: "p", sourceRunId: "run", testCaseId: "case", expectedScope: scope }, expectedNativeActorId: native, readRequestId: `6ee2ec04-4d34-40bf-b0e9-${String(++nonce).padStart(12, "0")}` };
  const nativeScope = { ...scope, actorId: native }, readContext = { requestId: input.readRequestId, requested: retestReviewedBrowserKey(input), projection, scope: nativeScope }, requested = JSON.stringify(JSON.parse(readContext.requested).request);
  let data: unknown = { readContext, basis: "CURRENT_PROJECT_MEMBER_ONLY", sourceRelationshipVerified: false };
  if (projection === "LINKS") data = { readContext, links: { scope: nativeScope, requested, original: null, retests: ids.map(testRunId => ({ testRunId, startedAt: "2026-10-06T12:00:00.123Z", status: "RUNNING" })), nextCursor: null } };
  if (projection === "PREVIEW") data = { readContext, basis: "LEGACY_BOUNDED_PREPARATION_V1", preview: {
    scope: nativeScope, requested, projectId: "p", sourceRunId: "run", testCaseId: "case", displayId: "TC-1", reviewHash, sourceOutcome: "FAIL", stepFieldLabels: { action: "Tester action", expectedActionOrData: "Technical behavior / data" },
    configuration: { configuration: "", platform: "", build: "", hardwareRevision: "", firmwareVersion: "", rig: "", batchOrLot: "", environment: " Line one\nline two ", calibrationReference: "", protocolReference: "" },
    caseDefinitions: [{ testCaseId: "case", title: " Exact\n title ", validationDomain: "SOFTWARE", reviewStatus: "APPROVED", background: null, given: ["", " Given "], when: [" When "], then: [" Then "], verificationProfile: { setup: "", safety: "", instruments: "", acceptanceCriteria: "" }, steps: [{ order: 0, action: " Click\n button ", expectedActionOrData: " GET /synthetic ", expectedResult: "", expectedResponse: null, mediaAttachmentIds: ["ref"] }] }],
    sourceResults: [{ id: "result", testCaseId: "case", status: "FAIL", note: null, errorMessage: "", observations: { specimen: "", hardwareRevision: "", firmwareVersion: "", environment: "", measurements: [{ name: "Reading", unit: "V", value: 0, lowerLimit: 0, instrument: "Meter" }] } }], prerequisiteCount: 0, credits: 0, sourceDatasetExecution: null,
  } };
  const admitted = admitRetestRead(data, input, projection, "cl", null); if (!admitted) throw Error("Invalid complete synthetic fixture");
  return Object.freeze({ origin: admitted.origin, observedSessionId: session, projection, epoch: nonce, revision: nonce, receivedAt: "2026-10-06T12:00:00.000Z", data: admitted.data });
}
function harness(initial = snapshot()) {
  const publication = vi.fn(), c = new ManualRetestReviewedController(publication);
  let live: RetestReviewedSnapshot | null = initial, frame: ReviewedRetestFrame = { snapshot: initial, current: () => live, open: true, active: true }, sdk: {userId:string;sessionId:string}|null = { userId: "cl", sessionId: initial.observedSessionId };
  c.attach(); c.bind(frame);
  return { c, publication, current: () => live, session: () => sdk, sdk: (v: typeof sdk) => { sdk = v; }, revoke: () => { live = null; },
    bind(next: RetestReviewedSnapshot | null, open = true) { live = next; frame = { snapshot: next, current: () => live, open, active: true }; c.bind(frame); },
    render(next: RetestReviewedSnapshot | null, open = true) { frame = { snapshot: next, current: () => live, open, active: true }; return c.renderView(frame); },
  };
}
function deferred<T>() { let resolve!: (v:T)=>void; const promise = new Promise<T>(r=> {resolve=r;}); return {promise,resolve}; }
beforeEach(() => { nonce = 0; vi.stubGlobal("crypto", webcrypto); });
afterEach(() => vi.unstubAllGlobals());
it("hash is the exact sorted old projection; UUID/native envelope omitted and absent scope never defaulted", async () => {
  const canonical = (v: unknown): string => v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string,unknown>)[k])}`).join(",")}}` : JSON.stringify(v);
  const r = request(), { idempotencyKey: omitted, ...projection } = r; expect(omitted).toBe(uuid);
  expect(await reviewedRetestRequestHash(r)).toBe(createHash("sha256").update(canonical(projection)).digest("hex"));
  expect(await reviewedRetestRequestHash({ ...r, idempotencyKey: "9b9c47bb-abeb-4338-85b1-3e96cff2f1ad" })).toBe(await reviewedRetestRequestHash(r));
  const bare = { projectId: r.projectId, sourceRunId: r.sourceRunId, testCaseId: r.testCaseId, expectedReviewHash: hash, idempotencyKey: uuid };
  expect(await reviewedRetestRequestHash(bare)).not.toBe(await reviewedRetestRequestHash(r));
  expect(await reviewedRetestRequestHash({...bare,expectedScope:undefined})).toBe(await reviewedRetestRequestHash(bare));
});
it.each(["ACCESS", "LINKS"] as const)("%s is not FULL authority for review/start or UNKNOWN replay", async projection => {
  const h = harness(snapshot(projection)), send = vi.fn(); expect(h.c.view().canReview).toBe(false); expect(await h.c.review(request(),h.session,h.c.view().epoch)).toBe(false);
  expect(await h.c.retainLegacySubmitted(request(),snapshot().origin,"A")).toBe(true); expect(h.c.view().canRetry).toBe(false); expect(await h.c.submit(h.c.view().epoch,send,h.session)).toBe(false); expect(send).not.toHaveBeenCalled();
});
it("complete exact preview preserves null/blank/newline/zero and review is deliberate, immutable and busy-latched", async () => {
  const h = harness(), s = h.current(); if (!s || !("preview" in s.data)) throw Error("fixture");
  expect(s.data.preview.configuration.environment).toBe(" Line one\nline two "); expect(s.data.preview.sourceResults[0]?.note).toBeNull(); expect(s.data.preview.sourceResults[0]?.observations.measurements[0]?.value).toBe(0);
  const r = request(), before = JSON.stringify(r), epoch = h.c.view().epoch, first = h.c.review(r,h.session,epoch); r.expectedReviewHash = "b".repeat(64); r.expectedScope.organizationId = "other";
  expect(await h.c.review(request(),h.session,epoch)).toBe(false); expect(await first).toBe(true);
  const send = vi.fn(async (input:Readonly<ReviewedRetestEnvelope>) => { expect(JSON.stringify(input.request)).toBe(before); expect(Object.isFrozen(input)).toBe(true); expect(Object.isFrozen(input.request.expectedScope)).toBe(true); expect(input.expectedNativeActorId).toBe("n"); return ack(); });
  expect(await h.c.submit(epoch,send,h.session)).toBe(true); expect(send).toHaveBeenCalledTimes(1); expect(h.c.view()).toMatchObject({known:true,pending:false,canReview:false,canSubmit:false,receipt:null});
});
it.each(["native", "hash", "scope", "UUID"])("changed %s request/current tuple does not create or replace original review", async changed => {
  const h = harness(); const r = request(); if (changed === "hash") r.expectedReviewHash="b".repeat(64); if (changed === "scope") r.expectedScope.clerkActorId="other"; if (changed === "UUID") r.idempotencyKey="not-uuid"; if (changed === "native") h.bind(snapshot("PREVIEW","A",hash,[],"M"));
  expect(await h.c.review(r,h.session,h.c.view().epoch)).toBe(false); expect(h.c.view().reviewed).toBe(false);
});
it("getters and oversized requests are refused before local hash/property effects", async () => {
  const h=harness(), invoke=vi.fn(()=>hash), r=Object.defineProperty(request(),"expectedReviewHash",{enumerable:true,get:invoke});
  expect(await h.c.review(r,h.session,h.c.view().epoch)).toBe(false); expect(invoke).not.toHaveBeenCalled(); expect(await h.c.review({...request(),projectId:"x".repeat(9000)},h.session,h.c.view().epoch)).toBe(false);
});
it("shallow-frozen/unsupported snapshot facades cannot bind approval or replace current private metadata", () => {
  const initial=snapshot(),raw=structuredClone(initial.data),shallow=Object.freeze({ ...initial,data:Object.freeze(raw) });const h=harness(shallow);
  expect(h.c.view()).toMatchObject({readable:false,canReview:false});h.bind(snapshot());expect(h.c.view().canReview).toBe(true);
  const invoke=vi.fn(()=>initial.origin),withGetter=Object.freeze(Object.defineProperty({...initial},"origin",{enumerable:true,get:invoke}));h.bind(withGetter);expect(h.c.view().readable).toBe(false);expect(invoke).not.toHaveBeenCalled();
});
it("pre-layout close/native-frame replacement blocks captured submit before dispatch", async () => {
  const h=harness(), epoch=h.c.view().epoch; expect(await h.c.review(request(),h.session,epoch)).toBe(true); const send=vi.fn(); h.render(h.current(),false);
  expect(await h.c.submit(epoch,send,h.session)).toBe(false); expect(send).not.toHaveBeenCalled(); h.bind(snapshot()); expect(h.c.view().canSubmit).toBe(false);
});
it("SDK change without React commit revokes current request; restore alone cannot revive nonce", async () => {
  const h=harness(), epoch=h.c.view().epoch; expect(await h.c.review(request(),h.session,epoch)).toBe(true); const s=h.current(),send=vi.fn(); h.sdk({userId:"cl",sessionId:"B"});
  expect(await h.c.submit(epoch,send,h.session)).toBe(false); h.sdk({userId:"cl",sessionId:"A"}); h.bind(s); expect(h.c.view().canSubmit).toBe(false); expect(send).not.toHaveBeenCalled();
  h.bind(snapshot("PREVIEW","B")); h.sdk({userId:"cl",sessionId:"B"}); expect(h.c.view().canReview).toBe(true); expect(h.c.view().canSubmit).toBe(false);
});
it("cache/current reader A-B-A cannot re-admit old positively posted activation", async () => {
  const h=harness(), s=h.current(); h.revoke(); expect(h.c.view().readable).toBe(false); h.bind(s); expect(h.c.view().readable).toBe(false); h.bind(snapshot()); expect(h.c.view().canReview).toBe(true);
});
it("waiting first ACCESS completion is not poisoned before positive committed admission", () => {
  const h=harness(), next=snapshot("ACCESS"); h.bind(null); h.render(next); h.bind(next); expect(h.c.view().readable).toBe(true);
});
it("UNKNOWN then authoritative refusal retains byte-identical UUID/body through renewed owner session B", async () => {
  const h=harness(), r=request(), body=JSON.stringify(r), calls:Readonly<ReviewedRetestEnvelope>[]= []; expect(await h.c.review(r,h.session,h.c.view().epoch)).toBe(true);
  const unknown=vi.fn(async (input:Readonly<ReviewedRetestEnvelope>)=>{calls.push(input);throw Error("PRIVATE PROVIDER TOKEN");}); expect(await h.c.submit(h.c.view().epoch,unknown,h.session)).toBe(false); expect(h.c.view()).toMatchObject({pending:true,known:false}); expect(h.c.view().error).not.toContain("PRIVATE");
  h.sdk({userId:"cl",sessionId:"B"}); h.revoke(); expect(h.c.view().canRetry).toBe(false); h.bind(snapshot("ACCESS","B")); expect(h.c.view().canRetry).toBe(false);
  h.bind(snapshot("PREVIEW","B","b".repeat(64))); expect(h.c.view().canRetry).toBe(true);
  const refusal=vi.fn(async(input:Readonly<ReviewedRetestEnvelope>)=>{calls.push(input);throw {data:{code:"CONFLICT"},message:"PRIVATE"};}); expect(await h.c.submit(h.c.view().epoch,refusal,h.session)).toBe(false); expect(h.c.view().pending).toBe(true);
  const confirm=vi.fn(async(input:Readonly<ReviewedRetestEnvelope>)=>{calls.push(input);return ack(request(),"n",true);}); expect(await h.c.submit(h.c.view().epoch,confirm,h.session)).toBe(true);
  expect(calls).toHaveLength(3); expect(calls[0]).toBe(calls[1]); expect(calls[1]).toBe(calls[2]); for(const c of calls) expect(JSON.stringify(c.request)).toBe(body); expect(h.c.view().receipt).toBeNull();
});
it("first definitive refusal releases only unambiguous held attempt, not caller's raw draft", async () => {
  const h=harness(),r=request(),before=structuredClone(r); await h.c.review(r,h.session,h.c.view().epoch);
  expect(await h.c.submit(h.c.view().epoch,async()=>{throw {data:{code:"BAD_REQUEST"},message:"PRIVATE"};},h.session)).toBe(false); expect(h.c.view()).toMatchObject({pending:false,reviewed:false,canReview:true}); expect(r).toEqual(before);
});
it.each(["close", "detach", "readerLoss", "SDK"])("late exact ACK after %s privately settles, only fresh exact LINKS can publish target", async loss => {
  const h=harness(); await h.c.review(request(),h.session,h.c.view().epoch); const d=deferred<unknown>(),send=vi.fn(()=>d.promise),submit=h.c.submit(h.c.view().epoch,send,h.session),publish=vi.fn();
  if(loss==="close")h.bind(h.current(),false); if(loss==="detach")h.c.detach(); if(loss==="readerLoss")h.revoke(); if(loss==="SDK"){h.sdk({userId:"cl",sessionId:"B"});h.revoke();}
  d.resolve(ack()); expect(await submit).toBe(true); expect(h.c.view()).toMatchObject({known:true,pending:false,receipt:null}); expect(h.c.publishConfirmed(h.session(),h.c.view().epoch,publish)).toBe(false); expect(publish).not.toHaveBeenCalled();
  if(loss==="detach")h.c.attach(); h.sdk({userId:"cl",sessionId:"B"});h.bind(snapshot("LINKS","B",hash,["other"])); expect(h.c.view().canPublish).toBe(false);
  h.bind(snapshot("LINKS","B",hash,[ack().testRunId])); expect(h.c.view().receipt?.testRunId).toBe(ack().testRunId); const epoch=h.c.view().epoch; expect(h.c.publishConfirmed(h.session(),epoch,publish)).toBe(true); expect(h.c.publishConfirmed(h.session(),epoch,publish)).toBe(false); expect(publish).toHaveBeenCalledTimes(1); expect(send).toHaveBeenCalledTimes(1);
});
it("reentrant dispatch/navigation is latched synchronously and close inside final dispatch gate sends nothing", async () => {
  const h=harness(); await h.c.review(request(),h.session,h.c.view().epoch); const send=vi.fn(async()=>ack()),epoch=h.c.view().epoch;
  expect(await h.c.submit(epoch,send,h.session,()=>h.render(h.current(),false))).toBe(false); expect(send).not.toHaveBeenCalled();
  h.bind(snapshot()); await h.c.review(request(),h.session,h.c.view().epoch); const nextEpoch=h.c.view().epoch;
  const reentrant=vi.fn(async()=>{expect(await h.c.submit(nextEpoch,send,h.session)).toBe(false);return ack();}); expect(await h.c.submit(nextEpoch,reentrant,h.session)).toBe(true); expect(send).not.toHaveBeenCalled();
  h.bind(snapshot("LINKS","A",hash,[ack().testRunId])); const e=h.c.view().epoch,nav=vi.fn(); expect(h.c.publishConfirmed(h.session(),e,()=>{expect(h.c.publishConfirmed(h.session(),e,nav)).toBe(false);})).toBe(true); expect(nav).not.toHaveBeenCalled();
});
it("malformed/forged M-owner ACK never consumes pending even with internally consistent deterministic ID", async () => {
  const h=harness(); await h.c.review(request(),h.session,h.c.view().epoch); expect(await h.c.submit(h.c.view().epoch,async()=>ack(request(),"M"),h.session)).toBe(false); expect(h.c.view()).toMatchObject({pending:true,known:false,canRetry:true});
});
it("legacy bare body is retained without injecting scope/pins, but never transmittable through reviewed wrapper", async () => {
  const h=harness(),r=request(),bare={projectId:r.projectId,sourceRunId:r.sourceRunId,testCaseId:r.testCaseId,expectedReviewHash:r.expectedReviewHash,idempotencyKey:r.idempotencyKey},before=JSON.stringify(bare),s=h.current();if(!s)throw Error("fixture");
  expect(await h.c.retainLegacySubmitted(bare,s.origin,"A")).toBe(true); expect(h.c.view()).toMatchObject({pending:true,canRetry:false}); expect(JSON.stringify(bare)).toBe(before); const send=vi.fn();expect(await h.c.submit(h.c.view().epoch,send,h.session)).toBe(false);expect(send).not.toHaveBeenCalled();
});
it("legacy migration retains exact key order/scoped body and refuses native remap claims", async () => {
  const h=harness(),s=h.current();if(!s)throw Error("fixture"); expect(await h.c.retainLegacySubmitted(request(),{...s.origin,nativeActorId:"M"},"A")).toBe(false);
  const r={idempotencyKey:uuid,expectedReviewHash:hash,expectedScope:{clerkActorId:"cl",organizationId:"o",projectId:"p"},testCaseId:"case",sourceRunId:"run",projectId:"p"},before=JSON.stringify(r);
  expect(await h.c.retainLegacySubmitted(r,s.origin,"A")).toBe(true); const send=vi.fn(async(input:Readonly<ReviewedRetestEnvelope>)=>{expect(JSON.stringify(input.request)).toBe(before);return ack();});expect(await h.c.submit(h.c.view().epoch,send,h.session)).toBe(true);
});
it("dead-instance cleanup during retention hash cannot admit a later mounted attempt", async () => {
  const h=harness(),s=h.current();if(!s)throw Error("fixture"); const p=h.c.retainLegacySubmitted(request(),s.origin,"A");h.c.detach();h.c.attach();h.bind(snapshot());expect(await p).toBe(false);expect(h.c.view().pending).toBe(false);
});
it("migration clones both legacy body and original native claim before asynchronous hash", async () => {
  const h=harness(),s=h.current();if(!s)throw Error("fixture");
  const r=request(),body=JSON.stringify(r),origin={...s.origin};const retaining=h.c.retainLegacySubmitted(r,origin,"A");
  r.expectedScope.organizationId="foreign";origin.nativeActorId="M";expect(await retaining).toBe(true);
  const send=vi.fn(async(input:Readonly<ReviewedRetestEnvelope>)=>{expect(JSON.stringify(input.request)).toBe(body);expect(input.expectedNativeActorId).toBe("n");return ack();});expect(await h.c.submit(h.c.view().epoch,send,h.session)).toBe(true);
  const bareHarness=harness(),bare={projectId:"p",sourceRunId:"run",testCaseId:"case",expectedReviewHash:hash,idempotencyKey:uuid},bareSnapshot=bareHarness.current();if(!bareSnapshot)throw Error("fixture");
  const p=bareHarness.c.retainLegacySubmitted(bare,bareSnapshot.origin,"A");Object.assign(bare,{expectedScope:scope});expect(await p).toBe(true);expect(bareHarness.c.view().canRetry).toBe(false);
});
it("unsupported source read has no recovery authority and preserves UNKNOWN until supported original preview", async () => {
  const h=harness();await h.c.review(request(),h.session,h.c.view().epoch);const send=vi.fn(async()=>{throw Error("lost response");});await h.c.submit(h.c.view().epoch,send,h.session);
  h.bind(null);expect(h.c.view()).toMatchObject({pending:true,readable:false,canRetry:false,receipt:null,error:null});expect(await h.c.submit(h.c.view().epoch,send,h.session)).toBe(false);expect(send).toHaveBeenCalledTimes(1);
  h.bind(snapshot("ACCESS"));expect(h.c.view().canRetry).toBe(false);h.bind(snapshot());expect(h.c.view().canRetry).toBe(true);
});
it("fresh B preview never silently adopts an unsent A review; only explicit B review can create a held request", async () => {
  const h=harness();await h.c.review(request(),h.session,h.c.view().epoch);h.sdk({userId:"cl",sessionId:"B"});h.revoke();h.bind(snapshot("PREVIEW","B"));
  const send=vi.fn();expect(h.c.view().canSubmit).toBe(false);expect(await h.c.submit(h.c.view().epoch,send,h.session)).toBe(false);expect(send).not.toHaveBeenCalled();
  expect(await h.c.review(request(),h.session,h.c.view().epoch)).toBe(true);expect(h.c.view().canSubmit).toBe(true);
});
it("hash completion after SDK loss cannot publish an unsent review or rewrite the caller draft", async () => {
  const h=harness(),r=request(),before=JSON.stringify(r),p=h.c.review(r,h.session,h.c.view().epoch);h.sdk({userId:"other",sessionId:"B"});expect(await p).toBe(false);expect(h.c.view()).toMatchObject({reviewed:false,pending:false});expect(JSON.stringify(r)).toBe(before);
});
it("explicit LINKS publication callback failure never reopens accepted UUID for writes", async () => {
  const h=harness();await h.c.review(request(),h.session,h.c.view().epoch);const send=vi.fn(async()=>ack());await h.c.submit(h.c.view().epoch,send,h.session);h.bind(snapshot("LINKS","A",hash,[ack().testRunId]));
  expect(h.c.publishConfirmed(h.session(),h.c.view().epoch,()=>{throw Error("PRIVATE callback");})).toBe(true);expect(h.c.view()).toMatchObject({known:true,pending:false,canSubmit:false,canRetry:false,canPublish:true});expect(h.c.view().error).not.toContain("PRIVATE");
  const nav=vi.fn();expect(h.c.publishConfirmed(h.session(),h.c.view().epoch,nav)).toBe(true);expect(nav).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledTimes(1);
});
it("stale callbacks after later valid frame cannot navigate known target or submit a new request", async () => {
  const h=harness(),epoch=h.c.view().epoch;await h.c.review(request(),h.session,epoch);await h.c.submit(epoch,async()=>ack(),h.session);h.bind(snapshot("LINKS","A",hash,[ack().testRunId]));const nav=vi.fn();expect(h.c.publishConfirmed(h.session(),epoch,nav)).toBe(false);expect(nav).not.toHaveBeenCalled();
});
