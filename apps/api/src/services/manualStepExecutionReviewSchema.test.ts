import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { recordStepResultInputSchema } from "./manualStepExecution.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
import { reviewedStepLegacyHash, reviewedStepRequestHash } from "./manualStepExecutionReview.js";
import { reviewedStepPreviewInputSchema, reviewedStepWriteInputSchema } from "./manualStepExecutionReviewSchema.js";
export const syntheticReviewedStepInput = () => ({ projectId: "p", testRunId: "r", testCaseId: "c", stepIndex: 0, originalOrganizationId: "o", expectedClerkActorId: "cl", expectedNativeActorId: "n", expectedProcedureHash: "a".repeat(64), expectedCurrentFingerprint: "b".repeat(64), expectedRevisionId: null, status: "PASS" as const, note: "  exact\n text  ", observations: { specimen: " sample ", hardwareRevision: "", firmwareVersion: "", environment: " retained ", measurements: [{ name: " Voltage ", unit: " V ", value: 0, instrument: " CAL-1 ", lowerLimit: 0, upperLimit: 2 }] }, evidenceAttachmentIds: [] as string[], correctionReason: null, idempotencyKey: randomUUID(), confirmed: true as const });
describe("reviewed step lossless schema and legacy hash contracts, pure only", () => {
  it("retains the parsed wire envelope before hashing reordered measurement fields", () => {
    const input = syntheticReviewedStepInput();
    const measurement = input.observations.measurements[0]!;
    // The UX/native fixture used this order, while browser and router parsing
    // produce the declared schema order. Do not change accepted receipt hashes.
    input.observations.measurements = [{ name: measurement.name, value: measurement.value, unit: measurement.unit, lowerLimit: measurement.lowerLimit, upperLimit: measurement.upperLimit, instrument: measurement.instrument }];
    const original = structuredClone(input);
    const retained = reviewedStepWriteInputSchema.parse(input);
    expect(retained).toEqual(original);
    expect(input).toEqual(original);
    expect(Object.keys(retained.observations.measurements[0]!)).toEqual(["name", "unit", "value", "lowerLimit", "upperLimit", "instrument"]);
    expect(reviewedStepRequestHash(retained)).toBe(reviewedStepRequestHash(reviewedStepWriteInputSchema.parse(retained)));
    expect(reviewedStepRequestHash(input)).not.toBe(reviewedStepRequestHash(retained));
    expect(retained.observations.measurements[0]!.value).toBe(0);
    expect(retained.note).toBe("  exact\n text  ");
  });
  it("preserves exact prose, null, empty text and zero without defaults", () => { const input=syntheticReviewedStepInput(); expect(reviewedStepWriteInputSchema.parse(input)).toEqual(input); for (const note of [null,""," \n "]) expect(reviewedStepWriteInputSchema.parse({...input,note}).note).toBe(note); });
  it("requires complete native identity, explicit confirmation and all three read pins", () => { const input=syntheticReviewedStepInput(); expect(reviewedStepWriteInputSchema.safeParse({...input,expectedNativeActorId:undefined}).success).toBe(false); expect(reviewedStepWriteInputSchema.safeParse({...input,confirmed:false}).success).toBe(false); expect(reviewedStepPreviewInputSchema.safeParse({projectId:"p",testRunId:"r",testCaseId:"c",stepIndex:0,readRequestId:randomUUID(),originalOrganizationId:"o"}).success).toBe(false); });
  it.each(["observations","measurement"])("unknown %s fields refuse instead of silently dropping evidence",kind=>{const input=syntheticReviewedStepInput(); if(kind==="observations")Object.assign(input.observations,{unknown:"retained"});else Object.assign(input.observations.measurements[0]!,{unknown:"retained"});expect(reviewedStepWriteInputSchema.safeParse(input).success).toBe(false);});
  it.each([Number.POSITIVE_INFINITY,Number.NaN,9007199254740992])("refuses unsupported number %s",value=>{const input=syntheticReviewedStepInput();input.observations.measurements[0]!.value=value;expect(reviewedStepWriteInputSchema.safeParse(input).success).toBe(false);});
  it("refuses duplicate files and invalid Unicode without clipping",()=>{const input=syntheticReviewedStepInput();expect(reviewedStepWriteInputSchema.safeParse({...input,evidenceAttachmentIds:["x","x"]}).success).toBe(false);expect(reviewedStepWriteInputSchema.safeParse({...input,note:"\uD800"}).success).toBe(false);expect(reviewedStepWriteInputSchema.safeParse({...input,note:"\0"}).success).toBe(false);});
  it("old normalized receipt hash is byte-identical while reviewed hash binds null/prose/scope",()=>{const input=syntheticReviewedStepInput(),old=recordStepResultInputSchema.parse({testRunId:input.testRunId,testCaseId:input.testCaseId,stepIndex:0,status:input.status,note:input.note,observations:input.observations,evidenceAttachmentIds:input.evidenceAttachmentIds,expectedRevisionId:null,idempotencyKey:input.idempotencyKey});expect(reviewedStepLegacyHash(input)).toBe(qualityProfileHash({testCaseId:old.testCaseId,stepIndex:old.stepIndex,status:old.status,note:old.note?.trim()||null,observations:old.observations,evidenceAttachmentIds:[...old.evidenceAttachmentIds].sort(),expectedRevisionId:old.expectedRevisionId,correctionReason:old.correctionReason?.trim()||null})); expect(reviewedStepRequestHash(input)).not.toBe(reviewedStepRequestHash({...input,note:input.note.trim()}));expect(reviewedStepRequestHash({...input,note:null})).not.toBe(reviewedStepRequestHash({...input,note:""}));expect(reviewedStepRequestHash(input)).not.toBe(reviewedStepRequestHash({...input,expectedNativeActorId:"other"}));});
});
