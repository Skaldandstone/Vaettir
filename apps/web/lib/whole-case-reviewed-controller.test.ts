import { webcrypto, randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { WholeCaseReviewedController } from "./whole-case-reviewed-controller";
import {
  wholeCaseDraft,
  wholeCaseRequest,
  wholeCaseRequestHash,
  wholeCaseReadMatches,
  parseWholeCaseNumber,
  type WholeCaseOrigin,
} from "./whole-case-reviewed-draft";
import {
  manualCaseReviewedReadKey,
  type ManualCaseReviewedPreview,
  type ManualCaseReviewedAck,
} from "@vaettir/api/src/services/manualCaseResultSchema";
vi.stubGlobal("crypto", webcrypto);
const origin: WholeCaseOrigin = {
  projectId: "p",
  testRunId: "r",
  testCaseId: "c",
  organizationId: "o",
  clerkActorId: "cl",
  nativeActorId: "n",
  sessionId: "sessionA",
};
const read = {
  projectId: "p",
  testRunId: "r",
  testCaseId: "c",
  expectedScope: { projectId: "p", organizationId: "o", clerkActorId: "cl" },
  expectedNativeActorId: "n",
  readRequestId: randomUUID(),
};
const baseline: ManualCaseReviewedPreview = {
  readContext: {
    requestId: read.readRequestId,
    projection: "PREVIEW",
    requested: manualCaseReviewedReadKey(read),
    scope: {
      projectId: "p",
      organizationId: "o",
      actorId: "n",
      clerkActorId: "cl",
    },
    canRecover: true,
  },
  displayId: "TC-1",
  current: null,
  currentRevisionId: null,
  revisionNumber: 0,
  currentFingerprint: "a".repeat(64),
  frozenEvidenceHash: "b".repeat(64),
  frozenEvidence: {
    procedure: { title: " Raw\n text " },
    prerequisites: { c: [] },
    context: { retained: null },
  },
  canWrite: true,
  tracked: false,
  runStatus: "RUNNING",
  limitations: [],
};
function fixture() {
  let session: { userId: string; sessionId: string } | null = {
    userId: "cl",
    sessionId: "sessionA",
  };
  const publish = vi.fn(),
    after = vi.fn(),
    c = new WholeCaseReviewedController(publish);
  c.attach();
  const frame = {
    origin,
    open: true,
    canRecover: true,
    canWrite: true,
    activation: "readA",
  };
  c.bind(frame);
  const draft = wholeCaseDraft(baseline);
  draft.status = "FAIL";
  draft.note = " Raw\n note ";
  draft.noteText = draft.note;
  draft.context.environment = " Raw\n environment ";
  const request = wholeCaseRequest(draft, origin, randomUUID());
  const review = () =>
    expect(c.review(request, baseline, session, c.snapshot().epoch)).toBe(true);
  const ack = async (): Promise<ManualCaseReviewedAck> => ({
    scope: baseline.readContext.scope,
    testRunId: "r",
    testCaseId: "c",
    resultId: "result",
    revisionId: "revision",
    revisionNumber: 1,
    idempotencyKey: request.idempotencyKey,
    requestHash: await wholeCaseRequestHash(request),
    recovered: false,
    mode: "EXACT",
  });
  return {
    c,
    frame,
    request,
    draft,
    publish,
    after,
    review,
    ack,
    session: () => session,
    setSession: (v: typeof session) => {
      session = v;
    },
  };
}
function deferred() {
  let resolve!: (v: unknown) => void, reject!: (v: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe("ACTUAL whole-case completion controller, synthetic boundaries only", () => {
  it("parent render loss revokes older handlers BEFORE layout, with no silent origin/request replacement", () => {
    const h = fixture(); let current = true;
    const frame = { ...h.frame, parentCurrent: () => current, parentActivation: "parentA" };
    h.c.bind(frame); h.review(); const epoch = h.c.snapshot().epoch;
    current = false; expect(h.c.renderView(frame).authorized).toBe(false); expect(h.c.current(h.session(), epoch)).toBe(false);
    current = true; h.c.bind(frame); expect(h.c.snapshot().authorized).toBe(false);
    h.c.bind({ ...frame, activation: "freshOwnRead", readerActivation: "freshOwnRead", parentActivation: "parentB" });
    expect(h.c.snapshot().authorized).toBe(true); expect(h.c.snapshot().canSubmit).toBe(false); expect(h.c.snapshot().pending).toBeNull();
  });
  it("parent-current loss after send settles a known exact ACK privately, then explicitly publishes only under a fresh original own/native frame", async () => {
    const h = fixture(); let current = true; const frame = { ...h.frame, parentCurrent: () => current, parentActivation: "parentA" };
    h.c.bind(frame); h.review(); const wait = deferred(); const pending = h.c.submit(h.c.snapshot().epoch, () => wait.promise, h.session, h.after);
    const body = h.c.snapshot().pending; current = false; wait.resolve(await h.ack()); expect(await pending).toBe(true);
    expect(h.after).not.toHaveBeenCalled(); expect(h.c.snapshot().authorized).toBe(false); expect(h.c.snapshot().pending).toBeNull(); expect(h.c.snapshot().confirmed?.requestHash).toBe(await wholeCaseRequestHash(h.request));
    current = true; h.c.bind({ ...frame, activation: "freshOwnRead", readerActivation: "freshOwnRead", parentActivation: "parentB" });
    expect(h.c.publishConfirmed(h.session(), h.c.snapshot().epoch, h.after)).toBe(true); expect(h.after).toHaveBeenCalledTimes(1);
    expect(body).toEqual(h.request); expect(JSON.stringify(body)).not.toContain("parentA");
  });
  it.each([null, () => false, () => { throw Error("PRIVATE_PARENT_MARKER"); }])("null/false/throwing parent callback never grants a private write frame", parentCurrent => {
    const h = fixture(); h.c.bind({ ...h.frame, parentCurrent, parentActivation: "parentA" });
    expect(h.c.snapshot().authorized).toBe(false); expect(h.c.review(h.request, baseline, h.session(), h.c.snapshot().epoch)).toBe(false);
    expect(h.c.snapshot().error ?? "").not.toContain("PRIVATE_PARENT_MARKER");
  });
  it("parent activation changes invalidate captured frame without serializing callbacks or waiving native/role constraints", () => {
    const h = fixture(), parentCurrent = () => true; h.c.bind({ ...h.frame, parentCurrent, parentActivation: "parentA" }); h.review(); const epoch = h.c.snapshot().epoch;
    h.c.renderView({ ...h.frame, parentCurrent, parentActivation: "parentB" }); expect(h.c.current(h.session(), epoch)).toBe(false);
    h.c.bind({ ...h.frame, parentCurrent, parentActivation: "parentB", canRecover: false }); expect(h.c.snapshot().authorized).toBe(false);
  });
  it("parent loss during synchronous pre-dispatch callback sends nothing and does not manufacture UNKNOWN for an unsent reviewed UUID", async () => {
    const h = fixture(); let current = true; h.c.bind({ ...h.frame, parentCurrent: () => current, parentActivation: "parentA" }); h.review(); const send = vi.fn(async () => h.ack());
    expect(await h.c.submit(h.c.snapshot().epoch, send, h.session, h.after, () => { current = false; })).toBe(false);
    expect(send).not.toHaveBeenCalled(); expect(h.c.snapshot().pending).toBeNull(); expect(h.after).not.toHaveBeenCalled();
  });
  it("pre-dispatch callback error is local and cannot turn an unsubmitted reviewed request into an ambiguous native request", async () => {
    const h = fixture(); h.review(); const send = vi.fn(async () => h.ack());
    expect(await h.c.submit(h.c.snapshot().epoch, send, h.session, h.after, () => { throw Error("LOCAL_CALLBACK_FAILURE"); })).toBe(false);
    expect(send).not.toHaveBeenCalled(); expect(h.c.snapshot().pending).toBeNull(); expect(h.c.snapshot().error).not.toContain("identical original UUID");
  });
  it("synchronous SDK mismatch revokes admitted reader, same activation/preview rebinding cannot reauthorize, fresh reader can recover", () => {
    const h = fixture();
    h.review();
    const epoch = h.c.snapshot().epoch;
    h.setSession({ userId: "other", sessionId: "B" });
    expect(h.c.current(h.session(), epoch)).toBe(false);
    h.setSession({ userId: "cl", sessionId: "sessionA" });
    h.c.bind({
      ...h.frame,
      activation: "newPreviewOnly",
      readerActivation: "readA",
    });
    expect(h.c.snapshot().authorized).toBe(false);
    h.c.bind({
      ...h.frame,
      activation: "newPreviewOnly",
      readerActivation: "freshNative",
    });
    expect(h.c.snapshot().authorized).toBe(true);
    expect(h.c.snapshot().canSubmit).toBe(false);
  });
  it("review never submits; one synchronous busy latch prevents duplicate UUID/RPC and exact body is immutable", async () => {
    const h = fixture();
    h.review();
    const epoch = h.c.snapshot().epoch,
      wait = deferred(),
      send = vi.fn(() => wait.promise);
    const first = h.c.submit(epoch, send, h.session, h.after),
      duplicate = await h.c.submit(epoch, send, h.session, h.after);
    expect(duplicate).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(send.mock.calls[0])).toBe(false);
    expect(Object.isFrozen(h.c.snapshot().pending)).toBe(true);
    h.draft.note = "new draft";
    expect(h.c.snapshot().pending && "note" in h.c.snapshot().pending!).toBe(
      true,
    );
    wait.resolve(await h.ack());
    expect(await first).toBe(true);
    expect(h.after).toHaveBeenCalledTimes(1);
    expect(h.c.snapshot().pending).toBeNull();
    expect(h.c.snapshot().canSubmit).toBe(false);
  });
  it.each(["close", "inactive", "readonly", "native", "session", "unmount"])(
    "matching ACK privately settles after %s without any visible callback/new UUID",
    async (kind) => {
      const h = fixture();
      h.review();
      const wait = deferred(),
        pending = h.c.submit(
          h.c.snapshot().epoch,
          () => wait.promise,
          h.session,
          h.after,
        );
      if (kind === "close") h.c.bind({ ...h.frame, open: false });
      if (kind === "inactive" || kind === "readonly")
        h.c.bind({ ...h.frame, canRecover: false, canWrite: false });
      if (kind === "native")
        h.c.bind({ ...h.frame, origin: { ...origin, nativeActorId: "other" } });
      if (kind === "session")
        h.setSession({ userId: "cl", sessionId: "sessionB" });
      if (kind === "unmount") h.c.detach();
      wait.resolve(await h.ack());
      expect(await pending).toBe(true);
      expect(h.after).not.toHaveBeenCalled();
      expect(h.c.snapshot().confirmed).not.toBeNull();
      expect(h.c.snapshot().pending).toBeNull();
      expect(h.c.snapshot().canSubmit).toBe(false);
    },
  );
  it("known ACK after close requires explicit original-frame publish, never another RPC", async () => {
    const h = fixture();
    h.review();
    const wait = deferred(),
      send = vi.fn(() => wait.promise),
      result = h.c.submit(h.c.snapshot().epoch, send, h.session, h.after);
    h.c.bind({ ...h.frame, open: false });
    wait.resolve(await h.ack());
    await result;
    h.c.bind({ ...h.frame, activation: "readB" });
    expect(h.c.snapshot().canPublish).toBe(true);
    expect(
      h.c.publishConfirmed(h.session(), h.c.snapshot().epoch, h.after),
    ).toBe(true);
    expect(h.after).toHaveBeenCalledTimes(1);
    expect(
      h.c.publishConfirmed(h.session(), h.c.snapshot().epoch, h.after),
    ).toBe(false);
    expect(
      await h.c.submit(h.c.snapshot().epoch, send, h.session, h.after),
    ).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("A-B-A access epochs suppress old response effects even with same original SDK reader", async () => {
    const h = fixture();
    h.review();
    const wait = deferred(),
      result = h.c.submit(
        h.c.snapshot().epoch,
        () => wait.promise,
        h.session,
        h.after,
      );
    h.c.bind({ ...h.frame, canRecover: false });
    h.c.bind(h.frame);
    wait.resolve(await h.ack());
    await result;
    expect(h.after).not.toHaveBeenCalled();
    expect(h.c.snapshot().canPublish).toBe(true);
  });
  it.each(["reject", "malformed"])(
    "SDK-before-React %s revokes current actionable publication and retains unknown UUID",
    async (kind) => {
      const h = fixture();
      h.review();
      const wait = deferred(),
        result = h.c.submit(
          h.c.snapshot().epoch,
          () => wait.promise,
          h.session,
          h.after,
        );
      h.setSession({ userId: "cl", sessionId: "sessionB" });
      if (kind === "reject") wait.reject(Error("lost response"));
      else wait.resolve({ wrong: "ack" });
      expect(await result).toBe(false);
      expect(h.c.snapshot().authorized).toBe(false);
      expect(h.c.snapshot().pending).toMatchObject({
        idempotencyKey: h.request.idempotencyKey,
      });
      expect(h.after).not.toHaveBeenCalled();
    },
  );
  it("unknown then definite rejection does not release UUID; exact retry ignores later unsupported write baseline", async () => {
    const h = fixture();
    h.review();
    const send = vi
      .fn()
      .mockRejectedValueOnce(Error("unknown"))
      .mockRejectedValueOnce({ data: { code: "CONFLICT" } })
      .mockImplementationOnce(() => h.ack());
    await h.c.submit(h.c.snapshot().epoch, send, h.session, h.after);
    h.c.bind({ ...h.frame, activation: "readB", canWrite: false });
    await h.c.submit(h.c.snapshot().epoch, send, h.session, h.after);
    expect(h.c.snapshot().pending).not.toBeNull();
    await h.c.submit(h.c.snapshot().epoch, send, h.session, h.after);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map((args) => JSON.stringify(args[0]))).toEqual(
      Array(3).fill(JSON.stringify(h.request)),
    );
    expect(h.c.snapshot().confirmed).not.toBeNull();
  });
  it("definite FIRST refusal frees review identity but never clears caller draft/prose", async () => {
    const h = fixture();
    h.review();
    await h.c.submit(
      h.c.snapshot().epoch,
      () => Promise.reject({ data: { code: "PRECONDITION_FAILED" } }),
      h.session,
      h.after,
    );
    expect(h.c.snapshot().pending).toBeNull();
    expect(h.c.snapshot().canEdit).toBe(true);
    expect(h.c.snapshot().reviewed).toBe(false);
    expect(h.draft.note).toBe(" Raw\n note ");
    expect(h.after).not.toHaveBeenCalled();
  });
  it("old review handler cannot submit after close/reopen or native actor switch", async () => {
    const h = fixture();
    h.review();
    const old = h.c.snapshot().epoch;
    h.c.bind({ ...h.frame, open: false });
    h.c.bind(h.frame);
    const send = vi.fn();
    expect(await h.c.submit(old, send, h.session, h.after)).toBe(false);
    expect(h.c.snapshot().canSubmit).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it.each(["hash", "UUID", "native", "revision", "result"])(
    "mismatched %s ACK remains unknown and never refreshes",
    async (field) => {
      const h = fixture();
      if (field === "result") {
        const existing = structuredClone(baseline);
        existing.current = {
          resultId: "original",
          status: "FAIL",
          note: null,
          observations: {},
        };
        h.draft.baseline = existing;
        h.request.correctionReason = "reason";
        h.c.review(h.request, existing, h.session(), h.c.snapshot().epoch);
      } else h.review();
      const ack = await h.ack();
      if (field === "hash") ack.requestHash = "c".repeat(64);
      if (field === "UUID") ack.idempotencyKey = randomUUID();
      if (field === "native") ack.scope = { ...ack.scope, actorId: "other" };
      if (field === "revision") ack.revisionNumber = 2;
      if (field === "result") ack.resultId = "wrong";
      expect(
        await h.c.submit(
          h.c.snapshot().epoch,
          () => Promise.resolve(ack),
          h.session,
          h.after,
        ),
      ).toBe(false);
      expect(h.c.snapshot().pending).not.toBeNull();
      expect(h.after).not.toHaveBeenCalled();
    },
  );
});
describe("whole-case raw draft and read admission", () => {
  it.each(["0", "2.00", "1e3", "0.1", "-1.25", " .5 "])(
    "supports decimal %s without changing caller buffer",
    (raw) => {
      expect(Number.isFinite(parseWholeCaseNumber(raw))).toBe(true);
    },
  );
  it.each([
    "",
    " ",
    "NaN",
    "Infinity",
    "9007199254740993",
    "1.00000000000000001",
    "1e999",
  ])("refuses unsupported decimal %s instead of zero/rounding", (raw) =>
    expect(() => parseWholeCaseNumber(raw)).toThrow(),
  );
  it("preserves NULL/empty/raw multiline note and optional limits/instrument across exact request creation", () => {
    const h = fixture();
    h.draft.note = "";
    h.draft.measurementsPresent = true;
    h.draft.readings = [
      {
        name: " Raw\n name ",
        unit: " V ",
        value: "2.00",
        lowerLimit: null,
        upperLimit: "3.00",
        instrument: undefined,
      },
    ];
    const request = wholeCaseRequest(h.draft, origin, randomUUID());
    expect(request.note).toBe("");
    expect(request.observations.measurements![0]).toEqual({
      name: " Raw\n name ",
      unit: " V ",
      value: 2,
      upperLimit: 3,
    });
    expect(h.draft.readings[0]!.value).toBe("2.00");
    h.draft.note = null;
    expect(wholeCaseRequest(h.draft, origin, randomUUID()).note).toBeNull();
  });
  it("nonce/actual native actor/project/projection mismatch withholds cached private reader", () => {
    expect(wholeCaseReadMatches(read, baseline, "PREVIEW")).toBe(true);
    expect(
      wholeCaseReadMatches(
        { ...read, readRequestId: randomUUID() },
        baseline,
        "PREVIEW",
      ),
    ).toBe(false);
    expect(
      wholeCaseReadMatches(
        { ...read, expectedNativeActorId: "other" },
        baseline,
        "PREVIEW",
      ),
    ).toBe(false);
    expect(wholeCaseReadMatches(read, baseline, "HISTORY")).toBe(false);
  });
});
