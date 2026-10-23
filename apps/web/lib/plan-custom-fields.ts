/** Supported editing is deliberately narrower than arbitrary JSON Schema.
 * Unsupported schemas/values are retained, never replaced by an empty editor. */
export type PlanCustomField = { key: string; label: string; description: string | null; present: boolean; value: unknown; kind: "string" | "number" | "boolean" | "string-array" | "retained"; reason: string | null };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const allowed = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
export function planCustomFields(schema: unknown, values: Record<string, unknown>): PlanCustomField[] {
  const rootSupported = record(schema) && (schema.type === "object" || schema.type === undefined) && allowed(schema, ["type", "properties", "title", "description"]) && (schema.properties === undefined || record(schema.properties));
  const properties = rootSupported && record(schema.properties) ? schema.properties : {};
  return [...new Set([...Object.keys(properties), ...Object.keys(values)])].map(key => {
    const prop = properties[key], present = Object.hasOwn(values, key), value = values[key];
    const label = record(prop) && typeof prop.title === "string" ? prop.title : key;
    const description = record(prop) && typeof prop.description === "string" ? prop.description : null;
    const base = { key, label, description, present, value };
    const retained = (reason: string): PlanCustomField => ({ ...base, kind: "retained", reason });
    if (!rootSupported) return retained("The plan schema is unsupported. This native value is retained read-only.");
    if (!Object.hasOwn(properties, key)) return retained("No matching field is declared in this plan schema. The native value is retained read-only.");
    if (!record(prop) || !allowed(prop, ["type", "items", "title", "description"]) || (prop.title !== undefined && typeof prop.title !== "string") || (prop.description !== undefined && typeof prop.description !== "string")) return retained("This field schema is unsupported. The native value is retained read-only.");
    let kind: PlanCustomField["kind"];
    if (prop.type === "array" && record(prop.items) && prop.items.type === "string" && allowed(prop.items, ["type"])) kind = "string-array";
    else if (["string", "number", "boolean"].includes(String(prop.type)) && prop.items === undefined) kind = prop.type as "string" | "number" | "boolean";
    else return retained("This field type or item schema is unsupported. The native value is retained read-only.");
    const matches = !present || (kind === "string" ? typeof value === "string" : kind === "number" ? typeof value === "number" && Number.isFinite(value) : kind === "boolean" ? typeof value === "boolean" : Array.isArray(value) && value.every(item => typeof item === "string"));
    return matches ? { ...base, kind, reason: null } : retained("The stored native value does not match this field schema. It is retained read-only, not converted.");
  });
}
export function replacePlanField(values: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> { return { ...values, [key]: value }; }
export function removePlanField(values: Record<string, unknown>, key: string): Record<string, unknown> { const result = { ...values }; delete result[key]; return result; }
export function replacePlanStringRow(values: string[], index: number, value: string): string[] {
  if (!Number.isInteger(index) || index < 0 || index >= values.length) throw Error("Choose an existing exact row.");
  return values.map((entry, row) => row === index ? value : entry);
}
export function removePlanStringRow(values: string[], index: number): string[] {
  if (!Number.isInteger(index) || index < 0 || index >= values.length) throw Error("Choose an existing exact row.");
  return values.filter((_, row) => row !== index);
}
export function finitePlanNumber(text: string): number | null {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
  const value = Number(text); return Number.isFinite(value) ? value : null;
}
export function describeRetainedPlanValue(value: unknown, present: boolean): string {
  if (!present) return "Not set (no native value).";
  if (value === undefined) return "undefined (retained native value)";
  if (typeof value === "number" && !Number.isFinite(value)) return `${String(value)} (not a finite JSON number)`;
  try { return JSON.stringify(value, null, 2) ?? String(value); } catch { return "Native value cannot be displayed as JSON; it remains retained unchanged."; }
}
