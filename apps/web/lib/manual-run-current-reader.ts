import { experienceProfileSchema } from "@vaettir/core";
import type { RouterInputs, RouterOutputs } from "./trpcReact";
import { RunHistoryRenderGuard } from "./run-history-reader";
export { RunHistoryRenderGuard as ManualRunCurrentRenderGuard };
export type ManualRunCurrentInput = RouterInputs["manualRunReads"]["current"];
export type ManualRunCurrentWire = RouterOutputs["manualRunReads"]["current"];
export type ManualRunCurrentOrigin = Readonly<{
  projectId: string;
  testRunId: string;
  organizationId: string;
  clerkActorId: string;
  nativeActorId: string;
}>;
export type ManualRunCurrentSnapshot = Readonly<{
  origin: ManualRunCurrentOrigin;
  observedSessionId: string;
  epoch: number;
  revision: number;
  receivedAt: string;
  data: ManualRunCurrentWire;
}>;
export const MANUAL_RUN_CLIENT_BOUNDS = Object.freeze({
  bytes: 16 * 1024 * 1024,
  depth: 64,
  nodes: 1000000,
  array: 1000,
  objectKeys: 10000,
});
const denied = () =>
  Error(
    "The complete supported manual-run wire view exceeds browser inspection bounds or has an unsupported scope, value, date or field. Nothing was dropped, coerced or repaired.",
  );
type RecordValue = Record<string, unknown>;
function object(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is RecordValue {
  return (
    object(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every(
      (key) => required.includes(key) || optional.includes(key),
    )
  );
}
function string(
  value: unknown,
  max = MANUAL_RUN_CLIENT_BOUNDS.bytes,
  min = 0,
): value is string {
  return (
    typeof value === "string" && value.length >= min && value.length <= max
  );
}
function nullableString(value: unknown, max = MANUAL_RUN_CLIENT_BOUNDS.bytes) {
  return value === null || string(value, max);
}
function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function integer(
  value: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): value is number {
  return (
    number(value) && Number.isSafeInteger(value) && value >= min && value <= max
  );
}
function array(
  value: unknown,
  max: number,
  predicate: (value: unknown) => boolean,
): value is unknown[] {
  return Array.isArray(value) && value.length <= max && value.every(predicate);
}
function identity(value: unknown): value is string {
  if (!string(value, 200, 1)) return false;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (
      code < 32 ||
      (code >= 127 && code <= 159) ||
      (code >= 0xd800 && code <= 0xdfff)
    )
      return false;
  }
  return true;
}
function uniqueIds(value: unknown, max = 1000): value is string[] {
  return array(value, max, identity) && new Set(value).size === value.length;
}
function uuid(value: unknown): value is string {
  return (
    string(value, 36) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
function hash(value: unknown): value is string {
  return string(value, 64) && /^[a-f0-9]{64}$/.test(value);
}
function utc(value: unknown): value is string {
  if (
    !string(value, 24) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return false;
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) &&
    date.getUTCFullYear() >= 1 &&
    date.getUTCFullYear() <= 9999 &&
    date.toISOString() === value
  );
}
function dictionary(value: unknown, predicate: (value: unknown) => boolean) {
  return object(value) && Object.values(value).every(predicate);
}
/** Descriptor walk BEFORE clone, private property reads or serialization. Counts
 * exact escaped JSON bytes without invoking getters/toJSON; dense JSON only.
 * These are explicit browser refusal limits, not expanded native admission. */
export function inspectManualRunWire(value: unknown) {
  let bytes = 0,
    nodes = 0;
  const ancestors = new Set<object>(),
    encoder = new TextEncoder();
  function add(value: string) {
    bytes += encoder.encode(value).byteLength;
    if (bytes > MANUAL_RUN_CLIENT_BOUNDS.bytes) throw denied();
  }
  function visit(value: unknown, depth: number) {
    if (
      ++nodes > MANUAL_RUN_CLIENT_BOUNDS.nodes ||
      depth > MANUAL_RUN_CLIENT_BOUNDS.depth
    )
      throw denied();
    if (value === null) {
      add("null");
      return;
    }
    if (typeof value === "string") {
      add(JSON.stringify(value));
      return;
    }
    if (typeof value === "boolean") {
      add(value ? "true" : "false");
      return;
    }
    if (number(value)) {
      add(JSON.stringify(value));
      return;
    }
    if (typeof value !== "object" || ancestors.has(value)) throw denied();
    const isArray = Array.isArray(value),
      prototype = Object.getPrototypeOf(value);
    if (
      prototype !== (isArray ? Array.prototype : Object.prototype) &&
      !(prototype === null && !isArray)
    )
      throw denied();
    if (isArray && value.length > MANUAL_RUN_CLIENT_BOUNDS.array)
      throw denied();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length > MANUAL_RUN_CLIENT_BOUNDS.objectKeys ||
      keys.some((key) => typeof key !== "string")
    )
      throw denied();
    ancestors.add(value);
    add(isArray ? "[" : "{");
    if (isArray) {
      if (
        keys.length !== value.length + 1 ||
        keys.some(
          (key) =>
            key !== "length" &&
            (!/^\d+$/.test(String(key)) ||
              String(Number(key)) !== key ||
              Number(key) >= value.length),
        )
      )
        throw denied();
      for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
          throw denied();
        if (i) add(",");
        visit(descriptor.value, depth + 1);
      }
    } else {
      let index = 0;
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!descriptor.enumerable || !("value" in descriptor)) throw denied();
        if (index++) add(",");
        add(JSON.stringify(key) + ":");
        visit(descriptor.value, depth + 1);
      }
    }
    add(isArray ? "]" : "}");
    ancestors.delete(value);
  }
  visit(value, 0);
  return Object.freeze({ bytes, nodes });
}
function immutable<T>(value: T): T {
  const cloned = structuredClone(value);
  const stack: unknown[] = [cloned];
  while (stack.length) {
    const next = stack.pop();
    if (next !== null && typeof next === "object") {
      stack.push(...Object.values(next));
      Object.freeze(next);
    }
  }
  return cloned;
}
function configuration(value: unknown) {
  const short = [
      "platform",
      "build",
      "hardwareRevision",
      "firmwareVersion",
      "rig",
      "batchOrLot",
      "calibrationReference",
      "protocolReference",
    ],
    long = ["configuration", "environment"];
  return (
    fields(value, [...short, ...long]) &&
    short.every((key) => string(value[key], 300)) &&
    long.every((key) => string(value[key], 2000))
  );
}
function verification(value: unknown) {
  return (
    fields(value, ["setup", "safety", "instruments", "acceptanceCriteria"]) &&
    Object.values(value).every((v) => string(v, 10000))
  );
}
function measurement(value: unknown) {
  return (
    fields(
      value,
      ["name", "unit", "value", "instrument"],
      ["lowerLimit", "upperLimit"],
    ) &&
    string(value.name, 200, 1) &&
    string(value.unit, 40, 1) &&
    number(value.value) &&
    string(value.instrument, 200) &&
    (!Object.hasOwn(value, "lowerLimit") || number(value.lowerLimit)) &&
    (!Object.hasOwn(value, "upperLimit") || number(value.upperLimit)) &&
    (!Object.hasOwn(value, "lowerLimit") ||
      !Object.hasOwn(value, "upperLimit") ||
      (value.lowerLimit as number) <= (value.upperLimit as number))
  );
}
function observations(value: unknown) {
  return (
    fields(value, [
      "specimen",
      "hardwareRevision",
      "firmwareVersion",
      "environment",
      "measurements",
    ]) &&
    string(value.specimen, 300) &&
    string(value.hardwareRevision, 200) &&
    string(value.firmwareVersion, 200) &&
    string(value.environment, 1000) &&
    array(value.measurements, 100, measurement)
  );
}
function procedureStep(
  value: unknown,
  textMax = MANUAL_RUN_CLIENT_BOUNDS.bytes,
) {
  return (
    fields(value, [
      "order",
      "action",
      "expectedActionOrData",
      "expectedResult",
      "expectedResponse",
      "mediaAttachmentIds",
    ]) &&
    number(value.order) &&
    string(value.action, textMax) &&
    ["expectedActionOrData", "expectedResult", "expectedResponse"].every(
      (key) => nullableString(value[key], textMax),
    ) &&
    array(value.mediaAttachmentIds, 100, (v) => string(v, 200))
  );
}
function currentStep(value: unknown) {
  return (
    fields(value, [
      "id",
      "status",
      "note",
      "observations",
      "evidenceAttachments",
      "actorName",
      "recordedAt",
      "correctionReason",
      "previousRevisionId",
      "revisionNumber",
    ]) &&
    string(value.id) &&
    string(value.status) &&
    ["PASS", "FAIL", "BLOCKED", "SKIP"].includes(value.status) &&
    nullableString(value.note) &&
    observations(value.observations) &&
    array(
      value.evidenceAttachments,
      20,
      (v) =>
        fields(v, ["id", "fileName"]) && string(v.id) && string(v.fileName),
    ) &&
    string(value.actorName) &&
    utc(value.recordedAt) &&
    nullableString(value.correctionReason) &&
    nullableString(value.previousRevisionId) &&
    number(value.revisionNumber)
  );
}
function caseView(value: unknown) {
  return (
    fields(value, [
      "testCaseId",
      "displayId",
      "title",
      "background",
      "prerequisiteIds",
      "validationDomain",
      "verificationProfile",
      "given",
      "when",
      "then",
      "steps",
      "stepExecutionAvailable",
      "stepResults",
      "currentResult",
    ]) &&
    identity(value.testCaseId) &&
    nullableString(value.displayId) &&
    string(value.title) &&
    nullableString(value.background) &&
    uniqueIds(value.prerequisiteIds) &&
    string(value.validationDomain) &&
    [
      "SOFTWARE",
      "HARDWARE",
      "SYSTEM_INTEGRATION",
      "HIL",
      "MANUFACTURING",
      "MEDICAL_DEVICE",
      "PHARMA_LAB",
      "OTHER",
    ].includes(value.validationDomain) &&
    verification(value.verificationProfile) &&
    ["given", "when", "then"].every((key) =>
      array(value[key], 500, (v) => string(v)),
    ) &&
    array(value.steps, 500, (step) => procedureStep(step)) &&
    typeof value.stepExecutionAvailable === "boolean" &&
    array(
      value.stepResults,
      500,
      (v) =>
        fields(v, ["stepIndex", "current", "revisionCount"]) &&
        number(v.stepIndex) &&
        number(v.revisionCount) &&
        (v.current === null || currentStep(v.current)),
    ) &&
    (value.currentResult === null ||
      (fields(value.currentResult, ["status", "note", "observations"]) &&
        string(value.currentResult.status) &&
        nullableString(value.currentResult.note) &&
        observations(value.currentResult.observations)))
  );
}
function frozenCase(value: unknown) {
  return (
    fields(value, [
      "testCaseId",
      "title",
      "validationDomain",
      "reviewStatus",
      "background",
      "given",
      "when",
      "then",
      "verificationProfile",
      "steps",
    ]) &&
    identity(value.testCaseId) &&
    string(value.title, 10000) &&
    string(value.validationDomain, 100) &&
    string(value.reviewStatus, 100) &&
    nullableString(value.background, 10000) &&
    ["given", "when", "then"].every((key) =>
      array(value[key], 500, (v) => string(v, 10000)),
    ) &&
    verification(value.verificationProfile) &&
    array(
      value.steps,
      500,
      (v) => procedureStep(v, 10000) && integer((v as RecordValue).order),
    )
  );
}
function template(value: unknown) {
  return (
    fields(value, ["version", "testCaseIds", "configurations"]) &&
    value.version === 1 &&
    uniqueIds(value.testCaseIds, 500) &&
    array(
      value.configurations,
      20,
      (v) =>
        fields(v, ["id", "name", "context"]) &&
        uuid(v.id) &&
        string(v.name, 120, 1) &&
        configuration(v.context),
    ) &&
    new Set((value.configurations as RecordValue[]).map((v) => v.id)).size ===
      (value.configurations as unknown[]).length
  );
}
function retest(value: unknown) {
  return (
    fields(
      value,
      [
        "version",
        "sourceRunId",
        "sourceCaseId",
        "sourceDisplayId",
        "sourceOutcome",
        "sourceEvidenceHash",
        "sourceDefinitionHash",
        "configurationHash",
        "sourceResults",
        "sourceStepRevisions",
      ],
      ["sourceDatasetExecution"],
    ) &&
    value.version === 1 &&
    ["sourceRunId", "sourceCaseId", "sourceDisplayId"].every((key) =>
      identity(value[key]),
    ) &&
    string(value.sourceOutcome) &&
    ["FAIL", "BLOCKED"].includes(value.sourceOutcome) &&
    ["sourceEvidenceHash", "sourceDefinitionHash", "configurationHash"].every(
      (key) => hash(value[key]),
    ) &&
    array(
      value.sourceResults,
      500,
      (v) =>
        fields(v, [
          "id",
          "testCaseId",
          "status",
          "note",
          "errorMessage",
          "observations",
        ]) &&
        identity(v.id) &&
        identity(v.testCaseId) &&
        string(v.status) &&
        ["PASS", "FAIL", "BLOCKED", "SKIP", "FLAKY"].includes(v.status) &&
        nullableString(v.note, 10000) &&
        nullableString(v.errorMessage, 10000) &&
        observations(v.observations),
    ) &&
    (value.sourceResults as unknown[]).length > 0 &&
    array(
      value.sourceStepRevisions,
      500,
      (v) =>
        fields(v, [
          "testCaseId",
          "stepIndex",
          "revisionId",
          "revisionNumber",
        ]) &&
        identity(v.testCaseId) &&
        integer(v.stepIndex, 0, 499) &&
        identity(v.revisionId) &&
        integer(v.revisionNumber, 1),
    ) &&
    (!Object.hasOwn(value, "sourceDatasetExecution") ||
      (fields(value.sourceDatasetExecution, [
        "batchId",
        "datasetId",
        "datasetHash",
        "rowIndex",
        "rowName",
        "values",
      ]) &&
        string(value.sourceDatasetExecution.batchId, 72) &&
        /^dataset_[a-f0-9]{64}$/.test(value.sourceDatasetExecution.batchId) &&
        identity(value.sourceDatasetExecution.datasetId) &&
        hash(value.sourceDatasetExecution.datasetHash) &&
        integer(value.sourceDatasetExecution.rowIndex, 0, 49) &&
        string(value.sourceDatasetExecution.rowName, 200, 1) &&
        dictionary(value.sourceDatasetExecution.values, (v) =>
          string(v, 10000),
        )))
  );
}
function context(value: unknown) {
  return (
    fields(
      value,
      [
        "version",
        "experience",
        "profileHash",
        "configuration",
        "stepFieldLabels",
        "caseDefinitions",
      ],
      ["startRequestHash", "plan", "retest", "datasetExecution"],
    ) &&
    value.version === 1 &&
    (value.experience === null ||
      (fields(value.experience, [
        "version",
        "offerings",
        "softwareKinds",
        "gameGenres",
        "gamePlatforms",
        "multiplayerModes",
        "hardwareKinds",
        "processKinds",
        "jurisdictions",
      ]) &&
        experienceProfileSchema.safeParse(value.experience).success)) &&
    hash(value.profileHash) &&
    (!Object.hasOwn(value, "startRequestHash") ||
      hash(value.startRequestHash)) &&
    configuration(value.configuration) &&
    dictionary(value.stepFieldLabels, (v) => string(v, 200)) &&
    array(value.caseDefinitions, 1000, frozenCase) &&
    (!Object.hasOwn(value, "plan") ||
      (fields(value.plan, [
        "testPlanId",
        "name",
        "templateHash",
        "configurationId",
        "template",
      ]) &&
        identity(value.plan.testPlanId) &&
        string(value.plan.name, 10000) &&
        hash(value.plan.templateHash) &&
        uuid(value.plan.configurationId) &&
        template(value.plan.template))) &&
    (!Object.hasOwn(value, "retest") || retest(value.retest)) &&
    (!Object.hasOwn(value, "datasetExecution") ||
      (fields(value.datasetExecution, [
        "version",
        "batchId",
        "expansionHash",
        "datasetId",
        "datasetHash",
        "testCaseId",
        "sourceDisplayId",
        "rowIndex",
        "rowName",
        "values",
        "configurationHash",
        "rowCount",
      ]) &&
        value.datasetExecution.version === 1 &&
        string(value.datasetExecution.batchId, 72) &&
        /^dataset_[a-f0-9]{64}$/.test(value.datasetExecution.batchId) &&
        ["expansionHash", "datasetHash", "configurationHash"].every((key) =>
          hash((value.datasetExecution as RecordValue)[key]),
        ) &&
        ["datasetId", "testCaseId", "sourceDisplayId"].every((key) =>
          string((value.datasetExecution as RecordValue)[key], 200),
        ) &&
        integer(value.datasetExecution.rowIndex, 0, 49) &&
        integer(value.datasetExecution.rowCount, 1, 50) &&
        string(value.datasetExecution.rowName, 200, 1) &&
        dictionary(value.datasetExecution.values, (v) => string(v, 10000))))
  );
}
export function manualRunCurrentBrowserKey(input: ManualRunCurrentInput) {
  return JSON.stringify({
    projectId: input.projectId,
    testRunId: input.testRunId,
    originalOrganizationId: input.originalOrganizationId,
    expectedClerkActorId: input.expectedClerkActorId,
    ...(input.expectedNativeActorId === undefined
      ? {}
      : { expectedNativeActorId: input.expectedNativeActorId }),
    requestId: input.requestId,
  });
}
export function sameManualRunCurrentOrigin(
  a: ManualRunCurrentOrigin | null,
  b: ManualRunCurrentOrigin | null,
) {
  return (
    !!a &&
    !!b &&
    a.projectId === b.projectId &&
    a.testRunId === b.testRunId &&
    a.organizationId === b.organizationId &&
    a.clerkActorId === b.clerkActorId &&
    a.nativeActorId === b.nativeActorId
  );
}
export function admitManualRunCurrent(
  raw: unknown,
  input: ManualRunCurrentInput,
  origin: ManualRunCurrentOrigin | null,
) {
  try {
    inspectManualRunWire(raw);
    if (
      ![
        input.projectId,
        input.testRunId,
        input.originalOrganizationId,
        input.expectedClerkActorId,
      ].every(identity) ||
      !uuid(input.requestId) ||
      (input.expectedNativeActorId !== undefined &&
        !identity(input.expectedNativeActorId))
    )
      return null;
    if (
      !fields(raw, ["readContext", "view", "provenance"]) ||
      !fields(raw.readContext, [
        "requestId",
        "requestedKey",
        "projection",
        "scope",
      ]) ||
      !fields(raw.readContext.scope, [
        "projectId",
        "testRunId",
        "organizationId",
        "actorId",
        "actorClerkUserId",
      ])
    )
      return null;
    const echo = raw.readContext,
      scope = raw.readContext.scope;
    if (
      !Object.values(scope).every(identity) ||
      echo.projection !== "CURRENT_WHOLE_MANUAL_RUN_VIEW" ||
      echo.requestId !== input.requestId ||
      echo.requestedKey !== manualRunCurrentBrowserKey(input)
    )
      return null;
    const nativeOrigin = {
      projectId: scope.projectId as string,
      testRunId: scope.testRunId as string,
      organizationId: scope.organizationId as string,
      nativeActorId: scope.actorId as string,
      clerkActorId: scope.actorClerkUserId as string,
    };
    if (
      nativeOrigin.projectId !== input.projectId ||
      nativeOrigin.testRunId !== input.testRunId ||
      nativeOrigin.organizationId !== input.originalOrganizationId ||
      nativeOrigin.clerkActorId !== input.expectedClerkActorId ||
      (input.expectedNativeActorId !== undefined &&
        nativeOrigin.nativeActorId !== input.expectedNativeActorId) ||
      (origin && !sameManualRunCurrentOrigin(nativeOrigin, origin))
    )
      return null;
    const view = raw.view,
      provenance = raw.provenance;
    if (
      !fields(provenance, ["procedures", "observations", "history", "media"]) ||
      provenance.observations !==
        "CURRENT_SUPPORTED_API_VIEW_NOT_RAW_NATIVE_JSON" ||
      provenance.history !== "CURRENT_HEADS_NOT_COMPLETE_REVISION_HISTORY" ||
      provenance.media !== "IDENTIFIER_REFERENCES_NO_FILES_FETCHED" ||
      !fields(view, [
        "testRunId",
        "projectId",
        "organizationId",
        "originalOrganizationId",
        "actorId",
        "clerkActorId",
        "canWrite",
        "readRequestKey",
        "plannedCaseIds",
        "unavailableCases",
        "scopeAvailability",
        "status",
        "stepFieldLabels",
        "executionContext",
        "datasetBatchRuns",
        "cases",
      ])
    )
      return null;
    if (
      view.testRunId !== nativeOrigin.testRunId ||
      view.projectId !== nativeOrigin.projectId ||
      view.organizationId !== nativeOrigin.organizationId ||
      view.originalOrganizationId !== nativeOrigin.organizationId ||
      view.actorId !== nativeOrigin.nativeActorId ||
      view.clerkActorId !== nativeOrigin.clerkActorId ||
      typeof view.canWrite !== "boolean" ||
      view.readRequestKey !==
        JSON.stringify({
          testRunId: input.testRunId,
          projectId: input.projectId,
          originalOrganizationId: input.originalOrganizationId,
          expectedClerkActorId: input.expectedClerkActorId,
        })
    )
      return null;
    if (
      !uniqueIds(view.plannedCaseIds) ||
      !array(view.cases, 1000, caseView) ||
      !array(
        view.unavailableCases,
        1000,
        (v) =>
          fields(v, ["testCaseId", "reason"]) &&
          identity(v.testCaseId) &&
          v.reason === "MISSING_CASE_AND_FROZEN_DEFINITION",
      ) ||
      !fields(view.scopeAvailability, [
        "plannedCount",
        "availableCount",
        "unavailableCount",
        "complete",
        "procedureBasis",
      ]) ||
      !string(view.status) ||
      !dictionary(view.stepFieldLabels, (v) => string(v)) ||
      (view.executionContext !== null && !context(view.executionContext)) ||
      !array(
        view.datasetBatchRuns,
        50,
        (v) =>
          fields(v, ["testRunId", "rowIndex", "rowName", "status"]) &&
          identity(v.testRunId) &&
          integer(v.rowIndex) &&
          string(v.rowName) &&
          string(v.status),
      )
    )
      return null;
    const cases = view.cases as RecordValue[],
      planned = view.plannedCaseIds,
      unavailable = (view.unavailableCases as RecordValue[]).map(
        (v) => v.testCaseId as string,
      ),
      available = cases.map((v) => v.testCaseId as string),
      availability = view.scopeAvailability;
    if (
      new Set(available).size !== available.length ||
      new Set(unavailable).size !== unavailable.length ||
      available.some(
        (id) => !planned.includes(id) || unavailable.includes(id),
      ) ||
      unavailable.some((id) => !planned.includes(id)) ||
      available.length + unavailable.length !== planned.length ||
      JSON.stringify(planned.filter((id) => available.includes(id))) !==
        JSON.stringify(available) ||
      JSON.stringify(planned.filter((id) => unavailable.includes(id))) !==
        JSON.stringify(unavailable) ||
      availability.plannedCount !== planned.length ||
      availability.availableCount !== available.length ||
      availability.unavailableCount !== unavailable.length ||
      availability.complete !== (unavailable.length === 0) ||
      provenance.procedures !== availability.procedureBasis ||
      availability.procedureBasis !==
        (view.executionContext === null
          ? "LEGACY_CURRENT_CASE_DEFINITIONS"
          : "FROZEN_RUN_DEFINITIONS") ||
      cases.some((c) =>
        (c.prerequisiteIds as string[]).some(
          (id) => !planned.includes(id) || id === c.testCaseId,
        ),
      )
    )
      return null;
    if (view.executionContext !== null) {
      const frozen = (view.executionContext as RecordValue)
          .caseDefinitions as RecordValue[],
        frozenIds = frozen.map((c) => c.testCaseId as string);
      if (
        new Set(frozenIds).size !== frozenIds.length ||
        frozenIds.length !== planned.length ||
        frozenIds.some((id) => !planned.includes(id))
      )
        return null;
    }
    return immutable({
      data: raw as ManualRunCurrentWire,
      origin: nativeOrigin,
    });
  } catch {
    return null;
  }
}
