import { freezeStepReviewValue, type StepReviewBuffer, type StepReviewWire } from "./step-execution-review-draft";

/** Called only by an explicit operator action, never an effect or refresh.
 * New correction intent is separate from its historical correction reason. */
export function stepObservationBuffer(preview: StepReviewWire): StepReviewBuffer {
  if (!preview.supported || !preview.canRecord || !preview.procedureHash || !preview.currentFingerprint) throw Error("A fresh editable native step review is required.");
  const current = preview.current;
  const observations = current?.observations;
  return freezeStepReviewValue({
    status: current?.status ?? "",
    note: current ? current.note : null,
    context: observations ? { specimen: observations.specimen, hardwareRevision: observations.hardwareRevision, firmwareVersion: observations.firmwareVersion, environment: observations.environment } : { specimen: "", hardwareRevision: "", firmwareVersion: "", environment: "" },
    readings: (observations?.measurements ?? []).map(reading => ({ name: reading.name, unit: reading.unit, value: String(reading.value), lowerLimit: reading.lowerLimit === undefined ? "" : String(reading.lowerLimit), upperLimit: reading.upperLimit === undefined ? "" : String(reading.upperLimit), instrument: reading.instrument })),
    evidenceAttachmentIds: current?.evidenceAttachments.map(file => file.id) ?? [],
    correctionReason: null,
  });
}

/** Explicit selection only. Unknown/unavailable references stay selected until
 * the operator removes that exact ID; a search result never prunes the draft. */
export function stepObservationEvidence(buffer: StepReviewBuffer, id: string, selected: boolean): StepReviewBuffer {
  if (!id || id.length > 200 || id.includes("\0") || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(id)) throw Error("Unsupported evidence identity; existing selections are retained.");
  const present = buffer.evidenceAttachmentIds.includes(id);
  if (selected && !present && buffer.evidenceAttachmentIds.length >= 20) throw Error("At most 20 evidence references are supported. Existing selections are retained.");
  return { ...buffer, evidenceAttachmentIds: selected ? present ? [...buffer.evidenceAttachmentIds] : [...buffer.evidenceAttachmentIds, id] : buffer.evidenceAttachmentIds.filter(value => value !== id) };
}
