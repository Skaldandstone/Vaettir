import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
import {
  manualCaseReviewedAccessOutputSchema,
  manualCaseReviewedPreviewOutputSchema,
  manualCaseReviewedHistoryOutputSchema,
  manualCaseReviewedAckSchema,
  manualCaseReviewedReadKey,
  manualCaseReviewedWriteKey,
  manualCaseResultReadKey,
  manualCaseResultPreviewOutputSchema,
  manualCaseResultHistoryOutputSchema,
  manualCaseResultAckSchema,
  manualCaseResultWriteSchema,
} from "../services/manualCaseResultSchema.js";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  preview: vi.fn(),
  history: vi.fn(),
  record: vi.fn(),
  legacyPreview: vi.fn(),
  legacyHistory: vi.fn(),
  legacyRecord: vi.fn(),
  transaction: vi.fn(),
  verify: vi.fn(),
  mirror: vi.fn(),
}));
vi.mock("../services/manualCaseResults.js", () => ({
  accessReviewedManualCaseResult: mocks.access,
  previewReviewedManualCaseResult: mocks.preview,
  historyReviewedManualCaseResult: mocks.history,
  recordReviewedManualCaseResult: mocks.record,
  previewManualCaseResult: mocks.legacyPreview,
  historyManualCaseResult: mocks.legacyHistory,
  recordManualCaseResult: mocks.legacyRecord,
}));
vi.mock("../clerk.js", () => ({
  verifyClerkSessionToken: mocks.verify,
  getOrCreateLocalUser: mocks.mirror,
}));
vi.mock("@vaettir/db", () => ({ prisma: { $transaction: mocks.transaction } }));
import { manualCaseResultsRouter } from "./manualCaseResults.js";

const nativeId = "native-synthetic",
  verifiedSubject = "verified-human-synthetic",
  cachedMapping = "cached-native-mapping-synthetic";
const scope = {
  projectId: "project",
  organizationId: "org",
  clerkActorId: verifiedSubject,
  actorId: nativeId,
};
const read = () => ({
  projectId: "project",
  testRunId: "run",
  testCaseId: "case",
  expectedScope: {
    projectId: "project",
    organizationId: "org",
    clerkActorId: verifiedSubject,
  },
  readRequestId: randomUUID(),
  expectedNativeActorId: nativeId,
});
function fixtures() {
  const access = read(),
    preview = read(),
    history = { ...read(), before: "prior-revision", limit: 7 };
  const record = {
    projectId: "project",
    testRunId: "run",
    testCaseId: "case",
    expectedScope: {
      projectId: "project",
      organizationId: "org",
      clerkActorId: verifiedSubject,
    },
    mode: "EXACT" as const,
    expectedNativeActorId: nativeId,
    expectedFrozenEvidenceHash: "a".repeat(64),
    expectedRevisionId: null,
    expectedCurrentFingerprint: "b".repeat(64),
    status: "PASS" as const,
    note: " exact \n transport note ",
    observations: {
      specimen: "",
      environment: " exact environment ",
      measurements: [
        {
          name: " Voltage ",
          value: 0,
          unit: " V ",
          lowerLimit: 0,
          instrument: " Meter\n retained ",
        },
      ],
    },
    correctionReason: null,
    idempotencyKey: randomUUID(),
  };
  const context = (
    input: ReturnType<typeof read>,
    projection: "ACCESS" | "PREVIEW" | "HISTORY",
  ) => ({
    requestId: input.readRequestId,
    requested: manualCaseReviewedReadKey(input),
    projection,
    scope,
    canRecover: true,
  });
  const outputs = {
    accessReviewed: manualCaseReviewedAccessOutputSchema.parse({
      readContext: context(access, "ACCESS"),
    }),
    previewReviewed: manualCaseReviewedPreviewOutputSchema.parse({
      readContext: context(preview, "PREVIEW"),
      displayId: "TC-001",
      current: {
        resultId: "result",
        status: "PASS",
        note: null,
        observations: { retainedUnknownSibling: [null, "", 0] },
      },
      currentRevisionId: "revision",
      revisionNumber: 1,
      currentFingerprint: "b".repeat(64),
      frozenEvidenceHash: "a".repeat(64),
      frozenEvidence: {
        procedure: { action: " exact frozen \n action " },
        prerequisites: { case: [] },
        context: { unknownLiteral: null },
      },
      canWrite: true,
      tracked: true,
      runStatus: "RUNNING",
      limitations: ["Synthetic transport DTO only."],
    }),
    historyReviewed: manualCaseReviewedHistoryOutputSchema.parse({
      readContext: context(history, "HISTORY"),
      revisions: [
        {
          id: "revision",
          revisionNumber: 1,
          result: {
            resultId: "result",
            status: "PASS",
            note: "",
            observations: { retainedUnknownSibling: [null, "", 0] },
          },
          actorLabel: "Synthetic human",
          recordedAt: new Date("2026-10-06T12:00:00.123Z"),
          correctionReason: null,
          previousRevisionId: null,
          legacyPrior: null,
          legacyPriorKind: "JSON_NULL",
        },
      ],
      nextCursor: "earlier-revision",
    }),
    recordReviewed: manualCaseReviewedAckSchema.parse({
      scope,
      testRunId: "run",
      testCaseId: "case",
      resultId: "result",
      revisionId: "revision",
      revisionNumber: 1,
      idempotencyKey: record.idempotencyKey,
      requestHash: createHash("sha256")
        .update(manualCaseReviewedWriteKey(record))
        .digest("hex"),
      recovered: false,
      mode: "EXACT",
    }),
  };
  return {
    inputs: {
      accessReviewed: access,
      previewReviewed: preview,
      historyReviewed: history,
      recordReviewed: record,
    },
    outputs,
  };
}
const endpoints = [
  "accessReviewed",
  "previewReviewed",
  "historyReviewed",
  "recordReviewed",
] as const;
const service = {
  accessReviewed: mocks.access,
  previewReviewed: mocks.preview,
  historyReviewed: mocks.history,
  recordReviewed: mocks.record,
};
function caller({
  subject = verifiedSubject,
  signedIn = true,
  apiKey = false,
  omitted = false,
}: {
  subject?: string | null;
  signedIn?: boolean;
  apiKey?: boolean;
  omitted?: boolean;
} = {}) {
  const user = signedIn
    ? {
        id: apiKey ? "native-service-synthetic" : nativeId,
        clerkUserId: cachedMapping,
        name: "Synthetic cached user",
        email: "synthetic@example.invalid",
        memberships: [
          { organizationId: "org", role: "OWNER", seatType: "FULL" },
        ],
      }
    : null;
  const db = { $transaction: mocks.transaction };
  const context = {
    prisma: db,
    user,
    staff: null,
    ...(omitted ? {} : { authenticatedClerkSubject: subject }),
  } as unknown as Context;
  return { user, db, caller: manualCaseResultsRouter.createCaller(context) };
}
function zeroServiceOrDatabase() {
  for (const mock of [
    ...Object.values(service),
    mocks.legacyPreview,
    mocks.legacyHistory,
    mocks.legacyRecord,
    mocks.transaction,
    mocks.verify,
    mocks.mirror,
  ])
    expect(mock).not.toHaveBeenCalled();
}
beforeEach(() => vi.resetAllMocks());

describe("actual reviewed whole-case protected transport; services/native/JWT cryptography mocked NOT proved", () => {
  for (const endpoint of endpoints) {
    it.each([
      { label: "null", subject: null },
      { label: "empty", subject: "" },
      { label: "omitted", omitted: true },
      { label: "explicit undefined", omitted: false, explicitUndefined: true },
    ])(
      `${endpoint} refuses $label human subject before service/transaction despite populated cached mapping`,
      async (variant) => {
        const f = fixtures();
        const h = variant.explicitUndefined
          ? {
              caller: manualCaseResultsRouter.createCaller({
                prisma: { $transaction: mocks.transaction },
                user: {
                  id: nativeId,
                  clerkUserId: cachedMapping,
                  memberships: [],
                },
                authenticatedClerkSubject: undefined,
                staff: null,
              } as unknown as Context),
            }
          : caller(variant);
        await expect(
          h.caller[endpoint](f.inputs[endpoint] as never),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        zeroServiceOrDatabase();
      },
    );
    it(`${endpoint} remains protected when signed out even with a fabricated provenance field`, async () => {
      const f = fixtures(),
        h = caller({ signedIn: false });
      await expect(
        h.caller[endpoint](f.inputs[endpoint] as never),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      zeroServiceOrDatabase();
    });
    it(`${endpoint} does not upgrade a service/API-key native principal to human proof`, async () => {
      const f = fixtures(),
        h = caller({ apiKey: true, subject: null });
      await expect(
        h.caller[endpoint](f.inputs[endpoint] as never),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      zeroServiceOrDatabase();
    });
    it(`${endpoint} forwards independent verified subject/native id and complete exact parsed input, not cached mapping`, async () => {
      const f = fixtures(),
        h = caller();
      service[endpoint].mockResolvedValue(f.outputs[endpoint]);
      expect(await h.caller[endpoint](f.inputs[endpoint] as never)).toEqual(
        f.outputs[endpoint],
      );
      expect(service[endpoint]).toHaveBeenCalledOnce();
      expect(service[endpoint]).toHaveBeenCalledWith(
        h.db,
        { id: nativeId, clerkUserId: verifiedSubject },
        f.inputs[endpoint],
      );
      expect(h.user!.clerkUserId).toBe(cachedMapping);
      expect(mocks.transaction).not.toHaveBeenCalled();
    });
    it(`${endpoint} keeps strict output validation active rather than accepting undefined/malformed success`, async () => {
      const f = fixtures(),
        h = caller();
      service[endpoint].mockResolvedValue({});
      await expect(
        h.caller[endpoint](f.inputs[endpoint] as never),
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
      expect(service[endpoint]).toHaveBeenCalledOnce();
      expect(mocks.transaction).not.toHaveBeenCalled();
    });
    it(`${endpoint} strict input rejects added actor authority before service`, async () => {
      const f = fixtures(),
        h = caller();
      await expect(
        h.caller[endpoint]({
          ...f.inputs[endpoint],
          actorId: "client-forged",
        } as never),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      zeroServiceOrDatabase();
    });
  }
  it("access discovery retains optional native pin absence, without inference from cached ctx mapping", async () => {
    const f = fixtures(),
      h = caller(),
      { expectedNativeActorId: _pin, ...input } = f.inputs.accessReviewed;
    mocks.access.mockResolvedValue({
      readContext: {
        ...f.outputs.accessReviewed.readContext,
        requested: manualCaseReviewedReadKey(input),
      },
    });
    await h.caller.accessReviewed(input);
    expect(mocks.access.mock.calls[0]![2]).toEqual(input);
    expect(mocks.access.mock.calls[0]![2]).not.toHaveProperty(
      "expectedNativeActorId",
    );
  });
  it("EXACT record retains null/absent/empty/raw multiline/zero input distinctions", async () => {
    const f = fixtures(),
      h = caller();
    mocks.record.mockResolvedValue(f.outputs.recordReviewed);
    await h.caller.recordReviewed(f.inputs.recordReviewed);
    const forwarded = mocks.record.mock.calls[0]![2];
    expect(forwarded.note).toBe(" exact \n transport note ");
    expect(forwarded.correctionReason).toBeNull();
    expect(forwarded.observations).not.toHaveProperty("hardwareRevision");
    expect(forwarded.observations).toMatchObject({
      specimen: "",
      measurements: [
        {
          name: " Voltage ",
          value: 0,
          unit: " V ",
          lowerLimit: 0,
          instrument: " Meter\n retained ",
        },
      ],
    });
  });
  it("three legacy endpoints keep original cached-native actor/output compatibility and do not acquire reviewed proof", async () => {
    const f = fixtures(),
      h = caller({ subject: null }),
      {
        readRequestId: _nonce,
        expectedNativeActorId: _native,
        ...legacyRead
      } = f.inputs.previewReviewed;
    const preview = manualCaseResultPreviewOutputSchema.parse({
      scope,
      requested: manualCaseResultReadKey(legacyRead),
      displayId: "TC-001",
      current: null,
      currentRevisionId: null,
      revisionNumber: 0,
      currentFingerprint: "b".repeat(64),
      canWrite: false,
      tracked: false,
      runStatus: "RUNNING",
      limitations: [],
    });
    const historyInput = { ...legacyRead, before: "older", limit: 2 },
      history = manualCaseResultHistoryOutputSchema.parse({
        scope,
        requested: manualCaseResultReadKey(historyInput),
        canWrite: false,
        runStatus: "RUNNING",
        revisions: [],
        nextCursor: null,
        limitations: [],
      });
    const {
      mode: _mode,
      expectedNativeActorId: _recordNative,
      expectedFrozenEvidenceHash: _frozen,
      ...rawLegacy
    } = f.inputs.recordReviewed;
    const legacyWrite = manualCaseResultWriteSchema.parse(rawLegacy),
      { mode: _ackMode, ...ackFields } = f.outputs.recordReviewed,
      ack = manualCaseResultAckSchema.parse(ackFields);
    mocks.legacyPreview.mockResolvedValue(preview);
    mocks.legacyHistory.mockResolvedValue(history);
    mocks.legacyRecord.mockResolvedValue(ack);
    expect(await h.caller.preview(legacyRead)).toEqual(preview);
    expect(await h.caller.history(historyInput)).toEqual(history);
    expect(await h.caller.record(legacyWrite)).toEqual(ack);
    expect(mocks.legacyPreview).toHaveBeenCalledWith(h.db, h.user, legacyRead);
    expect(mocks.legacyHistory).toHaveBeenCalledWith(
      h.db,
      h.user,
      historyInput,
    );
    expect(mocks.legacyRecord).toHaveBeenCalledWith(h.db, h.user, legacyWrite);
    for (const mock of Object.values(service))
      expect(mock).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
