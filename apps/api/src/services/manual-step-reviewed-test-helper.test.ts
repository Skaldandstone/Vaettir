import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type {
  ReviewedStepAck,
  ReviewedStepPreviewInput,
  ReviewedStepWriteInput,
} from "./manualStepExecutionReviewSchema.js";
const boundaries = vi.hoisted(() => ({
  preview: vi.fn(),
  record: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("./manualStepExecutionReview.js", () => ({
  previewReviewedStep: boundaries.preview,
  recordReviewedStep: boundaries.record,
}));
vi.mock("./manualRetestScope.js", () => ({
  lockManualRetestAccess: boundaries.lock,
}));
import {
  admitManualStepFixtureSource,
  assertManualStepFixtureOwnership,
  beginOwnedManualStepFixture,
  manualStepFixtureWireView,
  MANUAL_STEP_FIXTURE_OPT_IN,
  MANUAL_STEP_DESTRUCTIVE_OPT_IN,
  type ManualStepFixtureOwnership,
  type ManualStepFixtureDraft,
} from "./manual-step-reviewed-test-helper.js";

const env = () => ({
  DATABASE_URL:
    "postgresql://synthetic:unused@127.0.0.1:5432/vaettir_day_test_1791280000000?schema=public&connection_limit=1",
  [MANUAL_STEP_FIXTURE_OPT_IN]: "1",
});
function fixture(stepCount = 1) {
  const prefix = `manual-step-reviewed-1791280000000-${randomUUID()}`;
  const owned: ManualStepFixtureOwnership = {
    prefix,
    organizationId: "org",
    organizationSlug: `${prefix}-org`,
    projectId: "project",
    projectName: `${prefix}-project`,
    actorId: "native-owner",
    transportClerkSubject: `${prefix}-transport`,
    recordedActorLabel: "Synthetic owner",
    testRunId: "run",
    testCaseId: "case",
    caseTitle: "Synthetic frozen procedure",
  };
  const environment = env();
  const nativeOwned = { ...owned }; // Independent minted native identity, not the caller's mutable descriptor.
  const draft: ManualStepFixtureDraft = {
    stepIndex: 0,
    status: "FAIL",
    note: " \n exact note \r\n ",
    observations: {
      specimen: "",
      hardwareRevision: "",
      firmwareVersion: "",
      environment: " exact environment ",
      measurements: [
        {
          name: " Meter\n serial ",
          unit: " V ",
          value: 0,
          instrument: " exact instrument ",
        },
      ],
    },
    evidenceAttachmentIds: ["z", "a"],
    expectedRevisionId: null,
    correctionReason: null,
    idempotencyKey: randomUUID(),
  };
  const state = {
    database: "vaettir_day_test_1791280000000",
    address: "127.0.0.1" as string | null,
    port: 5432 as number | null,
    schema: "public" as string | null,
    routeRows: 1,
    slug: owned.organizationSlug,
    projectName: owned.projectName,
    title: owned.caseTitle,
    projectId: owned.projectId,
    provider: "manual",
    status: "RUNNING",
    planned: true,
    cases: 1,
    exactDefinition: true,
    singleCase: true,
    runBytes: 1000n,
    namespace: 0n,
    result: 0,
    stepHeads: 0,
    stepRevisions: 0,
    wholeHeads: 0,
    wholeRevisions: 0,
    legacySlot: 0,
  };
  const events: string[] = [],
    revisionWrites: Array<Record<string, unknown>> = [],
    headWrites: Array<Record<string, unknown>> = [],
    resultWrites: Array<Record<string, unknown>> = [];
  const projectionFailure = { cause: null as unknown };
  const native = {
    $queryRaw: vi.fn(async (raw: readonly string[]) => {
      const sql = raw.join("?");
      if (sql.includes("current_database()")) {
        events.push("native-route");
        const value = {
          database: state.database,
          address: state.address,
          port: state.port,
          schema: state.schema,
        };
        return state.routeRows === 1
          ? [value]
          : state.routeRows === 0
            ? []
            : [value, value];
      }
      if (sql.includes('FROM "Organization" o JOIN')) {
        events.push("owned-labels");
        return [
          {
            slug: state.slug,
            projectName: state.projectName,
            title: state.title,
          },
        ];
      }
      if (sql.includes('cardinality("manualTestCaseIds")')) {
        events.push("owned-run");
        return [
          {
            projectId: state.projectId,
            provider: state.provider,
            status: state.status,
            planned: state.planned,
            cases: state.cases,
          },
        ];
      }
      if (sql.includes("pg_advisory_xact_lock")) {
        events.push("uuid-lock");
        return [];
      }
      if (sql.includes('AS "runBytes"')) {
        events.push("native-definition-proof");
        return [
          {
            exact: state.exactDefinition,
            singleCase: state.singleCase,
            runBytes: state.runBytes,
          },
        ];
      }
      if (sql.includes('FROM "AuditLog"')) {
        events.push("reviewed-namespace");
        return [{ count: state.namespace }];
      }
      if (sql.includes("set_config")) {
        events.push(
          sql.includes("'', true") ? "selector-clear" : "selector-open",
        );
        return [];
      }
      throw Error("Unexpected mocked native query; no database was contacted");
    }),
    testResult: {
      count: vi.fn(async () => state.result),
      create: vi.fn(async (arg: { data: Record<string, unknown> }) => {
        events.push("projection-write");
        if (projectionFailure.cause) throw projectionFailure.cause;
        resultWrites.push(arg.data);
        return {};
      }),
    },
    manualStepResultHead: {
      count: vi.fn(async () => state.stepHeads),
      create: vi.fn(async (arg: { data: Record<string, unknown> }) => {
        events.push("head-write");
        headWrites.push(arg.data);
        return {};
      }),
    },
    manualStepResultRevision: {
      count: vi.fn(async (arg: { where: { actorId?: string } }) =>
        arg.where.actorId ? state.legacySlot : state.stepRevisions,
      ),
      create: vi.fn(async (arg: { data: Record<string, unknown> }) => {
        events.push("revision-write");
        revisionWrites.push(arg.data);
        return { id: "historical-revision" };
      }),
    },
    manualCaseResultHead: { count: vi.fn(async () => state.wholeHeads) },
    manualCaseResultRevision: {
      count: vi.fn(async () => state.wholeRevisions),
    },
    auditLog: {
      create: vi.fn(() => {
        throw Error("No reviewed provenance may be fabricated");
      }),
    },
  };
  const db = {
    ...native,
    $transaction: vi.fn(
      async (work: (tx: typeof native) => unknown, options: unknown) => {
        expect(options).toEqual({
          isolationLevel: "RepeatableRead",
          timeout: 20000,
          maxWait: 5000,
        });
        return work(native);
      },
    ),
  };
  boundaries.lock.mockImplementation(async () => {
    events.push("current-full-owner-locks");
    return {
      projectId: owned.projectId,
      organizationId: owned.organizationId,
      actorId: owned.actorId,
      clerkActorId: owned.transportClerkSubject,
    };
  });
  const frozenDefinition = {
    testCaseId: owned.testCaseId,
    steps: Array.from({ length: stepCount }, (_, order) => ({
      order,
      action: `Frozen ${order}`,
      expectedActionOrData: null,
      expectedResult: "",
      expectedResponse: null,
      mediaAttachmentIds: [],
    })),
  };
  const previewValue = (input: ReviewedStepPreviewInput) => ({
    ...input,
    originalOrganizationId: undefined,
    expectedClerkActorId: undefined,
    expectedNativeActorId: undefined,
    scope: {
      projectId: nativeOwned.projectId,
      organizationId: nativeOwned.organizationId,
      actorId: nativeOwned.actorId,
      actorClerkUserId: nativeOwned.transportClerkSubject,
    },
    canRecover: true,
    canRecord: true,
    supported: true,
    blockedReason: null,
    frozenDefinition,
    current: null,
    rawCurrent: null,
    procedureHash: "a".repeat(64),
    currentFingerprint: "b".repeat(64),
    provenance: "CURRENT_AUTHORITY_LEGACY_ORIGINAL_TENANCY_UNRECORDED" as const,
  });
  boundaries.preview.mockImplementation(
    async (_db, _actor, input: ReviewedStepPreviewInput) => {
      const {
        originalOrganizationId: _org,
        expectedClerkActorId: _clerk,
        expectedNativeActorId: _native,
        ...value
      } = previewValue(input);
      return value;
    },
  );
  let recordCalls = 0;
  const ackValue = (request: ReviewedStepWriteInput): ReviewedStepAck => ({
    projectId: request.projectId,
    testRunId: request.testRunId,
    testCaseId: request.testCaseId,
    stepIndex: request.stepIndex,
    scope: {
      projectId: nativeOwned.projectId,
      organizationId: nativeOwned.organizationId,
      actorId: nativeOwned.actorId,
      actorClerkUserId: nativeOwned.transportClerkSubject,
    },
    idempotencyKey: request.idempotencyKey,
    requestHash: createHash("sha256")
      .update(
        JSON.stringify({
          projectId: request.projectId,
          testRunId: request.testRunId,
          testCaseId: request.testCaseId,
          stepIndex: request.stepIndex,
          originalOrganizationId: request.originalOrganizationId,
          expectedClerkActorId: request.expectedClerkActorId,
          expectedNativeActorId: request.expectedNativeActorId,
          expectedProcedureHash: request.expectedProcedureHash,
          expectedCurrentFingerprint: request.expectedCurrentFingerprint,
          expectedRevisionId: request.expectedRevisionId,
          status: request.status,
          note: request.note,
          observations: request.observations,
          evidenceAttachmentIds: request.evidenceAttachmentIds,
          correctionReason: request.correctionReason,
          idempotencyKey: request.idempotencyKey,
          confirmed: true,
        }),
      )
      .digest("hex"),
    revisionId: "reviewed-revision",
    caseStatus: request.status,
    recovered: recordCalls++ > 0,
    provenance: "REVIEWED_REQUEST_BOUND_AT_WRITE",
  });
  boundaries.record.mockImplementation(
    async (_db, _actor, request: ReviewedStepWriteInput) => ackValue(request),
  );
  const begin = () =>
    beginOwnedManualStepFixture(db as never, owned, environment);
  const legacyRaw = () => ({
    testRunId: owned.testRunId,
    testCaseId: owned.testCaseId,
    stepIndex: 0,
    status: "FAIL",
    note: " old normalized\n note ",
    observations: {
      measurements: [{ name: " Meter ", unit: " V ", value: 0 }],
    },
    expectedRevisionId: null,
    evidenceAttachmentIds: [],
    idempotencyKey: randomUUID(),
  });
  return {
    owned,
    environment,
    draft,
    state,
    events,
    native,
    db,
    begin,
    legacyRaw,
    projectionFailure,
    revisionWrites,
    headWrites,
    resultWrites,
    previewValue,
    ackValue,
  };
}
beforeEach(() => {
  boundaries.preview.mockReset();
  boundaries.record.mockReset();
  boundaries.lock.mockReset();
});
describe("reviewed step source fixture support; pure/mocked only, native SQL NOT RUN", () => {
  it("admits only exact local disposable route and explicit opt-in, with separate pre-connection destructive admission", () => {
    expect(admitManualStepFixtureSource(env())).toEqual({
      route: "LOCAL_DISPOSABLE",
      database: "vaettir_day_test_1791280000000",
    });
    expect(() => admitManualStepFixtureSource(env(), true)).toThrow(
      "admission",
    );
    expect(
      admitManualStepFixtureSource(
        { ...env(), [MANUAL_STEP_DESTRUCTIVE_OPT_IN]: "1" },
        true,
      ).route,
    ).toBe("LOCAL_DISPOSABLE");
  });
  it.each([
    "postgresql://synthetic:unused@remote.invalid/vaettir_day_test_1791280000000",
    "postgresql://synthetic:unused@localhost/production_test",
    "postgresql://synthetic:unused@localhost/vaettir_test",
    "postgresql://synthetic:unused@localhost/vaettir_day_test_1791280000000?host=remote",
    "postgresql://synthetic:unused@localhost:6543/vaettir_day_test_1791280000000",
    "postgresql://synthetic:unused@localhost/vaettir_day_test_1791280000000?schema=private",
  ])(
    "rejects unsafe configured route %# before any DB/runtime boundary",
    async (url) => {
      const h = fixture();
      h.environment.DATABASE_URL = url;
      await expect(h.begin()).rejects.toThrow();
      expect(h.native.$queryRaw).not.toHaveBeenCalled();
      expect(boundaries.lock).not.toHaveBeenCalled();
    },
  );
  it("requires opt-in and independent explicit fixture subject before any DB", async () => {
    const h = fixture();
    h.environment[MANUAL_STEP_FIXTURE_OPT_IN] = "0";
    await expect(h.begin()).rejects.toThrow("admission");
    expect(h.native.$queryRaw).not.toHaveBeenCalled();
    h.environment[MANUAL_STEP_FIXTURE_OPT_IN] = "1";
    h.owned.transportClerkSubject = undefined as unknown as string;
    await expect(h.begin()).rejects.toThrow("admission");
    expect(h.native.$queryRaw).not.toHaveBeenCalled();
  });
  it.each([
    { prefix: "customer" },
    { organizationSlug: "unowned" },
    { projectName: "unowned" },
    { transportClerkSubject: "native-row-fallback" },
    { actorId: "" },
    { extra: "unsupported" },
  ])(
    "rejects unsupported/mismatched minted ownership %s before DB",
    async (patch) => {
      const h = fixture();
      Object.assign(h.owned, patch);
      expect(() => assertManualStepFixtureOwnership(h.owned)).toThrow(
        "admission",
      );
      await expect(h.begin()).rejects.toThrow("admission");
      expect(h.native.$queryRaw).not.toHaveBeenCalled();
    },
  );
  it.each([
    { database: "other_database" },
    { address: "198.51.100.1" },
    { port: 6543 },
    { schema: "private" },
    { routeRows: 2 },
  ])(
    "corroborates actual native route %s before ownership/runtime service",
    async (patch) => {
      const h = fixture();
      Object.assign(h.state, patch);
      await expect(h.begin()).rejects.toThrow("admission");
      expect(boundaries.lock).not.toHaveBeenCalled();
      expect(boundaries.preview).not.toHaveBeenCalled();
    },
  );
  it.each([
    { slug: "other-slug" },
    { projectName: "other-name" },
    { title: "other-case" },
    { projectId: "other-project" },
    { provider: "ci" },
    { status: "PASSED" },
    { planned: false },
    { cases: 1001 },
  ])("validates native cohort ownership %s without writes", async (patch) => {
    const h = fixture();
    Object.assign(h.state, patch);
    await expect(h.begin()).rejects.toThrow("admission");
    expect(h.revisionWrites).toEqual([]);
    expect(boundaries.preview).not.toHaveBeenCalled();
  });
  it("uses actual FULL lock service and explicit fixture transport subject, never mirrored fallback", async () => {
    const h = fixture();
    await h.begin();
    expect(boundaries.lock).toHaveBeenCalledWith(
      expect.anything(),
      h.owned.actorId,
      expect.objectContaining({
        expectedScope: {
          projectId: h.owned.projectId,
          organizationId: h.owned.organizationId,
          clerkActorId: h.owned.transportClerkSubject,
        },
      }),
      true,
      h.owned.transportClerkSubject,
      false,
    );
    expect(h.events.slice(0, 4)).toEqual([
      "native-route",
      "current-full-owner-locks",
      "owned-labels",
      "owned-run",
    ]);
  });
  it("does not swallow current native authorization refusal or mismatched locked actor", async () => {
    const h = fixture(),
      cause = new TRPCError({ code: "FORBIDDEN" });
    boundaries.lock.mockRejectedValueOnce(cause);
    await expect(h.begin()).rejects.toBe(cause);
    expect(h.events).not.toContain("owned-labels");
    boundaries.lock.mockResolvedValueOnce({
      projectId: "project",
      organizationId: "org",
      actorId: "other-native",
      clerkActorId: h.owned.transportClerkSubject,
    });
    await expect(h.begin()).rejects.toThrow("admission");
  });
  it("actual preview pins nonce/scope/hashes then keeps exact raw/null/context/evidence ordering immutable", async () => {
    const h = fixture(),
      session = await h.begin(),
      prepared = await session.prepare(h.draft);
    const reader = boundaries.preview.mock
      .calls[0]![2] as ReviewedStepPreviewInput;
    expect(reader).toMatchObject({
      originalOrganizationId: h.owned.organizationId,
      expectedClerkActorId: h.owned.transportClerkSubject,
      expectedNativeActorId: h.owned.actorId,
    });
    expect(reader.readRequestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(prepared.request).toMatchObject({
      expectedProcedureHash: "a".repeat(64),
      expectedCurrentFingerprint: "b".repeat(64),
      note: h.draft.note,
      observations: h.draft.observations,
      correctionReason: null,
      evidenceAttachmentIds: ["z", "a"],
      idempotencyKey: h.draft.idempotencyKey,
    });
    expect(Object.isFrozen(prepared.request.observations.measurements[0])).toBe(
      true,
    );
    expect(Object.isFrozen(h.draft)).toBe(false);
    const first = await prepared.submit(),
      second = await prepared.submit();
    expect(first.recovered).toBe(false);
    expect(second.recovered).toBe(true);
    expect(manualStepFixtureWireView(second)).toEqual(
      manualStepFixtureWireView(first),
    );
    expect(boundaries.record).toHaveBeenCalledTimes(2);
    expect(boundaries.preview).toHaveBeenCalledTimes(1);
    expect(boundaries.record.mock.calls[0]![2]).toBe(prepared.request);
    expect(boundaries.record.mock.calls[1]![2]).toBe(prepared.request);
  });
  it("retains original captured ownership/body when external source drafts change; submit never re-previews", async () => {
    const h = fixture(),
      session = await h.begin(),
      prepared = await session.prepare(h.draft),
      originalUUID = h.draft.idempotencyKey;
    h.owned.actorId = "changed-native";
    h.owned.transportClerkSubject = "changed-source-subject";
    h.draft.note = "changed";
    h.draft.observations.measurements[0]!.value = 55;
    h.draft.evidenceAttachmentIds.push("changed");
    h.draft.idempotencyKey = randomUUID();
    expect((await prepared.submit()).idempotencyKey).toBe(originalUUID);
    expect(boundaries.record.mock.calls[0]![1]).toEqual({
      id: "native-owner",
      clerkUserId: prepared.request.expectedClerkActorId,
    });
    expect(prepared.request.note).not.toBe("changed");
    expect(prepared.request.observations.measurements[0]!.value).toBe(0);
    expect(boundaries.preview).toHaveBeenCalledTimes(1);
  });
  it("an unknown response remains unknown and explicit retry uses the same body/UUID with no helper retry", async () => {
    const h = fixture(),
      session = await h.begin(),
      prepared = await session.prepare(h.draft),
      lost = new Error("Synthetic UNKNOWN acknowledgement");
    boundaries.record.mockRejectedValueOnce(lost);
    await expect(prepared.submit()).rejects.toBe(lost);
    expect(boundaries.record).toHaveBeenCalledTimes(1);
    const ack = await prepared.submit();
    expect(ack.idempotencyKey).toBe(prepared.request.idempotencyKey);
    expect(boundaries.preview).toHaveBeenCalledTimes(1);
  });
  it("does not rebind native route or continue after removed opt-in on retry", async () => {
    const h = fixture(),
      session = await h.begin(),
      prepared = await session.prepare(h.draft);
    h.environment[MANUAL_STEP_FIXTURE_OPT_IN] = "0";
    await expect(prepared.submit()).rejects.toThrow("admission");
    expect(boundaries.record).not.toHaveBeenCalled();
    h.environment[MANUAL_STEP_FIXTURE_OPT_IN] = "1";
    h.environment.DATABASE_URL = h.environment.DATABASE_URL.replace(
      "1791280000000",
      "1791280000001",
    );
    await expect(prepared.submit()).rejects.toThrow("admission");
    expect(boundaries.record).not.toHaveBeenCalled();
  });
  it.each([
    "nonce",
    "case",
    "run",
    "project",
    "native",
    "clerk",
    "organization",
    "unsupported",
    "read-only",
    "missing-hash",
  ])(
    "refuses %s preview before preparing a write, without guessed fields",
    async (kind) => {
      const h = fixture(),
        session = await h.begin();
      boundaries.preview.mockImplementation(async (_db, _actor, input) => {
        const {
          originalOrganizationId: _org,
          expectedClerkActorId: _clerk,
          expectedNativeActorId: _native,
          ...value
        } = h.previewValue(input);
        if (kind === "nonce") value.readRequestId = randomUUID();
        if (kind === "case") value.testCaseId = "other-case";
        if (kind === "run") value.testRunId = "other-run";
        if (kind === "project") value.projectId = "other-project";
        if (kind === "native") value.scope.actorId = "other-native";
        if (kind === "clerk") value.scope.actorClerkUserId = "other-clerk";
        if (kind === "organization") value.scope.organizationId = "other-org";
        if (kind === "unsupported") value.supported = false;
        if (kind === "read-only") value.canRecord = false;
        if (kind === "missing-hash")
          value.procedureHash = null as unknown as string;
        return value;
      });
      await expect(session.prepare(h.draft)).rejects.toThrow("admission");
      expect(boundaries.record).not.toHaveBeenCalled();
    },
  );
  it.each([
    "hash",
    "UUID",
    "native",
    "clerk",
    "organization",
    "case",
    "scope",
    "missing",
  ])(
    "refuses unsupported/mismatched %s ACK without helper resubmit or new identity",
    async (kind) => {
      const h = fixture(),
        session = await h.begin(),
        prepared = await session.prepare(h.draft);
      boundaries.record.mockImplementation(async (_db, _actor, request) => {
        const value = h.ackValue(request);
        if (kind === "hash") value.requestHash = "f".repeat(64);
        if (kind === "UUID") value.idempotencyKey = randomUUID();
        if (kind === "native") value.scope.actorId = "other-native";
        if (kind === "clerk") value.scope.actorClerkUserId = "other-clerk";
        if (kind === "organization") value.scope.organizationId = "other-org";
        if (kind === "case") value.testCaseId = "other-case";
        if (kind === "scope") value.scope.projectId = "other-project";
        if (kind === "missing")
          delete (value as Partial<ReviewedStepAck>).scope;
        return value;
      });
      await expect(prepared.submit()).rejects.toThrow("admission");
      expect(boundaries.record).toHaveBeenCalledTimes(1);
      expect(boundaries.preview).toHaveBeenCalledTimes(1);
    },
  );
  it("retains an explicitly supplied expected revision and rejects scope/hash overrides in draft", async () => {
    const h = fixture(),
      session = await h.begin();
    h.draft.expectedRevisionId = "held-original-revision";
    expect((await session.prepare(h.draft)).request.expectedRevisionId).toBe(
      "held-original-revision",
    );
    await expect(
      session.prepare({
        ...h.draft,
        projectId: "foreign",
      } as ManualStepFixtureDraft),
    ).rejects.toThrow();
  });
  it("historical FIRST seed uses actual original parsing/defaults/hash and no reviewed envelope/provenance", async () => {
    const h = fixture(),
      session = await h.begin(),
      raw = h.legacyRaw(),
      saved = await session.seedAcceptedLegacy(raw);
    expect(saved.request.note).toBe("old normalized\n note");
    expect(saved.wire).toEqual({
      revisionId: "historical-revision",
      caseStatus: "FAIL",
    });
    expect(saved.provenance).toBe(
      "SYNTHETIC_LEGACY_WIRE_SEED_ORIGINAL_TENANCY_UNRECORDED",
    );
    const observations = {
      specimen: "",
      hardwareRevision: "",
      firmwareVersion: "",
      environment: "",
      measurements: [{ name: "Meter", unit: "V", value: 0, instrument: "" }],
    };
    const { qualityProfileHash } =
      await import("./qualityExperienceProfile.js");
    expect(saved.requestHash).toBe(
      qualityProfileHash({
        testCaseId: raw.testCaseId,
        stepIndex: raw.stepIndex,
        status: raw.status,
        note: "old normalized\n note",
        observations,
        evidenceAttachmentIds: [],
        expectedRevisionId: null,
        correctionReason: null,
      }),
    );
    expect(h.revisionWrites).toEqual([
      expect.objectContaining({
        observations,
        note: "old normalized\n note",
        previousRevisionId: null,
        revisionNumber: 1,
        idempotencyKey: raw.idempotencyKey,
        actorId: h.owned.actorId,
        actorName: h.owned.recordedActorLabel,
        requestHash: saved.requestHash,
      }),
    ]);
    expect(h.revisionWrites[0]).not.toHaveProperty("originalOrganizationId");
    expect(h.native.auditLog.create).not.toHaveBeenCalled();
    expect(h.resultWrites[0]).toMatchObject({
      status: "FAIL",
      observations: {},
      note: "Derived from 1 recorded step outcomes. Per-step measurements and evidence remain on their immutable revisions.",
    });
    expect(h.events.slice(-5)).toEqual([
      "revision-write",
      "head-write",
      "selector-open",
      "projection-write",
      "selector-clear",
    ]);
  });
  it("partial historical seed retains NULL aggregate and normalized blank note, no fabricated case verdict", async () => {
    const h = fixture(2),
      session = await h.begin();
    const saved = await session.seedAcceptedLegacy({
      ...h.legacyRaw(),
      note: " \n ",
    });
    expect(saved.wire.caseStatus).toBeNull();
    expect(h.revisionWrites[0]!.note).toBeNull();
    expect(h.resultWrites).toEqual([]);
  });
  it.each([
    "result",
    "stepHeads",
    "stepRevisions",
    "wholeHeads",
    "wholeRevisions",
    "legacySlot",
  ])(
    "historical seed refuses occupied %s without overwrites/adoption",
    async (field) => {
      const h = fixture(),
        session = await h.begin();
      h.state[field as "result"] = 1;
      await expect(session.seedAcceptedLegacy(h.legacyRaw())).rejects.toThrow(
        "admission",
      );
      expect(h.revisionWrites).toEqual([]);
      expect(h.headWrites).toEqual([]);
      expect(h.resultWrites).toEqual([]);
    },
  );
  it.each([
    { namespace: 1n },
    { singleCase: false },
    { exactDefinition: false },
    { runBytes: 4194305n },
    { runBytes: -1n },
  ])(
    "historical seed refuses unsupported namespace/native metadata %s",
    async (patch) => {
      const h = fixture(),
        session = await h.begin();
      Object.assign(h.state, patch);
      await expect(session.seedAcceptedLegacy(h.legacyRaw())).rejects.toThrow(
        "admission",
      );
      expect(h.revisionWrites).toEqual([]);
    },
  );
  it.each([
    { stepIndex: 1 },
    { expectedRevisionId: "old" },
    { correctionReason: "not a first seed" },
    { evidenceAttachmentIds: ["must-not-fake-evidence"] },
    { testRunId: "foreign" },
    { testCaseId: "foreign" },
  ])(
    "historical seed rejects non-first or foreign request %s",
    async (patch) => {
      const h = fixture(),
        session = await h.begin();
      await expect(
        session.seedAcceptedLegacy({ ...h.legacyRaw(), ...patch }),
      ).rejects.toThrow("admission");
      expect(h.revisionWrites).toEqual([]);
    },
  );
  it("historical seed requires fresh current FULL identity before native occupied/namespace work", async () => {
    const h = fixture(),
      session = await h.begin(),
      cause = new TRPCError({ code: "FORBIDDEN" });
    boundaries.lock.mockRejectedValueOnce(cause);
    await expect(session.seedAcceptedLegacy(h.legacyRaw())).rejects.toBe(cause);
    expect(h.revisionWrites).toEqual([]);
    expect(h.events).not.toContain("reviewed-namespace");
  });
  it.each(["value", "lowerLimit", "upperLimit"])(
    "historical seed refuses unsupported integer precision in %s without inventing accepted history",
    async (field) => {
      const h = fixture(),
        session = await h.begin(),
        request = h.legacyRaw();
      Object.assign(request.observations.measurements[0]!, {
        [field]: Number.MAX_SAFE_INTEGER + 1,
      });
      await expect(session.seedAcceptedLegacy(request)).rejects.toThrow(
        "admission",
      );
      expect(h.revisionWrites).toEqual([]);
    },
  );
  it("historical seed cannot invent an accepted measured Pass the old guarded writer would refuse", async () => {
    const h = fixture(),
      session = await h.begin(),
      request = h.legacyRaw();
    Object.assign(request.observations.measurements[0]!, {
      value: 5,
      upperLimit: 3,
    });
    await expect(
      session.seedAcceptedLegacy({ ...request, status: "PASS" }),
    ).rejects.toThrow("admission");
    expect(h.revisionWrites).toEqual([]);
  });
  it("historical derived-projection failure remains original, with no finally reset/retry/healing", async () => {
    const h = fixture(),
      session = await h.begin(),
      cause = new Error("Synthetic projection constraint failure");
    h.projectionFailure.cause = cause;
    await expect(session.seedAcceptedLegacy(h.legacyRaw())).rejects.toBe(cause);
    expect(h.events).not.toContain("selector-clear");
    expect(h.revisionWrites).toHaveLength(1);
  });
  it("tracked helper is inert on import and cannot erase/create databases, weaken native guards or retry/sequentialize cases", () => {
    const source = readFileSync(
      new URL("./manual-step-reviewed-test-helper.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      'import type { PrismaClient, Prisma } from "@vaettir/db"',
    );
    expect(source).not.toMatch(
      /from "\.\/manualStepExecution(?:Review)?\.js"|new PrismaClient|new ConstraintChecked|DROP |CREATE DATABASE|DELETE FROM|\.delete\(|\.deleteMany\(|hardDeleteOrganization\(|DISABLE TRIGGER|session_replication_role|Promise\.allSettled|withReviewedStepRollback|setTimeout/,
    );
    expect(
      source.indexOf("const admission = admitManualStepFixtureSource"),
    ).toBeLessThan(source.indexOf("await nativeRoute(db, admission)"));
    expect(source).toContain('await import("./manualStepExecutionReview.js")');
    expect(source).toContain('await import("./manualStepExecution.js")');
    expect(source).toContain("No occupied rows are modified");
    expect(source).toContain("Not a constraint-disable switch");
    const fixtureSource = readFileSync(
      new URL("../manual-step-execution.integration.test.ts", import.meta.url),
      "utf8",
    );
    expect(fixtureSource.match(/\bit\(/g)).toHaveLength(14); // Existing native registrations still frozen, not executed.
  });
});
