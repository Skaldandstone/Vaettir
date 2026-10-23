import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { manualRunCurrentReadKey } from "@vaettir/api/src/services/manualRunCurrentReadSchema";
import {
  admitManualRunCurrent,
  inspectManualRunWire,
  manualRunCurrentBrowserKey,
  MANUAL_RUN_CLIENT_BOUNDS,
  type ManualRunCurrentInput,
  type ManualRunCurrentWire,
} from "./manual-run-current-reader";
function fixture() {
  const input: ManualRunCurrentInput = {
      projectId: "p",
      testRunId: "run",
      originalOrganizationId: "o",
      expectedClerkActorId: "cl",
      expectedNativeActorId: "n",
      requestId: randomUUID(),
    },
    origin = {
      projectId: "p",
      testRunId: "run",
      organizationId: "o",
      clerkActorId: "cl",
      nativeActorId: "n",
    },
    configuration = {
      configuration: "",
      environment: "",
      platform: "",
      build: "",
      hardwareRevision: "",
      firmwareVersion: "",
      rig: "",
      batchOrLot: "",
      calibrationReference: "",
      protocolReference: "",
    },
    step = {
      order: 8,
      action: " action\n ",
      expectedActionOrData: "",
      expectedResult: null,
      expectedResponse: " response ",
      mediaAttachmentIds: ["media-id"],
    },
    observations = {
      specimen: " specimen ",
      hardwareRevision: "",
      firmwareVersion: "",
      environment: "",
      measurements: [
        {
          name: "Reading",
          unit: "V",
          value: 0,
          lowerLimit: 0,
          upperLimit: 2,
          instrument: "",
        },
      ],
    },
    raw: ManualRunCurrentWire = {
      readContext: {
        requestId: input.requestId,
        requestedKey: manualRunCurrentBrowserKey(input),
        projection: "CURRENT_WHOLE_MANUAL_RUN_VIEW",
        scope: {
          projectId: "p",
          testRunId: "run",
          organizationId: "o",
          actorId: "n",
          actorClerkUserId: "cl",
        },
      },
      view: {
        testRunId: "run",
        projectId: "p",
        organizationId: "o",
        originalOrganizationId: "o",
        actorId: "n",
        clerkActorId: "cl",
        canWrite: false,
        readRequestKey: JSON.stringify({
          testRunId: "run",
          projectId: "p",
          originalOrganizationId: "o",
          expectedClerkActorId: "cl",
        }),
        plannedCaseIds: ["case"],
        unavailableCases: [],
        scopeAvailability: {
          plannedCount: 1,
          availableCount: 1,
          unavailableCount: 0,
          complete: true,
          procedureBasis: "FROZEN_RUN_DEFINITIONS",
        },
        status: "RUNNING",
        stepFieldLabels: {
          action: "Tester action",
          expectedActionOrData: "Technical behavior",
          expectedResponse: "Reply",
        },
        executionContext: {
          version: 1,
          experience: {
            version: 1,
            offerings: ["SOFTWARE"],
            softwareKinds: ["API"],
            gameGenres: [],
            gamePlatforms: [],
            multiplayerModes: [],
            hardwareKinds: [],
            processKinds: [],
            jurisdictions: [" US "],
          },
          profileHash: "a".repeat(64),
          configuration,
          stepFieldLabels: {
            action: "Tester action",
            expectedActionOrData: "Technical behavior",
            expectedResponse: "Reply",
          },
          caseDefinitions: [
            {
              testCaseId: "case",
              title: "",
              validationDomain: "SOFTWARE",
              reviewStatus: "APPROVED",
              background: null,
              given: ["", " given "],
              when: [],
              then: [],
              verificationProfile: {
                setup: "",
                safety: "",
                instruments: "",
                acceptanceCriteria: "",
              },
              steps: [step],
            },
          ],
        },
        datasetBatchRuns: [],
        cases: [
          {
            testCaseId: "case",
            displayId: null,
            title: "",
            background: null,
            prerequisiteIds: [],
            validationDomain: "SOFTWARE",
            verificationProfile: {
              setup: "",
              safety: "",
              instruments: "",
              acceptanceCriteria: "",
            },
            given: ["", " given "],
            when: [],
            then: [],
            steps: [step],
            stepExecutionAvailable: true,
            stepResults: [
              {
                stepIndex: 0,
                revisionCount: 1,
                current: {
                  id: "revision",
                  status: "PASS",
                  note: "",
                  observations,
                  evidenceAttachments: [
                    { id: "evidence", fileName: "file.txt" },
                  ],
                  actorName: "Synthetic Actor",
                  recordedAt: "2026-09-01T00:00:00.123Z",
                  correctionReason: null,
                  previousRevisionId: null,
                  revisionNumber: 1,
                },
              },
            ],
            currentResult: { status: "PASS", note: null, observations },
          },
        ],
      },
      provenance: {
        procedures: "FROZEN_RUN_DEFINITIONS",
        observations: "CURRENT_SUPPORTED_API_VIEW_NOT_RAW_NATIVE_JSON",
        history: "CURRENT_HEADS_NOT_COMPLETE_REVISION_HISTORY",
        media: "IDENTIFIER_REFERENCES_NO_FILES_FETCHED",
      },
    };
  return { input, origin, raw, configuration };
}
it("complete wire admission validates original native/nonce/key/provenance and immutable exact NULL/blank/whitespace/0 fields without applying defaults/trim", () => {
  const f = fixture(),
    admitted = admitManualRunCurrent(f.raw, f.input, f.origin)!;
  expect(admitted).not.toBeNull();
  expect(admitted.origin).toEqual(f.origin);
  expect(admitted.data).toEqual(f.raw);
  expect(Object.isFrozen(admitted.data.view.cases[0]!.steps)).toBe(true);
  expect(admitted.data.view.cases[0]!.currentResult!.note).toBeNull();
  expect(admitted.data.view.cases[0]!.stepResults[0]!.current!.note).toBe("");
  expect(
    admitted.data.view.cases[0]!.currentResult!.observations.measurements[0]!
      .value,
  ).toBe(0);
  expect(
    admitted.data.view.executionContext!.experience!.jurisdictions,
  ).toEqual([" US "]);
  f.raw.view.cases[0]!.steps[0]!.action = "changed";
  expect(admitted.data.view.cases[0]!.steps[0]!.action).toBe(" action\n ");
});
it.each([
  "nonce",
  "key",
  "native",
  "Clerk",
  "org",
  "run",
  "statusExtra",
  "headExtra",
  "contextExtra",
  "missingExperience",
  "missingStep",
  "partition",
  "duplicate",
  "order",
  "selfPrereq",
  "foreignPrereq",
  "provenance",
])(
  "%s malformed/changed complete native view refuses, never drops a field or planned identity",
  (kind) => {
    const f = fixture();
    if (kind === "nonce") f.raw.readContext.requestId = randomUUID();
    if (kind === "key") f.raw.readContext.requestedKey = "other";
    if (kind === "native") f.raw.readContext.scope.actorId = "replacement";
    if (kind === "Clerk") f.raw.view.clerkActorId = "other";
    if (kind === "org") f.raw.view.organizationId = "other";
    if (kind === "run") f.raw.view.testRunId = "other";
    if (kind === "statusExtra") Object.assign(f.raw.view, { future: true });
    if (kind === "headExtra")
      Object.assign(f.raw.view.cases[0]!.stepResults[0]!.current!, {
        future: true,
      });
    if (kind === "contextExtra")
      Object.assign(f.raw.view.executionContext!, { future: true });
    if (kind === "missingExperience")
      delete (
        f.raw.view.executionContext!.experience as unknown as Record<
          string,
          unknown
        >
      ).gamePlatforms;
    if (kind === "missingStep")
      delete (
        f.raw.view.cases[0]!.steps[0] as unknown as Record<string, unknown>
      ).expectedResponse;
    if (kind === "partition") f.raw.view.scopeAvailability.plannedCount = 2;
    if (kind === "duplicate") f.raw.view.plannedCaseIds.push("case");
    if (kind === "order") {
      f.raw.view.plannedCaseIds.push("missing");
      f.raw.view.unavailableCases = [
        { testCaseId: "missing", reason: "MISSING_CASE_AND_FROZEN_DEFINITION" },
      ];
      Object.assign(f.raw.view.scopeAvailability, {
        plannedCount: 2,
        unavailableCount: 1,
        complete: false,
      });
    }
    if (kind === "selfPrereq") f.raw.view.cases[0]!.prerequisiteIds = ["case"];
    if (kind === "foreignPrereq")
      f.raw.view.cases[0]!.prerequisiteIds = ["foreign"];
    if (kind === "provenance")
      f.raw.provenance.procedures = "LEGACY_CURRENT_CASE_DEFINITIONS";
    expect(admitManualRunCurrent(f.raw, f.input, f.origin)).toBeNull();
  },
);
it.each([
  new Date("2026-09-01T00:00:00.123Z"),
  "2026-09-01T00:00:00.123456Z",
  "2026-09-01T00:00:00Z",
  "2026-09-01T00:00:00.123+00:00",
  "2026-02-31T00:00:00.123Z",
  "+012345-09-01T00:00:00.123Z",
])(
  "step recordedAt %s is not exact supported UTC wire text; no Date object/coercion/submillisecond normalization",
  (value) => {
    const f = fixture();
    Object.assign(f.raw.view.cases[0]!.stepResults[0]!.current!, {
      recordedAt: value,
    });
    expect(admitManualRunCurrent(f.raw, f.input, f.origin)).toBeNull();
  },
);
it("ordered full legacy partition admits readonly unavailable IDs and genuine empty native scope distinctly, never an executable invented case", () => {
  const f = fixture();
  f.raw.view.executionContext = null;
  f.raw.provenance.procedures = "LEGACY_CURRENT_CASE_DEFINITIONS";
  f.raw.view.scopeAvailability.procedureBasis =
    "LEGACY_CURRENT_CASE_DEFINITIONS";
  f.raw.view.plannedCaseIds = ["missing-a", "case", "missing-b"];
  f.raw.view.unavailableCases = [
    { testCaseId: "missing-a", reason: "MISSING_CASE_AND_FROZEN_DEFINITION" },
    { testCaseId: "missing-b", reason: "MISSING_CASE_AND_FROZEN_DEFINITION" },
  ];
  Object.assign(f.raw.view.scopeAvailability, {
    plannedCount: 3,
    unavailableCount: 2,
    complete: false,
  });
  expect(
    admitManualRunCurrent(f.raw, f.input, f.origin)!.data.view.unavailableCases,
  ).toEqual(f.raw.view.unavailableCases);
  f.raw.view.unavailableCases.reverse();
  expect(admitManualRunCurrent(f.raw, f.input, f.origin)).toBeNull();
  f.raw.view.plannedCaseIds = [];
  f.raw.view.cases = [];
  f.raw.view.unavailableCases = [];
  Object.assign(f.raw.view.scopeAvailability, {
    plannedCount: 0,
    availableCount: 0,
    unavailableCount: 0,
    complete: true,
  });
  expect(
    admitManualRunCurrent(f.raw, f.input, f.origin)!.data.view.scopeAvailability
      .plannedCount,
  ).toBe(0);
});
it("full optional frozen plan/retest/dataset contexts and captured references are validated and retained without files/AI/operation inference", () => {
  const f = fixture(),
    ctx = f.raw.view.executionContext!,
    hash = "b".repeat(64),
    batch = `dataset_${hash}`;
  ctx.plan = {
    testPlanId: "plan",
    name: " exact plan ",
    templateHash: hash,
    configurationId: randomUUID(),
    template: {
      version: 1,
      testCaseIds: ["case"],
      configurations: [
        { id: randomUUID(), name: "Preset", context: f.configuration },
      ],
    },
  };
  ctx.datasetExecution = {
    version: 1,
    batchId: batch,
    expansionHash: hash,
    datasetId: "dataset",
    datasetHash: hash,
    testCaseId: "case",
    sourceDisplayId: "",
    rowIndex: 0,
    rowName: "row",
    values: { empty: "", exact: " value " },
    configurationHash: hash,
    rowCount: 1,
  };
  ctx.retest = {
    version: 1,
    sourceRunId: "source-run",
    sourceCaseId: "case",
    sourceDisplayId: "CASE-1",
    sourceOutcome: "FAIL",
    sourceEvidenceHash: hash,
    sourceDefinitionHash: hash,
    configurationHash: hash,
    sourceResults: [
      {
        id: "source-result",
        testCaseId: "case",
        status: "FAIL",
        note: null,
        errorMessage: "",
        observations: f.raw.view.cases[0]!.currentResult!.observations,
      },
    ],
    sourceStepRevisions: [
      {
        testCaseId: "case",
        stepIndex: 0,
        revisionId: "old-revision",
        revisionNumber: 1,
      },
    ],
    sourceDatasetExecution: {
      batchId: batch,
      datasetId: "dataset",
      datasetHash: hash,
      rowIndex: 0,
      rowName: "row",
      values: { empty: "" },
    },
  };
  expect(
    admitManualRunCurrent(f.raw, f.input, f.origin)!.data.view.executionContext,
  ).toEqual(ctx);
  Object.assign(ctx.retest, { futurePrivateShape: {} });
  expect(admitManualRunCurrent(f.raw, f.input, f.origin)).toBeNull();
});
it("browser structural walk refuses accessors/toJSON/symbol/nonenumerable/cycle/depth/array before invoking any hook or cloning private content", () => {
  const called = vi.fn(),
    accessor = {};
  Object.defineProperty(accessor, "body", { enumerable: true, get: called });
  const hidden = {};
  Object.defineProperty(hidden, "body", {
    value: "private",
    enumerable: false,
  });
  const symbol = { [Symbol("x")]: "private" },
    cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const arr: unknown[] = [];
  Object.defineProperty(arr, Symbol("x"), { value: "private" });
  let deep: unknown = null;
  for (let i = 0; i < 66; i++) deep = { child: deep };
  for (const value of [
    accessor,
    hidden,
    symbol,
    cycle,
    arr,
    deep,
    { toJSON: called },
    Array.from({ length: 1001 }, () => null),
    { undefined },
  ])
    expect(() => inspectManualRunWire(value)).toThrow(/unsupported/);
  expect(called).not.toHaveBeenCalled();
});
it.each(["current step", "case domain", "retest outcome", "retest result"])(
  "%s enum requires a literal string, never array/object/number coercion",
  (field) => {
    for (const kind of ["array", "object", "number", "hook"]) {
      const f = fixture(),
        called = vi.fn(() => "PASS"),
        hash = "b".repeat(64);
      f.raw.view.executionContext!.retest = {
        version: 1,
        sourceRunId: "source-run",
        sourceCaseId: "case",
        sourceDisplayId: "CASE-1",
        sourceOutcome: "FAIL",
        sourceEvidenceHash: hash,
        sourceDefinitionHash: hash,
        configurationHash: hash,
        sourceResults: [
          {
            id: "source-result",
            testCaseId: "case",
            status: "FAIL",
            note: null,
            errorMessage: "",
            observations: f.raw.view.cases[0]!.currentResult!.observations,
          },
        ],
        sourceStepRevisions: [],
      };
      expect(admitManualRunCurrent(f.raw, f.input, f.origin)).not.toBeNull();
      const target =
        field === "current step"
          ? f.raw.view.cases[0]!.stepResults[0]!.current!
          : field === "case domain"
            ? f.raw.view.cases[0]!
            : field === "retest outcome"
              ? f.raw.view.executionContext!.retest
              : f.raw.view.executionContext!.retest.sourceResults[0]!;
      const key =
        field === "case domain"
          ? "validationDomain"
          : field === "retest outcome"
            ? "sourceOutcome"
            : "status";
      const valid =
        field === "case domain"
          ? "SOFTWARE"
          : field.startsWith("retest")
            ? "FAIL"
            : "PASS";
      const invalid: unknown =
        kind === "array"
          ? [valid]
          : kind === "object"
            ? { value: valid }
            : kind === "number"
              ? 1
              : { toString: called };
      Object.assign(target, { [key]: invalid });
      expect(admitManualRunCurrent(f.raw, f.input, f.origin)).toBeNull();
      expect(called).not.toHaveBeenCalled();
      expect(Object.getOwnPropertyDescriptor(target, key)!.value).toBe(invalid);
    }
  },
);
it("exact escaped byte admission is explicit and refusal does not clip large quoted/control text", () => {
  const maximum = MANUAL_RUN_CLIENT_BOUNDS.bytes,
    exact = "x".repeat(maximum - 2);
  expect(inspectManualRunWire(exact).bytes).toBe(maximum);
  expect(() => inspectManualRunWire(exact + "x")).toThrow(/bounds/);
  expect(inspectManualRunWire("\u0001").bytes).toBe(8);
});
it("explicit one-million-node refusal is independent of admitted bytes; no large matrix is partially accepted", () => {
  const rows = Array.from({ length: 1000 }, () =>
    Array.from({ length: 1000 }, () => null),
  );
  expect(() => inspectManualRunWire(rows)).toThrow(/bounds/);
});
it("browser-local request key is exactly compatible with server ordering/absence, not a write hash or new native authority", () => {
  const f = fixture();
  expect(manualRunCurrentBrowserKey(f.input)).toBe(
    manualRunCurrentReadKey(f.input),
  );
  const { expectedNativeActorId: _native, ...bootstrap } = f.input;
  expect(manualRunCurrentBrowserKey(bootstrap)).toBe(
    manualRunCurrentReadKey(bootstrap),
  );
  expect(manualRunCurrentBrowserKey(bootstrap)).not.toContain(
    "expectedNativeActorId",
  );
  const source = readFileSync(
    new URL("./manual-run-current-reader.ts", import.meta.url),
    "utf8",
  );
  expect(source).not.toMatch(
    /from ["']@vaettir\/api|from ["']node:|manualRunCurrentReadSchema|\.trim\(/,
  );
});
