import { reviewedStepAckSchema, reviewedStepWirePreviewSchema, reviewedStepWriteInputSchema, reviewedStepWriteKey,
  type ReviewedStepWriteInput, type ReviewedStepAck, type ReviewedStepWirePreview } from "@vaettir/api/src/services/manualStepExecutionReviewSchema";

/** Real tRPC JSON wire data has strings, not server-side Date instances. */
export const stepReviewWireSchema = reviewedStepWirePreviewSchema;
export type StepReviewWire = ReviewedStepWirePreview;
export type StepReviewOrigin = Readonly<{ projectId: string; testRunId: string; testCaseId: string; stepIndex: number; organizationId: string; clerkActorId: string; nativeActorId: string }>;
export type StepReviewReadingBuffer = { name: string; value: string; unit: string; lowerLimit: string; upperLimit: string; instrument: string };
export type StepReviewBuffer = { status: ReviewedStepWriteInput["status"] | ""; note: string | null; context: Omit<ReviewedStepWriteInput["observations"], "measurements">; readings: StepReviewReadingBuffer[]; evidenceAttachmentIds: string[]; correctionReason: string | null };
export type StepReviewDraft = Readonly<{ identity: string; origin: StepReviewOrigin; reviewedSessionId: string; buffer: Readonly<StepReviewBuffer>; procedureHash: string; currentFingerprint: string; expectedRevisionId: string | null; frozenDefinition: unknown; rawCurrent: unknown }>;
export type StepReviewPending = Readonly<{ input: Readonly<ReviewedStepWriteInput>; requestHash: string; draft: StepReviewDraft; everAmbiguous: boolean }>;

export function stepReviewJsonBytes(value: unknown, maxBytes = 2621440) {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]; let nodes = 0, bytes = 0;
  while (stack.length) {
    const next = stack.pop()!; if (++nodes > 100000 || next.depth > 64) throw Error("Unsupported complete step review structure.");
    if (typeof next.value === "string") bytes += new TextEncoder().encode(next.value).length + 2;
    else if (typeof next.value === "number") { if (!Number.isFinite(next.value) || Number.isInteger(next.value) && !Number.isSafeInteger(next.value)) throw Error("Unsupported stored number precision."); bytes += 32; }
    else if (next.value === null || typeof next.value === "boolean") bytes += 5;
    else if (Array.isArray(next.value)) { if (next.value.length > 1000) throw Error("Unsupported complete review collection."); bytes += next.value.length + 2; for (const child of next.value) stack.push({ value: child, depth: next.depth + 1 }); }
    else if (next.value && typeof next.value === "object" && Object.getPrototypeOf(next.value) === Object.prototype) { for (const [key, child] of Object.entries(next.value)) { bytes += new TextEncoder().encode(key).length + 4; stack.push({ value: child, depth: next.depth + 1 }); } }
    else throw Error("Unsupported JSON wire value; no date or value was defaulted.");
    if (bytes > maxBytes) throw Error("Complete step review exceeds its bounded wire view.");
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > maxBytes) throw Error("Complete step review exceeds its bounded wire view.");
  return bytes;
}
export function decodeStepReviewWire(value: unknown): StepReviewWire {
  stepReviewJsonBytes(value); const parsed = stepReviewWireSchema.safeParse(value);
  if (!parsed.success) throw Error("The complete current step review response is unsupported. No fields were normalized or defaulted.");
  const wire = parsed.data;
  if (!wire.supported && (wire.frozenDefinition !== null || wire.current !== null || wire.rawCurrent !== null || wire.procedureHash !== null || wire.currentFingerprint !== null) || wire.canRecord && (!wire.supported || !wire.canRecover)) throw Error("The step response does not consistently distinguish current authority from supported body data.");
  if (wire.supported) {
    const definition = wire.frozenDefinition;
    if (!definition || typeof definition !== "object" || Array.isArray(definition) || !Object.hasOwn(definition, "testCaseId") || (definition as { testCaseId: unknown }).testCaseId !== wire.testCaseId || !Object.hasOwn(definition, "steps")) throw Error("The supported frozen procedure does not match this exact step request.");
    const steps = (definition as { steps: unknown }).steps;
    if (!Array.isArray(steps) || steps.length < 1 || steps.length > 500 || wire.stepIndex >= steps.length || steps.some((step, index) => !step || typeof step !== "object" || step.order !== index || typeof step.action !== "string" || !step.action)) throw Error("The supported procedure does not provide complete stored step coordinates.");
    if (!wire.procedureHash || !wire.currentFingerprint || (wire.current === null) !== (wire.rawCurrent === null)) throw Error("The supported step baseline is incomplete.");
    if (wire.current) { const raw = wire.rawCurrent; if (!raw || typeof raw !== "object" || Array.isArray(raw) || (raw as { id?: unknown }).id !== wire.current.id || (raw as { recordedAt?: unknown }).recordedAt !== wire.current.recordedAt) throw Error("The displayed current revision does not match its retained native wire metadata."); }
  }
  // Unknown fields are permitted only inside explicitly raw JSON projections.
  // The strict DTO parser preserves exact scalar content and time string.
  return freezeStepReviewValue(parsed.data);
}
export function sameStepReviewReader(scope: StepReviewWire["scope"] | undefined, origin: StepReviewOrigin) {
  return !!scope && scope.projectId === origin.projectId && scope.organizationId === origin.organizationId && scope.actorId === origin.nativeActorId && scope.actorClerkUserId === origin.clerkActorId;
}
export function freezeStepReviewValue<T>(value: T): Readonly<T> {
  stepReviewJsonBytes(value); const cloned = structuredClone(value);
  const stack: unknown[] = [cloned]; while (stack.length) { const item = stack.pop(); if (item !== null && typeof item === "object") { for (const child of Object.values(item)) stack.push(child); Object.freeze(item); } }
  return cloned;
}
function decimalIdentity(text: string) {
  const value = text.trim(); if (value.length > 200) throw Error("Measured values exceed the supported decimal input.");
  const parsed = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!parsed) throw Error("Enter decimal measured values, not hexadecimal or non-finite expressions.");
  const fractional = parsed[3] ?? parsed[4] ?? "", exponent = Number(parsed[5] ?? 0) - fractional.length;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10000) throw Error("Unsupported decimal exponent.");
  let digits = ((parsed[2] ?? "0") + fractional).replace(/^0+/, ""); if (!digits) return "0:0";
  const trailing = /0+$/.exec(digits)?.[0].length ?? 0; if (trailing) digits = digits.slice(0, -trailing);
  return `${parsed[1] === "-" ? "-" : ""}${digits}:${exponent + trailing}`;
}
export function parseStepReviewDecimal(raw: string) {
  const identity = decimalIdentity(raw), value = Number(raw.trim());
  if (!Number.isFinite(value) || Object.is(value, -0) || Number.isInteger(value) && !Number.isSafeInteger(value) || decimalIdentity(String(value)) !== identity) throw Error("This measured decimal cannot be preserved exactly by the supported numeric result. The entered text is retained.");
  return value;
}
export function stepReviewMeasurements(readings: readonly StepReviewReadingBuffer[], status: ReviewedStepWriteInput["status"]) {
  if (readings.length > 100) throw Error("At most 100 measured readings are supported.");
  return readings.map(reading => { if (Object.keys(reading).some(key => !["name", "value", "unit", "lowerLimit", "upperLimit", "instrument"].includes(key))) throw Error("Unsupported retained measurement fields cannot be silently dropped."); const value = parseStepReviewDecimal(reading.value), lowerLimit = reading.lowerLimit.trim() ? parseStepReviewDecimal(reading.lowerLimit) : undefined, upperLimit = reading.upperLimit.trim() ? parseStepReviewDecimal(reading.upperLimit) : undefined;
    if (!reading.name.trim() || !reading.unit.trim()) throw Error("Each reading needs an explicit name and unit.");
    if (lowerLimit !== undefined && upperLimit !== undefined && lowerLimit > upperLimit) throw Error("Lower limit exceeds upper limit.");
    if (status === "PASS" && (lowerLimit !== undefined && value < lowerLimit || upperLimit !== undefined && value > upperLimit)) throw Error("An out-of-range reading cannot be recorded as Pass.");
    return { name: reading.name, unit: reading.unit, value, instrument: reading.instrument, ...(lowerLimit === undefined ? {} : { lowerLimit }), ...(upperLimit === undefined ? {} : { upperLimit }) }; });
}
export function makeStepReviewDraft(origin: StepReviewOrigin, preview: StepReviewWire, sessionId: string, buffer: StepReviewBuffer, identity: string): StepReviewDraft {
  if (!sessionId || !preview.supported || !preview.canRecord || !preview.procedureHash || !preview.currentFingerprint || !sameStepReviewReader(preview.scope, origin) || preview.testRunId !== origin.testRunId || preview.testCaseId !== origin.testCaseId || preview.stepIndex !== origin.stepIndex) throw Error("A fresh supported original-reader step snapshot is required.");
  return freezeStepReviewValue({ identity, origin, reviewedSessionId: sessionId, buffer, procedureHash: preview.procedureHash, currentFingerprint: preview.currentFingerprint, expectedRevisionId: preview.current?.id ?? null, frozenDefinition: preview.frozenDefinition, rawCurrent: preview.rawCurrent });
}
export function stepReviewInputParts(draft: StepReviewDraft) {
  const { origin, buffer } = draft; if (!buffer.status) throw Error("Choose the observed outcome explicitly.");
  if (Object.keys(buffer).some(key => !["status", "note", "context", "readings", "evidenceAttachmentIds", "correctionReason"].includes(key))) throw Error("Unsupported retained input fields cannot be silently dropped.");
  if (draft.expectedRevisionId && !buffer.correctionReason?.trim()) throw Error("Explain why the existing observation needs correction.");
  const parsed = reviewedStepWriteInputSchema.omit({ idempotencyKey: true }).parse({ projectId: origin.projectId, testRunId: origin.testRunId, testCaseId: origin.testCaseId, stepIndex: origin.stepIndex, originalOrganizationId: origin.organizationId, expectedClerkActorId: origin.clerkActorId, expectedNativeActorId: origin.nativeActorId,
    expectedProcedureHash: draft.procedureHash, expectedCurrentFingerprint: draft.currentFingerprint, expectedRevisionId: draft.expectedRevisionId, status: buffer.status, note: buffer.note,
    observations: { ...buffer.context, measurements: stepReviewMeasurements(buffer.readings, buffer.status) }, evidenceAttachmentIds: [...buffer.evidenceAttachmentIds], correctionReason: buffer.correctionReason, confirmed: true });
  return freezeStepReviewValue(parsed);
}
export function freezeStepReviewInput(draft: StepReviewDraft, idempotencyKey: string): Readonly<ReviewedStepWriteInput> { return freezeStepReviewValue(reviewedStepWriteInputSchema.parse({ ...stepReviewInputParts(draft), idempotencyKey })); }
export async function stepReviewRequestHash(input: Readonly<ReviewedStepWriteInput>) { const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(reviewedStepWriteKey(input))); return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join(""); }
export function assertStepReviewAck(value: unknown, pending: StepReviewPending): ReviewedStepAck {
  const parsed = reviewedStepAckSchema.safeParse(value); if (!parsed.success) throw Error("The step acknowledgement is unsupported. Keep the exact request for recovery.");
  const ack = parsed.data, input = pending.input;
  if (ack.projectId !== input.projectId || ack.testRunId !== input.testRunId || ack.testCaseId !== input.testCaseId || ack.stepIndex !== input.stepIndex || ack.idempotencyKey !== input.idempotencyKey || ack.requestHash !== pending.requestHash || !sameStepReviewReader(ack.scope, pending.draft.origin) || ack.revisionId === input.expectedRevisionId) throw Error("The acknowledgement does not match the exact original step, native author and reviewed request.");
  return freezeStepReviewValue(ack);
}
