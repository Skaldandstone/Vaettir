import {
  manualCaseReviewedExactWriteSchema,
  manualCaseReviewedAckSchema,
  manualCaseReviewedWriteKey,
  manualCaseReviewedReadKey,
  type ManualCaseReviewedExactWrite,
  type ManualCaseReviewedWrite,
  type ManualCaseReviewedPreview,
  type ManualCaseReviewedRead,
  type ManualCaseReviewedAck,
} from "@vaettir/api/src/services/manualCaseResultSchema";
export type WholeCaseOrigin = {
  projectId: string;
  testRunId: string;
  testCaseId: string;
  organizationId: string;
  clerkActorId: string;
  nativeActorId: string;
  sessionId: string;
};
export function wholeCaseReadMatches(
  input: ManualCaseReviewedRead,
  value: { readContext?: unknown },
  projection: "ACCESS" | "PREVIEW" | "HISTORY",
) {
  const c = value.readContext as
    | {
        requestId?: unknown;
        projection?: unknown;
        requested?: unknown;
        scope?: {
          projectId?: unknown;
          organizationId?: unknown;
          clerkActorId?: unknown;
          actorId?: unknown;
        };
      }
    | undefined;
  return (
    !!c &&
    c.requestId === input.readRequestId &&
    c.projection === projection &&
    c.requested === manualCaseReviewedReadKey(input) &&
    c.scope?.projectId === input.projectId &&
    c.scope.organizationId === input.expectedScope.organizationId &&
    c.scope.clerkActorId === input.expectedScope.clerkActorId &&
    c.scope.actorId === input.expectedNativeActorId
  );
}
/** Conservative decimal roundtrip, not IEEE binary exactness or stored spelling.
 * Reject silent decimal rounding (e.g. 9007199254740993), retain caller's buffer. */
function decimalKey(raw: string) {
  const match =
    /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(
      raw.trim(),
    );
  if (!match) throw Error("Enter a complete finite decimal number.");
  let digits = ((match[2] ?? "") + (match[3] ?? match[4] ?? "")).replace(
    /^0+/,
    "",
  );
  const exponent = Number(match[5] ?? 0) - (match[3] ?? match[4] ?? "").length;
  if (
    !Number.isSafeInteger(exponent) ||
    Math.abs(exponent) > 400 ||
    digits.length > 400
  )
    throw Error(
      "This numeric spelling is outside the supported exact decimal review.",
    );
  let power = exponent;
  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    power++;
  }
  return digits ? `${match[1] === "-" ? "-" : ""}${digits}e${power}` : "0";
}
export function parseWholeCaseNumber(raw: string): number {
  if (!raw.trim())
    throw Error(
      "A blank measurement is not a zero or an absent limit. Enter a value or explicitly remove the limit.",
    );
  const key = decimalKey(raw),
    value = Number(raw.trim());
  if (!Number.isFinite(value) || decimalKey(String(value)) !== key)
    throw Error(
      "This decimal would be silently rounded. Keep the raw value and use a supported numeric representation.",
    );
  return value;
}
export type WholeCaseReading = {
  name: string;
  unit: string;
  value: string;
  lowerLimit: string | null;
  upperLimit: string | null;
  instrument: string | undefined;
};
export type WholeCaseDraft = {
  baseline: ManualCaseReviewedPreview;
  status: ManualCaseReviewedExactWrite["status"] | "";
  note: string | null;
  noteText: string;
  reason: string;
  context: Omit<ManualCaseReviewedExactWrite["observations"], "measurements">;
  readings: WholeCaseReading[];
  measurementsPresent: boolean;
};
export function wholeCaseDraft(
  preview: ManualCaseReviewedPreview,
): WholeCaseDraft {
  const observations = preview.current?.observations;
  const original =
    observations &&
    typeof observations === "object" &&
    !Array.isArray(observations)
      ? (observations as ManualCaseReviewedExactWrite["observations"])
      : {};
  const { measurements, ...context } = original;
  return {
    baseline: structuredClone(preview),
    status: preview.current?.status ?? "",
    note: preview.current?.note ?? null,
    noteText: preview.current?.note ?? "",
    reason: "",
    context: structuredClone(context),
    measurementsPresent: measurements !== undefined,
    readings: (measurements ?? []).map((m) => ({
      name: m.name,
      unit: m.unit,
      value: String(m.value),
      lowerLimit: m.lowerLimit === undefined ? null : String(m.lowerLimit),
      upperLimit: m.upperLimit === undefined ? null : String(m.upperLimit),
      instrument: m.instrument,
    })),
  };
}
export function wholeCaseRequest(
  draft: WholeCaseDraft,
  origin: WholeCaseOrigin,
  idempotencyKey: string,
): ManualCaseReviewedExactWrite {
  if (!draft.baseline.canWrite || !draft.status)
    throw Error(
      "Choose the observed status against a writable current frozen baseline.",
    );
  const measurements = draft.readings.map((m) => ({
    name: m.name,
    unit: m.unit,
    value: parseWholeCaseNumber(m.value),
    ...(m.lowerLimit === null
      ? {}
      : { lowerLimit: parseWholeCaseNumber(m.lowerLimit) }),
    ...(m.upperLimit === null
      ? {}
      : { upperLimit: parseWholeCaseNumber(m.upperLimit) }),
    ...(m.instrument === undefined ? {} : { instrument: m.instrument }),
  }));
  return manualCaseReviewedExactWriteSchema.parse({
    mode: "EXACT",
    projectId: origin.projectId,
    testRunId: origin.testRunId,
    testCaseId: origin.testCaseId,
    expectedScope: {
      projectId: origin.projectId,
      organizationId: origin.organizationId,
      clerkActorId: origin.clerkActorId,
    },
    expectedNativeActorId: origin.nativeActorId,
    expectedFrozenEvidenceHash: draft.baseline.frozenEvidenceHash,
    expectedRevisionId: draft.baseline.currentRevisionId,
    expectedCurrentFingerprint: draft.baseline.currentFingerprint,
    status: draft.status,
    note: draft.note,
    observations: {
      ...draft.context,
      ...(draft.measurementsPresent ? { measurements } : {}),
    },
    correctionReason: draft.reason.trim() ? draft.reason : null,
    idempotencyKey,
  });
}
export async function wholeCaseRequestHash(input: ManualCaseReviewedWrite) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(manualCaseReviewedWriteKey(input)),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function wholeCaseAck(
  input: ManualCaseReviewedWrite,
  baseline: ManualCaseReviewedPreview,
  value: unknown,
): Promise<ManualCaseReviewedAck | null> {
  const parsed = manualCaseReviewedAckSchema.safeParse(value);
  if (!parsed.success) return null;
  const ack = parsed.data,
    request = input.mode === "EXACT" ? input : input.request;
  if (
    ack.mode !== input.mode ||
    ack.scope.projectId !== request.projectId ||
    ack.scope.organizationId !== request.expectedScope.organizationId ||
    ack.scope.clerkActorId !== request.expectedScope.clerkActorId ||
    ack.scope.actorId !== input.expectedNativeActorId ||
    ack.testRunId !== request.testRunId ||
    ack.testCaseId !== request.testCaseId ||
    ack.idempotencyKey !== request.idempotencyKey ||
    ack.revisionNumber !== baseline.revisionNumber + 1 ||
    (baseline.current && ack.resultId !== baseline.current.resultId)
  )
    return null;
  return ack.requestHash === (await wholeCaseRequestHash(input)) ? ack : null;
}
