import { describe, expect, it } from "vitest";
import { emptyPlanMetadataDraft, governedPlanFields, leavePlanMetadataUnchanged, planMetadataListRendererChanges, projectedPlanMetadataValues, removePlanMetadataValue, replacePlanMetadataChange, reviewedPlanMetadataChanges, reviewedPlanStatus, setPlanMetadataNumber } from "./plan-change-draft";
const schema = { type: "object", properties: { notes: { type: "string" }, n: { type: "number" }, enabled: { type: "boolean" }, areas: { type: "array", items: { type: "string" } }, missing: { type: "string" }, legacyNull: { type: "string" } } };
const native = { notes: " exact\ntext, ", n: 12, enabled: false, areas: ["", "same", "same", " a,b ", "line\nnext"], legacyNull: null, unknown: { preserve: [0, false, null] } };
describe("governed plan-change draft helpers, pure source proof", () => {
  it("emits only exact supported selected operations, never raw metadata/defaults", () => {
    let draft = emptyPlanMetadataDraft();
    for (const change of [{ operation: "SET" as const, key: "notes", value: "" }, { operation: "SET" as const, key: "n", value: 0 }, { operation: "SET" as const, key: "missing", value: "" }, { operation: "SET" as const, key: "areas", value: ["", "same", "same", " a,b ", "line\nnext", ""] }]) draft = replacePlanMetadataChange(draft, change);
    const changes = reviewedPlanMetadataChanges(schema, native, draft); expect(changes).toEqual(draft.changes);
    expect(JSON.stringify(changes)).not.toContain("unknown"); expect(JSON.stringify(changes)).not.toContain("legacyNull"); expect(native.n).toBe(12);
    expect(projectedPlanMetadataValues(native, draft).unknown).toBe(native.unknown);
  });
  it("preserves missing vs exact empty/false/zero/list and skips only true no-op SETs", () => {
    const values = { notes: "", n: 0, enabled: false, areas: [] };
    let draft = emptyPlanMetadataDraft(); for (const [key, value] of Object.entries(values)) draft = replacePlanMetadataChange(draft, { operation: "SET", key, value });
    expect(reviewedPlanMetadataChanges(schema, values, draft)).toEqual([]);
    expect(reviewedPlanMetadataChanges(schema, {}, draft)).toEqual(draft.changes);
    const removed = removePlanMetadataValue(draft, "areas"); expect(reviewedPlanMetadataChanges(schema, values, removed)).toEqual([{ operation: "REMOVE", key: "areas" }]);
  });
  it("invalid number text synchronously blocks all saves despite a prior finite value or another changed field", () => {
    for (const text of ["", " ", "-", "NaN", "Infinity", "1e309", "0x10", "1_000"]) {
      let draft = replacePlanMetadataChange(emptyPlanMetadataDraft(), { operation: "SET", key: "notes", value: "Other change" });
      draft = setPlanMetadataNumber(draft, "n", "2.00"); draft = setPlanMetadataNumber(draft, "n", text);
      expect(draft.numberBuffers.n).toBe(text); expect(draft.changes.find(change => change.key === "n")).toEqual({ operation: "SET", key: "n", value: 2 });
      expect(() => reviewedPlanMetadataChanges(schema, native, draft)).toThrow(/finite number/);
      expect(reviewedPlanMetadataChanges(schema, native, leavePlanMetadataUnchanged(draft, "n"))).toEqual([{ operation: "SET", key: "notes", value: "Other change" }]);
    }
  });
  it("keeps lexical finite-number buffers without putting them on the wire or adding arbitrary range caps", () => {
    const draft = setPlanMetadataNumber(emptyPlanMetadataDraft(), "n", "2.00");
    expect(draft.numberBuffers.n).toBe("2.00"); expect(reviewedPlanMetadataChanges(schema, native, draft)).toEqual([{ operation: "SET", key: "n", value: 2 }]);
    expect(reviewedPlanMetadataChanges(schema, native, setPlanMetadataNumber(draft, "n", "1e308"))).toEqual([{ operation: "SET", key: "n", value: 1e308 }]);
    expect(reviewedPlanMetadataChanges(schema, native, removePlanMetadataValue(setPlanMetadataNumber(draft, "n", "-"), "n"))).toEqual([{ operation: "REMOVE", key: "n" }]);
  });
  it("nonobject roots, NULL/mismatched/unknown/reserved fields remain readonly, no replacement or inferred schema", () => {
    for (const root of [null, ["native"], false, 0, "retained"]) expect(() => reviewedPlanMetadataChanges(schema, root, emptyPlanMetadataDraft())).toThrow(/root/);
    for (const key of ["legacyNull", "unknown", "unmapped", "constructor", "__proto__"]) expect(() => reviewedPlanMetadataChanges(schema, native, replacePlanMetadataChange(emptyPlanMetadataDraft(), { operation: "SET", key, value: "replacement" }))).toThrow(/unsupported|undeclared/);
    expect(() => reviewedPlanMetadataChanges(schema, native, removePlanMetadataValue(emptyPlanMetadataDraft(), "legacyNull"))).toThrow(/unsupported/);
    expect(() => reviewedPlanMetadataChanges(schema, native, removePlanMetadataValue(emptyPlanMetadataDraft(), "missing"))).toThrow(/no saved value/);
  });
  it("ordinary own reserved keys and unknown siblings survive projection without prototype changes", () => {
    const values = JSON.parse('{"notes":"old","__proto__":{"preserve":true},"constructor":[null,false,0]}');
    const result = projectedPlanMetadataValues(values, replacePlanMetadataChange(emptyPlanMetadataDraft(), { operation: "SET", key: "notes", value: "new" }));
    expect(Object.hasOwn(result, "__proto__")).toBe(true); expect(result.__proto__).toBe(values.__proto__); expect(result.constructor).toBe(values.constructor);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype); expect(({} as { preserve?: boolean }).preserve).toBeUndefined();
    expect(governedPlanFields({ properties: JSON.parse('{"__proto__":{"type":"string"},"constructor":{"type":"string"}}') }, values).every(field => field.kind === "retained")).toBe(true);
  });
  it("unsupported schema extensions do not become text editors or silently drop unknown values", () => {
    for (const unsupported of [{ required: ["notes"], ...schema }, { properties: { notes: { type: "string", enum: ["old"] } } }, { properties: { notes: { type: "date" } } }]) expect(() => reviewedPlanMetadataChanges(unsupported, native, replacePlanMetadataChange(emptyPlanMetadataDraft(), { operation: "SET", key: "notes", value: "changed" }))).toThrow(/unsupported/);
  });
  it("keeps exact list order/duplicates/empty rows and refuses whole oversize patches, not subsets", () => {
    const exact = ["", "same", "same", " a,b ", "line\nnext"];
    expect(reviewedPlanMetadataChanges(schema, {}, replacePlanMetadataChange(emptyPlanMetadataDraft(), { operation: "SET", key: "areas", value: exact }))[0]).toEqual({ operation: "SET", key: "areas", value: exact });
    for (const value of [Array(501).fill(""), ["x".repeat(10001)], Array(500).fill("x".repeat(10000))]) expect(() => reviewedPlanMetadataChanges(schema, {}, replacePlanMetadataChange(emptyPlanMetadataDraft(), { operation: "SET", key: "areas", value }))).toThrow(/size|64 KiB/);
    const many = { properties: Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`k${index}`, { type: "string" }])) };
    expect(() => reviewedPlanMetadataChanges(many, {}, { changes: Array.from({ length: 51 }, (_, index) => ({ operation: "SET", key: `k${index}`, value: "" })), numberBuffers: {} })).toThrow(/50/);
  });
  it("specialized QA list echo diffs only declared list operations, preserving all other exact native values", () => {
    const draft = emptyPlanMetadataDraft(), next = { ...native, areas: ["same", "", "same", "suggested\nrow"] };
    const result = planMetadataListRendererChanges(schema, native, draft, next);
    expect(reviewedPlanMetadataChanges(schema, native, result)).toEqual([{ operation: "SET", key: "areas", value: next.areas }]);
    expect(() => planMetadataListRendererChanges(schema, native, draft, { areas: next.areas })).toThrow(/retained|undeclared|non-list/);
    expect(() => planMetadataListRendererChanges(schema, native, draft, { ...native, n: 3 })).toThrow(/non-list/);
    expect(() => reviewedPlanMetadataChanges(schema, native, { ...result, rendererError: "Refused specialized edit" })).toThrow(/Refused/);
    expect(planMetadataListRendererChanges(schema, native, { ...result, rendererError: "Refused" }, next).rendererError).toBeUndefined();
  });
  it("approved/archived status requires deliberate REOPEN to Draft, ordinary transitions never infer acceptance", () => {
    for (const before of ["APPROVED", "ARCHIVED"] as const) {
      expect(() => reviewedPlanStatus(before, "DRAFT", "CHANGE")).toThrow(/explicit Reopen/);
      expect(reviewedPlanStatus(before, "DRAFT", "REOPEN")).toEqual({ expectedStatus: before, status: "DRAFT", intent: "REOPEN" });
      expect(() => reviewedPlanStatus(before, "ACTIVE", "REOPEN")).toThrow();
    }
    expect(reviewedPlanStatus("DRAFT", "ACTIVE", "CHANGE")).toEqual({ expectedStatus: "DRAFT", status: "ACTIVE", intent: "CHANGE" });
    expect(() => reviewedPlanStatus("DRAFT", "DRAFT", "CHANGE")).toThrow(/different/); expect(() => reviewedPlanStatus("ACTIVE", "DRAFT", "REOPEN")).toThrow(/explicit/);
  });
});
