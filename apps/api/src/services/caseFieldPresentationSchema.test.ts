import { describe, expect, it } from "vitest";
import { caseFieldSchema, type CaseFieldDefinition } from "./caseFieldSchema.js";
import { caseFieldPresentationSchema, caseFieldPresentationWriteProblems, caseFieldPresentationJsonBytes, mergeCaseFieldPresentation, readCaseFieldPresentation, resolveCaseFieldPresentation, type CaseFieldPresentation } from "./caseFieldPresentationSchema.js";
const field = (type: CaseFieldDefinition["type"] = "TEXT", changes: Partial<CaseFieldDefinition> = {}): CaseFieldDefinition => ({ key: "field", label: "Original field", type, required: false, retired: false, options: type === "CHOICE" ? ["A, B", "Original whitespace "] : [], ...changes });
const configuration = (setting: CaseFieldPresentation["fields"][string] = { widget: "AUTO" }): CaseFieldPresentation => ({ version: 1, fields: { field: setting } });

describe("standalone presentation-only contract", () => {
  it("keeps absent settings absent, never inserts properties/defaults into native definitions or old request shapes", () => {
    const old = Object.freeze({ version: 1 as const, fields: Object.freeze([Object.freeze(field())]) });
    const before = JSON.stringify(old);
    expect(readCaseFieldPresentation({})).toEqual({ configuration: undefined, warning: null });
    const config = configuration();
    expect(caseFieldPresentationSchema.parse(config)).toEqual(config);
    expect(Object.keys(config.fields.field!)).toEqual(["widget"]);
    resolveCaseFieldPresentation({ key: "field", definition: old.fields[0], values: {} });
    expect(JSON.stringify(old)).toBe(before);
    expect(caseFieldSchema.parse(old)).toEqual(old);
  });
  it("only a genuinely absent optional key can hide and always has a reveal affordance", () => {
    const definition = field(), values = Object.freeze({}), setting = { widget: "PARAGRAPH", visibility: "HIDE_WHEN_EMPTY" };
    const hidden = resolveCaseFieldPresentation({ key: "field", definition, values, setting });
    expect(hidden).toMatchObject({ present: false, value: undefined, visible: false, canReveal: true, readOnly: false });
    for (const changes of [{ touched: true }, { revealed: true }, { definition: field("TEXT", { required: true }) }]) expect(resolveCaseFieldPresentation({ key: "field", definition, values, setting, ...changes })).toMatchObject({ visible: true, canReveal: false });
    expect(Object.hasOwn(values, "field")).toBe(false);
  });
  it("stored null, empty text, whitespace, false and zero are present and retained visibly without serialization/coercion", () => {
    for (const [definition, value] of [[field(), null], [field(), ""], [field(), "   "], [field("BOOLEAN"), false], [field("NUMBER"), 0]] as const) {
      const values = Object.freeze({ field: value }), before = JSON.stringify(values);
      const result = resolveCaseFieldPresentation({ key: "field", definition, values, setting: { widget: "AUTO", visibility: "HIDE_WHEN_EMPTY" } });
      expect(result).toMatchObject({ present: true, value, visible: true, canReveal: false, warning: null });
      expect(result.value).toBe(value); expect(JSON.stringify(values)).toBe(before);
    }
  });
  it("checkbox is presentation only: missing/null never initialize false and exact saved boolean is retained", () => {
    for (const values of [{}, { field: null }, { field: false }, { field: true }]) {
      const result = resolveCaseFieldPresentation({ key: "field", definition: field("BOOLEAN"), values, setting: { widget: "CHECKBOX" } });
      expect(result.widget).toBe("CHECKBOX"); expect(result.value).toBe(Object.hasOwn(values, "field") ? values.field : undefined);
      expect(Object.hasOwn(values, "field")).toBe(result.present);
    }
  });
  it("widget/type compatibility is explicit without inventing native types or weakening date/number controls", () => {
    const allowed = { TEXT: ["AUTO", "TEXT_INPUT", "PARAGRAPH"], CHOICE: ["AUTO", "DROPDOWN", "RADIO"], BOOLEAN: ["AUTO", "TRI_STATE", "CHECKBOX"], NUMBER: ["AUTO"], DATE: ["AUTO"] };
    for (const [type, widgets] of Object.entries(allowed)) for (const widget of ["AUTO", "TEXT_INPUT", "PARAGRAPH", "DROPDOWN", "RADIO", "TRI_STATE", "CHECKBOX"] as const) expect(caseFieldPresentationWriteProblems(configuration({ widget }), [field(type as CaseFieldDefinition["type"])]).length === 0).toBe(widgets.includes(widget));
    for (const type of ["TEXT", "NUMBER"] as const) expect(caseFieldPresentationWriteProblems(configuration({ widget: "AUTO", placeholder: "Literal useful guidance" }), [field(type)])).toEqual([]);
    for (const type of ["BOOLEAN", "CHOICE", "DATE"] as const) expect(caseFieldPresentationWriteProblems(configuration({ widget: "AUTO", placeholder: "Not supported" }), [field(type)])).not.toEqual([]);
  });
  it("incompatible or malformed read preferences use warned native fallback while new writes refuse", () => {
    const definition = field("CHOICE"), values = Object.freeze({ field: "A, B" });
    for (const setting of [{ widget: "PARAGRAPH" }, { widget: "URL" }, { widget: "DROPDOWN", default: "invented" }, { widget: "DROPDOWN", placeholder: "Ignored" }]) {
      const result = resolveCaseFieldPresentation({ key: "field", definition, values, setting });
      expect(result).toMatchObject({ widget: "DROPDOWN", visible: true, value: "A, B" }); expect(result.warning).toBeTruthy();
      expect(caseFieldPresentationWriteProblems({ version: 1, fields: { field: setting } }, [definition])).not.toEqual([]);
    }
  });
  it("retired and unknown values remain native read-only, exact referenced objects are not normalized or dropped", () => {
    const raw = Object.freeze({ unsupported: ["keep", "all"] }), values = Object.freeze({ field: raw });
    for (const definition of [undefined, field("TEXT", { retired: true })]) {
      const result = resolveCaseFieldPresentation({ key: "field", definition, values, setting: { widget: "TEXT_INPUT", visibility: "HIDE_WHEN_EMPTY" } });
      expect(result).toMatchObject({ visible: true, readOnly: true, present: true }); expect(result.value).toBe(raw); expect(result.warning).toBeTruthy();
      expect(caseFieldPresentationWriteProblems(configuration({ widget: "TEXT_INPUT" }), definition ? [definition] : [])).not.toEqual([]);
    }
  });
  it("malformed native values retain literal data and do not gain editable presentation from a compatible widget", () => {
    for (const value of ["false", [], { nested: "raw" }, undefined]) {
      const values = { field: value };
      const result = resolveCaseFieldPresentation({ key: "field", definition: field("BOOLEAN"), values, setting: { widget: "CHECKBOX", visibility: "HIDE_WHEN_EMPTY" } });
      expect(result).toMatchObject({ present: true, visible: true, readOnly: true, widget: "TRI_STATE" }); expect(result.value).toBe(value); expect(result.warning).toBeTruthy();
    }
  });
  it("already stored retired/unknown presentation stays read-only and exact, not newly introduced/changed/deleted", () => {
    const prior = configuration({ widget: "TEXT_INPUT", placeholder: "Retained hint" });
    for (const definitions of [[], [field("TEXT", { retired: true })]]) {
      expect(caseFieldPresentationWriteProblems(structuredClone(prior), definitions, prior)).toEqual([]);
      expect(caseFieldPresentationWriteProblems(configuration({ widget: "PARAGRAPH" }), definitions, prior)).not.toEqual([]);
      expect(caseFieldPresentationWriteProblems({ version: 1, fields: {} }, definitions, prior)).not.toEqual([]);
    }
  });
  it("unknown siblings, native definitions and raw configuration are retained by reference, including null-prototype data", () => {
    const nested = Object.assign(Object.create(null), { keep: ["original", false, 0, null] });
    const profile = Object.freeze(Object.assign(Object.create(null), { futureSibling: nested, casePresentation: { oldBuiltIn: "unchanged" } }));
    const definitions = Object.freeze([Object.freeze(field())]), config = Object.freeze(configuration({ widget: "TEXT_INPUT", placeholder: " Exact spacing " }));
    const merged = mergeCaseFieldPresentation(profile, config, definitions);
    expect(Object.getPrototypeOf(merged)).toBeNull(); expect(merged.futureSibling).toBe(nested); expect(merged.casePresentation).toBe(profile.casePresentation); expect(merged.caseFieldPresentation).toBe(config);
    expect(readCaseFieldPresentation(merged).configuration).toBe(config); expect(Object.hasOwn(profile, "caseFieldPresentation")).toBe(false);
    expect(Object.hasOwn(config.fields.field!, "visibility")).toBe(false);
  });
  it("unsupported saved sibling never turns into fabricated empty settings on read or merge", () => {
    const profile = { original: { raw: true }, caseFieldPresentation: { version: 7, fields: {} } };
    const before = JSON.stringify(profile);
    expect(readCaseFieldPresentation(profile)).toMatchObject({ configuration: undefined, warning: expect.any(String) });
    expect(() => mergeCaseFieldPresentation(profile, configuration(), [field()])).toThrow("unsupported"); expect(JSON.stringify(profile)).toBe(before);
    for (const invalid of [null, [], "legacy"]) expect(() => mergeCaseFieldPresentation(invalid, configuration(), [field()])).toThrow("fabricated empty profile");
  });
  it("20 bounded keys are supported; 21, unsafe keys, extra/default properties and implicit undefined refuse", () => {
    const fields = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`field_${index}`, { widget: "AUTO" }]));
    expect(caseFieldPresentationSchema.safeParse({ version: 1, fields }).success).toBe(true);
    expect(caseFieldPresentationSchema.safeParse({ version: 1, fields: { ...fields, overflow: { widget: "AUTO" } } }).success).toBe(false);
    for (const key of ["constructor", "__proto__", "Uppercase"]) expect(caseFieldPresentationSchema.safeParse({ version: 1, fields: { [key]: { widget: "AUTO" } } }).success).toBe(false);
    expect(caseFieldPresentationWriteProblems(configuration({ widget: "AUTO", placeholder: undefined }), [field()])).not.toEqual([]);
    expect(caseFieldPresentationSchema.safeParse({ ...configuration(), defaults: {} }).success).toBe(false);
  });
  it("sibling32KiB and merged256KiB boundaries refuse before returning partially normalized profiles", () => {
    const valid = configuration(), sibling = { ...configuration(), extra: "x".repeat(32768) };
    expect(() => mergeCaseFieldPresentation({}, sibling, [field()])).toThrow("32 KiB");
    const base = { future: "x".repeat(262100) }; expect(caseFieldPresentationJsonBytes(base)).toBeLessThanOrEqual(262144);
    expect(() => mergeCaseFieldPresentation(base, valid, [field()])).toThrow("Merged project context exceeds 256 KiB");
    expect(Object.hasOwn(base, "caseFieldPresentation")).toBe(false);
    expect(() => mergeCaseFieldPresentation({ future: "x".repeat(262144) }, valid, [field()])).toThrow("Existing project context exceeds 256 KiB");
    expect(caseFieldPresentationJsonBytes({ a: null, b: false, c: 0 })).toBe(31);
    expect(caseFieldPresentationJsonBytes(1e308)).toBe(309); expect(caseFieldPresentationJsonBytes(1e-7)).toBe(9);
  });
  it("original sibling accessors/toJSON/symbol/non-enumerable hooks refuse without execution or omission", () => {
    let calls = 0;
    const getter = Object.defineProperty({}, "future", { enumerable: true, get() { calls++; return "raw"; } });
    const hooks = { future: { toJSON() { calls++; return "serialized"; } } };
    const hidden = Object.defineProperty({}, "future", { enumerable: false, value: "retained" });
    const symbols = { [Symbol("future")]: "retained" };
    const siblingGetter = Object.defineProperty({}, "caseFieldPresentation", { enumerable: true, get() { calls++; return configuration(); } });
    for (const profile of [getter, hooks, hidden, symbols, siblingGetter]) { expect(() => mergeCaseFieldPresentation(profile, configuration(), [field()])).toThrow(); expect(readCaseFieldPresentation(profile).warning).toBeTruthy(); }
    expect(calls).toBe(0);
  });
  it("arrays refuse symbols/non-enumerable extras/sparse slots/custom hooks and cycles without losing data", () => {
    let calls = 0;
    const symbols = ["raw"]; Object.defineProperty(symbols, Symbol("extra"), { value: "retained" });
    const hidden = ["raw"]; Object.defineProperty(hidden, "future", { value: "retained", enumerable: false });
    const indexedHidden = ["raw"]; Object.defineProperty(indexedHidden, "0", { value: "raw", enumerable: false });
    const hooks = ["raw"]; Object.defineProperty(hooks, "toJSON", { value() { calls++; return []; }, enumerable: false });
    const sparse = new Array(1), cyclic: unknown[] = []; cyclic.push(cyclic);
    for (const value of [symbols, hidden, indexedHidden, hooks, sparse, cyclic]) expect(() => mergeCaseFieldPresentation({ future: value }, configuration(), [field()])).toThrow();
    expect(calls).toBe(0); expect(symbols[0]).toBe("raw");
  });
  it("read fallback does not invoke malformed setting or value accessors", () => {
    let calls = 0;
    const setting = Object.defineProperty({}, "widget", { enumerable: true, get() { calls++; return "CHECKBOX"; } });
    const values = Object.defineProperty({}, "field", { enumerable: true, get() { calls++; return false; } });
    expect(resolveCaseFieldPresentation({ key: "field", definition: field("BOOLEAN"), setting, values })).toMatchObject({ present: true, readOnly: true, visible: true, widget: "TRI_STATE", warning: expect.any(String) });
    expect(calls).toBe(0);
  });
});
