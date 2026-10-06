import type {
  ManualRunStartReviewedStartInput,
  ManualRunStartReviewedAck,
} from "../../api/src/services/manualRunStartReviewedWriteSchema";
import {
  admitRunStartRead,
  inspectRunStartReadWire,
  runStartReadIdentity,
  sameRunStartReadOrigin,
  type RunStartReadSnapshot,
  type RunStartReadOrigin,
  type RunStartReadInput,
} from "./manual-run-start-reviewed-reader";
import type { ReviewedRunConfiguration } from "./run-configuration-request";

export type ReviewedRunStartEnvelope = ManualRunStartReviewedStartInput;
export type ReviewedRunStartTransport = (
  envelope: ReviewedRunStartEnvelope,
) => Promise<unknown>;
export type OwnedReviewedRunStart = Readonly<{
  request: ReviewedRunConfiguration;
  envelope: ReviewedRunStartEnvelope;
  origin: RunStartReadOrigin;
  observedSessionId: string;
  submittedReadRequestId: string;
}>;
export type ReviewedRunStartAck = ManualRunStartReviewedAck;
const fields = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  required.every((k) => Object.hasOwn(value, k)) &&
  Object.keys(value).every((k) => required.includes(k) || optional.includes(k));
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const keys = [
  "configuration",
  "platform",
  "build",
  "hardwareRevision",
  "firmwareVersion",
  "rig",
  "batchOrLot",
  "environment",
  "calibrationReference",
  "protocolReference",
] as const;
function copy<T>(v: T): T {
  if (!v || typeof v !== "object") return v;
  return Object.freeze(
    Array.isArray(v)
      ? v.map(copy)
      : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])),
  ) as T;
}
function metadata(
  value: RunStartReadSnapshot | null,
): value is RunStartReadSnapshot {
  try {
    inspectRunStartReadWire(value);
    if (
      !value ||
      !Object.isFrozen(value) ||
      !Object.isFrozen(value.origin) ||
      !Object.isFrozen(value.data) ||
      !fields(value, [
        "origin",
        "observedSessionId",
        "projection",
        "epoch",
        "revision",
        "receivedAt",
        "data",
      ]) ||
      !fields(value.origin, [
        "projectId",
        "organizationId",
        "clerkActorId",
        "nativeActorId",
      ]) ||
      !Object.values(value.origin).every(runStartReadIdentity) ||
      !runStartReadIdentity(value.observedSessionId) ||
      !Number.isSafeInteger(value.epoch) ||
      value.epoch < 0 ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      typeof value.receivedAt !== "string" ||
      new Date(value.receivedAt).toISOString() !== value.receivedAt ||
      !["ACCESS", "PREVIEW"].includes(value.projection)
    )
      return false;
    const tuple: unknown = JSON.parse(value.data.readContext.requestedKey);
    if (
      !Array.isArray(tuple) ||
      tuple.length !== 6 ||
      tuple[0] !== value.projection ||
      tuple[1] !== value.origin.projectId ||
      tuple[2] !== value.origin.organizationId ||
      tuple[3] !== value.origin.clerkActorId ||
      (tuple[4] !== null && tuple[4] !== value.origin.nativeActorId) ||
      !uuid(tuple[5])
    )
      return false;
    const input: RunStartReadInput = {
      projectId: value.origin.projectId,
      originalOrganizationId: value.origin.organizationId,
      expectedClerkActorId: value.origin.clerkActorId,
      ...(tuple[4] === null
        ? {}
        : { expectedNativeActorId: value.origin.nativeActorId }),
      requestId: tuple[5],
    };
    const admitted = admitRunStartRead(
      value.data,
      input,
      value.projection,
      value.origin.clerkActorId,
      value.origin,
    );
    return (
      !!admitted &&
      admitted.data.canRecover &&
      admitted.data.canConfigure &&
      JSON.stringify(admitted.data) === JSON.stringify(value.data)
    );
  } catch {
    return false;
  }
}
/** New UNSENT intent only. Never use a new native ACCESS read to stamp an old
 * pending legacy body. This owns metadata, not cohort/procedure approval. */
export function freezeReviewedRunStart(
  request: ReviewedRunConfiguration,
  current: RunStartReadSnapshot | null,
): OwnedReviewedRunStart {
  inspectRunStartReadWire(request);
  if (
    !metadata(current) ||
    current.projection !== "PREVIEW" ||
    !("profile" in current.data) ||
    current.data.profile.kind !== "SUPPORTED" ||
    current.data.canStart !== true ||
    !hash(current.data.profile.profileHash) ||
    !fields(request, [
      "projectId",
      "testCaseIds",
      "expectedProfileHash",
      "executionContext",
      "idempotencyKey",
      "originalOrganizationId",
      "expectedClerkActorId",
    ]) ||
    request.projectId !== current.origin.projectId ||
    request.originalOrganizationId !== current.origin.organizationId ||
    request.expectedClerkActorId !== current.origin.clerkActorId ||
    request.expectedProfileHash !== current.data.profile.profileHash ||
    !uuid(request.idempotencyKey) ||
    !Array.isArray(request.testCaseIds) ||
    !request.testCaseIds.length ||
    request.testCaseIds.length > 1000 ||
    new Set(request.testCaseIds).size !== request.testCaseIds.length ||
    !request.testCaseIds.every(runStartReadIdentity) ||
    !fields(request.executionContext, keys) ||
    !keys.every(
      (k) =>
        typeof request.executionContext[k] === "string" &&
        request.executionContext[k].trim().length <=
          (k === "configuration" || k === "environment" ? 2000 : 300),
    )
  )
    throw Error(
      "A new start requires exact current original native profile metadata and separately reviewed selected cases/configuration. No request was submitted.",
    );
  const retained = copy(request);
  const envelope: ReviewedRunStartEnvelope = Object.freeze({
    mode: "START",
    projectId: current.origin.projectId,
    originalOrganizationId: current.origin.organizationId,
    expectedClerkActorId: current.origin.clerkActorId,
    expectedNativeActorId: current.origin.nativeActorId,
    request: retained,
  });
  inspectRunStartReadWire(envelope);
  return Object.freeze({
    request: retained,
    envelope,
    origin: current.origin,
    observedSessionId: current.observedSessionId,
    submittedReadRequestId: current.data.readContext.requestId,
  });
}
/** Receipt retry/open requires original current FULL access, not a supported
 * current profile. This never infers that a receipt was accepted. */
export function reviewedRunStartAccessMatches(
  owned: OwnedReviewedRunStart,
  current: RunStartReadSnapshot | null,
) {
  return (
    metadata(current) &&
    sameRunStartReadOrigin(owned.origin, current.origin) &&
    owned.observedSessionId === current.observedSessionId
  );
}
export async function expectedReviewedRunId(owned: OwnedReviewedRunStart) {
  try {
    const bytes = new TextEncoder().encode(
      JSON.stringify([
        owned.envelope.projectId,
        owned.envelope.expectedNativeActorId,
        owned.envelope.request.idempotencyKey,
      ]),
    );
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return `manual_${Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    throw Error(
      "The exact run acknowledgement could not be verified. Keep the original request/key; acceptance remains unknown.",
    );
  }
}
/** Validate complete bounded outer ACK before privately consuming ownership.
 * Current display authority is checked separately after this asynchronous hash. */
export async function verifyReviewedRunStartAck(
  owned: OwnedReviewedRunStart,
  value: unknown,
): Promise<ReviewedRunStartAck> {
  try {
    const checked = inspectRunStartReadWire(value, 8192);
    if (
      checked.nodes > 128 ||
      !fields(value, [
        "mode",
        "currentScope",
        "idempotencyKey",
        "legacyAck",
        "historicalOuterProvenance",
        "interpretation",
      ]) ||
      value.mode !== "START" ||
      value.idempotencyKey !== owned.request.idempotencyKey ||
      value.historicalOuterProvenance !== "UNRECORDED" ||
      value.interpretation !== "LEGACY_NORMALIZED_NOT_RAW_LOSSLESS" ||
      !fields(value.currentScope, [
        "projectId",
        "organizationId",
        "actorId",
        "actorClerkUserId",
      ]) ||
      value.currentScope.projectId !== owned.origin.projectId ||
      value.currentScope.organizationId !== owned.origin.organizationId ||
      value.currentScope.actorId !== owned.origin.nativeActorId ||
      value.currentScope.actorClerkUserId !== owned.origin.clerkActorId ||
      !fields(value.legacyAck, [
        "testRunId",
        "originalOrganizationId",
        "expectedClerkActorId",
        "idempotencyKey",
      ]) ||
      value.legacyAck.originalOrganizationId !==
        owned.request.originalOrganizationId ||
      value.legacyAck.expectedClerkActorId !==
        owned.request.expectedClerkActorId ||
      value.legacyAck.idempotencyKey !== owned.request.idempotencyKey ||
      typeof value.legacyAck.testRunId !== "string" ||
      !/^manual_[a-f0-9]{64}$/.test(value.legacyAck.testRunId)
    )
      throw Error();
    const frozen = copy(value) as ReviewedRunStartAck;
    if (frozen.legacyAck.testRunId !== (await expectedReviewedRunId(owned)))
      throw Error();
    return frozen;
  } catch {
    throw Error(
      "The acknowledgement did not confirm the exact original native run request. The same body/key remains retained; acceptance is unknown.",
    );
  }
}
/** Browser SDK inspection only, not native authorization. No getters escape. */
export function safeRunStartSDKRead() {
  try {
    const resource =
      typeof window === "undefined" ? null : (window.Clerk ?? null);
    if (!resource || resource.loaded !== true || !resource.session)
      return { resource, session: null };
    const session = resource.session,
      sessionId = session.id,
      userId = session.user.id;
    return {
      resource,
      session:
        runStartReadIdentity(sessionId) && runStartReadIdentity(userId)
          ? Object.freeze({ sessionId, userId })
          : null,
    };
  } catch {
    return { resource: null, session: null };
  }
}
