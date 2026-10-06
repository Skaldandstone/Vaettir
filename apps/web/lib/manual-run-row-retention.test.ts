import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  admitManualRunCurrent,
  manualRunCurrentBrowserKey,
  type ManualRunCurrentInput,
  type ManualRunCurrentOrigin,
  type ManualRunCurrentSnapshot,
  type ManualRunCurrentWire,
} from "./manual-run-current-reader";
import {
  retainManualRunRows,
  type ManualRunRowRetention,
} from "./manual-run-row-retention";

function snapshot({
  ids = ["first", "second"],
  missing = [] as string[],
  title = "Exact title",
  origin = {
    projectId: "p",
    testRunId: "run",
    organizationId: "o",
    clerkActorId: "cl",
    nativeActorId: "n",
  } as ManualRunCurrentOrigin,
  session = "session-A",
  epoch = 0,
}: {
  ids?: string[];
  missing?: string[];
  title?: string;
  origin?: ManualRunCurrentOrigin;
  session?: string;
  epoch?: number;
} = {}) {
  const input: ManualRunCurrentInput = {
    projectId: origin.projectId,
    testRunId: origin.testRunId,
    originalOrganizationId: origin.organizationId,
    expectedClerkActorId: origin.clerkActorId,
    expectedNativeActorId: origin.nativeActorId,
    requestId: randomUUID(),
  };
  const raw: ManualRunCurrentWire = {
    readContext: {
      requestId: input.requestId,
      requestedKey: manualRunCurrentBrowserKey(input),
      projection: "CURRENT_WHOLE_MANUAL_RUN_VIEW",
      scope: {
        projectId: origin.projectId,
        testRunId: origin.testRunId,
        organizationId: origin.organizationId,
        actorId: origin.nativeActorId,
        actorClerkUserId: origin.clerkActorId,
      },
    },
    view: {
      projectId: origin.projectId,
      testRunId: origin.testRunId,
      organizationId: origin.organizationId,
      originalOrganizationId: origin.organizationId,
      actorId: origin.nativeActorId,
      clerkActorId: origin.clerkActorId,
      canWrite: false,
      readRequestKey: JSON.stringify({
        testRunId: input.testRunId,
        projectId: input.projectId,
        originalOrganizationId: input.originalOrganizationId,
        expectedClerkActorId: input.expectedClerkActorId,
      }),
      plannedCaseIds: ids,
      unavailableCases: ids
        .filter((id) => missing.includes(id))
        .map((testCaseId) => ({
          testCaseId,
          reason: "MISSING_CASE_AND_FROZEN_DEFINITION",
        })),
      scopeAvailability: {
        plannedCount: ids.length,
        availableCount: ids.length - missing.length,
        unavailableCount: missing.length,
        complete: missing.length === 0,
        procedureBasis: "LEGACY_CURRENT_CASE_DEFINITIONS",
      },
      status: "RUNNING",
      executionContext: null,
      datasetBatchRuns: [],
      stepFieldLabels: {
        action: "Tester action",
        expectedActionOrData: "Technical behavior",
      },
      cases: ids
        .filter((id) => !missing.includes(id))
        .map((testCaseId) => ({
          testCaseId,
          displayId: null,
          title,
          background: " raw \nbackground ",
          prerequisiteIds: [],
          validationDomain: "SOFTWARE",
          verificationProfile: {
            setup: "",
            safety: "",
            instruments: "",
            acceptanceCriteria: "",
          },
          given: [],
          when: [],
          then: [],
          steps: [
            {
              order: 0,
              action: " exact \n action ",
              expectedActionOrData: "",
              expectedResult: null,
              expectedResponse: " exact ",
              mediaAttachmentIds: [],
            },
          ],
          stepExecutionAvailable: false,
          stepResults: [],
          currentResult: {
            status: "PASS",
            note: null,
            observations: {
              specimen: "",
              hardwareRevision: "",
              firmwareVersion: "",
              environment: "",
              measurements: [
                {
                  name: "Reading",
                  unit: "V",
                  value: 0,
                  lowerLimit: 0,
                  instrument: "Meter\n retained ",
                },
              ],
            },
          },
        })),
    },
    provenance: {
      procedures: "LEGACY_CURRENT_CASE_DEFINITIONS",
      observations: "CURRENT_SUPPORTED_API_VIEW_NOT_RAW_NATIVE_JSON",
      history: "CURRENT_HEADS_NOT_COMPLETE_REVISION_HISTORY",
      media: "IDENTIFIER_REFERENCES_NO_FILES_FETCHED",
    },
  };
  const admitted = admitManualRunCurrent(raw, input, origin);
  expect(admitted).not.toBeNull();
  return Object.freeze({
    origin: admitted!.origin,
    observedSessionId: session,
    epoch,
    revision: epoch + 1,
    receivedAt: "2026-10-06T11:00:00.000Z",
    data: admitted!.data,
  }) as ManualRunCurrentSnapshot;
}
function first() {
  const current = snapshot();
  const value = retainManualRunRows(null, current);
  expect(value.reason).toBeNull();
  return { current, retained: value.retained! };
}
describe("private manual row retention; pure admitted synthetic wire only", () => {
  it("pins exact first origin/order and immutable payload pointers without authorizing anything", () => {
    const { current, retained } = first();
    expect(retained.origin).toBe(current.origin);
    expect(retained.plannedCaseIds).toEqual(["first", "second"]);
    expect(retained.rows[0]).toBe(current.data.view.cases[0]);
    expect(Object.isFrozen(retained)).toBe(true);
    expect(Object.isFrozen(retained.rows)).toBe(true);
    expect(retained).not.toHaveProperty("canWrite");
    expect(retained).not.toHaveProperty("current");
  });
  it("missing row remains mounted privately, never joins the new current denominator", () => {
    const { retained } = first(),
      missing = snapshot({ missing: ["first"], title: "new second" }),
      result = retainManualRunRows(retained, missing);
    expect(result.current).toBe(missing);
    expect(result.retained!.rows.map((row) => row.testCaseId)).toEqual([
      "first",
      "second",
    ]);
    expect(result.retained!.rows[0]).toBe(retained.rows[0]);
    expect(result.retained!.rows[1]).toBe(missing.data.view.cases[0]);
    expect(
      result.current!.data.view.cases.map((row) => row.testCaseId),
    ).toEqual(["second"]);
    expect(result.current!.data.view.unavailableCases[0]!.testCaseId).toBe(
      "first",
    );
  });
  it("restored row replaces only its payload, leaving row keys/controllers external and unchanged", () => {
    const { retained } = first(),
      missing = retainManualRunRows(
        retained,
        snapshot({ missing: ["first"] }),
      ).retained!,
      restored = snapshot({ title: "restored exact" }),
      result = retainManualRunRows(missing, restored);
    expect(result.retained!.plannedCaseIds).toBe(retained.plannedCaseIds);
    expect(result.retained!.rows[0]).toBe(restored.data.view.cases[0]);
    expect(retained.rows[0]!.title).toBe("Exact title");
  });
  it("never-available identity has no fabricated CaseRow", () => {
    const current = snapshot({ missing: ["first"] }),
      result = retainManualRunRows(null, current);
    expect(result.retained!.plannedCaseIds).toEqual(["first", "second"]);
    expect(result.retained!.rows.map((row) => row.testCaseId)).toEqual([
      "second",
    ]);
  });
  it("denied/revoked read retains exact private row pointers and publishes no current facts", () => {
    const { retained } = first(),
      result = retainManualRunRows(retained, null);
    expect(result).toEqual({
      retained,
      current: null,
      reason: "NO_CURRENT_READ",
    });
    expect(result.retained).toBe(retained);
  });
  it.each([
    "projectId",
    "testRunId",
    "organizationId",
    "clerkActorId",
    "nativeActorId",
  ] as const)("changed original %s refuses without rebase/eviction", (key) => {
    const { retained } = first(),
      candidate = snapshot({
        origin: { ...retained.origin, [key]: "replacement" },
      }),
      result = retainManualRunRows(retained, candidate);
    expect(result.retained).toBe(retained);
    expect(result.current).toBeNull();
    expect(result.reason).toBe("ORIGINAL_SCOPE_CHANGED");
  });
  it.each(
    [
      ["second", "first"],
      ["first"],
      ["first", "second", "new"],
      ["first", "new"],
    ].map((ids) => ({ ids })),
  )("changed ordered membership $ids refuses whole candidate", ({ ids }) => {
    const { retained } = first(),
      result = retainManualRunRows(retained, snapshot({ ids }));
    expect(result.retained).toBe(retained);
    expect(result.current).toBeNull();
    expect(result.reason).toBe("ORIGINAL_SCOPE_CHANGED");
  });
  it("1000 identity ceiling cannot grow across later valid 1000-case scopes", () => {
    const ids = Array.from({ length: 1000 }, (_, index) => `case-${index}`),
      initial = retainManualRunRows(null, snapshot({ ids })).retained!;
    const changed = retainManualRunRows(
      initial,
      snapshot({ ids: [...ids.slice(1), "new-case"] }),
    );
    expect(changed.retained).toBe(initial);
    expect(changed.current).toBeNull();
    expect(initial.rows).toHaveLength(1000);
  });
  it("valid renewal of same actor session may resume only a new admitted snapshot, not a permission token", () => {
    const { retained } = first(),
      candidate = snapshot({ session: "session-B", epoch: 2 });
    expect(retainManualRunRows(retained, candidate)).toMatchObject({
      current: candidate,
      reason: null,
    });
  });
  it("exact raw multiline/NULL/empty/zero siblings are not trimmed/defaulted/coerced", () => {
    const { retained } = first(),
      row = retained.rows[0]!;
    expect(row.background).toBe(" raw \nbackground ");
    expect(row.steps[0]).toMatchObject({
      action: " exact \n action ",
      expectedActionOrData: "",
      expectedResult: null,
      expectedResponse: " exact ",
    });
    expect(row.currentResult).toMatchObject({
      note: null,
      observations: {
        measurements: [
          { value: 0, lowerLimit: 0, instrument: "Meter\n retained " },
        ],
      },
    });
  });
  it("genuine empty initial planned scope is distinct from a denied/nonempty historical workspace", () => {
    const empty = snapshot({ ids: [] }),
      value = retainManualRunRows(null, empty);
    expect(value.current).toBe(empty);
    expect(value.retained!.rows).toEqual([]);
    const { retained } = first();
    expect(retainManualRunRows(retained, empty)).toMatchObject({
      retained,
      current: null,
      reason: "ORIGINAL_SCOPE_CHANGED",
    });
  });
  it("aggregate retained plus newly available bodies refuse atomically, although each candidate is admitted", () => {
    const long = "x".repeat(9 * 1024 * 1024),
      initial = retainManualRunRows(
        null,
        snapshot({ missing: ["second"], title: long }),
      ).retained!;
    const candidate = snapshot({ missing: ["first"], title: long }),
      rejected = retainManualRunRows(initial, candidate);
    expect(rejected).toEqual({
      retained: initial,
      current: null,
      reason: "RETENTION_BOUND",
    });
    expect(initial.rows).toHaveLength(1);
    expect(initial.rows[0]!.title).toBe(long);
    const restored = snapshot({ title: "supported small" });
    expect(retainManualRunRows(initial, restored).current).toBe(restored);
  });
  it("mutable cache object is refused and cannot overwrite private mounting rows", () => {
    const { current, retained } = first(),
      mutable = structuredClone(current),
      result = retainManualRunRows(retained, mutable);
    expect(result).toEqual({
      retained,
      current: null,
      reason: "UNSUPPORTED_SNAPSHOT",
    });
  });
  it("a frozen getter is never invoked or adopted", () => {
    const { current, retained } = first(),
      getter = vi.fn(() => current.data),
      forged = Object.freeze({
        ...current,
        get data() {
          return getter();
        },
      });
    expect(retainManualRunRows(retained, forged)).toMatchObject({
      retained,
      current: null,
      reason: "UNSUPPORTED_SNAPSHOT",
    });
    expect(getter).not.toHaveBeenCalled();
  });
  it("unsupported timestamp/frame is refused before changing rows", () => {
    const { current, retained } = first();
    for (const patch of [
      { receivedAt: "bad" },
      { epoch: -1 },
      { revision: Infinity },
      { observedSessionId: "" },
    ])
      expect(
        retainManualRunRows(retained, Object.freeze({ ...current, ...patch })),
      ).toMatchObject({
        retained,
        current: null,
        reason: "UNSUPPORTED_SNAPSHOT",
      });
  });
  it.each(["origin", "plannedCaseIds", "rows"] as const)(
    "prior %s accessor is inspected before any private read and never invoked",
    (key) => {
      const { current, retained } = first();
      const getter = vi.fn(() => retained[key]);
      const forged = { ...retained };
      Object.defineProperty(forged, key, { enumerable: true, get: getter });
      const prior = Object.freeze(forged) as ManualRunRowRetention;
      const output = retainManualRunRows(prior, current);
      expect(output.retained).toBe(prior);
      expect(output.current).toBeNull();
      expect(output.reason).toBe("RETENTION_BOUND");
      expect(getter).not.toHaveBeenCalled();
    },
  );
  it.each([
    "extra-snapshot",
    "private-origin",
    "missing-data",
    "missing-session",
    "missing-origin-key",
    "nonprimitive-origin",
  ])(
    "strict snapshot/origin wrapper %s cannot surround valid admitted data",
    (kind) => {
      const { current, retained } = first();
      const forged: Record<string, unknown> = { ...current };
      if (kind === "extra-snapshot")
        forged.privateSibling = "must not be admitted";
      if (kind === "private-origin")
        forged.origin = Object.freeze({
          ...current.origin,
          privateSibling: "must not be admitted",
        });
      if (kind === "missing-data") delete forged.data;
      if (kind === "missing-session") delete forged.observedSessionId;
      if (kind === "missing-origin-key") {
        const origin: Record<string, unknown> = { ...current.origin };
        delete origin.nativeActorId;
        forged.origin = Object.freeze(origin);
      }
      if (kind === "nonprimitive-origin")
        forged.origin = Object.freeze({
          ...current.origin,
          nativeActorId: Object.freeze({ id: "n" }),
        });
      const output = retainManualRunRows(
        retained,
        Object.freeze(forged) as unknown as ManualRunCurrentSnapshot,
      );
      expect(output.retained).toBe(retained);
      expect(output.current).toBeNull();
      expect(output.reason).toBe("UNSUPPORTED_SNAPSHOT");
    },
  );
  it("malformed prior state cannot be silently repaired or substituted", () => {
    const { retained } = first(),
      malformed = Object.freeze({
        ...retained,
        rows: Object.freeze([retained.rows[0]!, retained.rows[0]!]),
      }) as ManualRunRowRetention;
    expect(retainManualRunRows(malformed, snapshot())).toMatchObject({
      retained: malformed,
      current: null,
      reason: "RETENTION_BOUND",
    });
  });
  it("unchanged exact current snapshot produces only one row per identity, never generations", () => {
    const { current, retained } = first();
    let state = retained;
    for (let i = 0; i < 20; i++)
      state = retainManualRunRows(state, current).retained!;
    expect(state.rows).toHaveLength(2);
    expect(state.rows[0]).toBe(current.data.view.cases[0]);
    expect(state.rows[1]).toBe(current.data.view.cases[1]);
    expect(state.bytes).toBe(retained.bytes);
  });
});
