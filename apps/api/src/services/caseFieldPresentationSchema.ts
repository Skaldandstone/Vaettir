import { z } from "zod";
import { caseFieldKey, type CaseFieldDefinition } from "./caseFieldSchema.js";

export const CASE_FIELD_PRESENTATION_WIDGETS = ["AUTO", "TEXT_INPUT", "PARAGRAPH", "DROPDOWN", "RADIO", "TRI_STATE", "CHECKBOX"] as const;
export const caseFieldPresentationSettingSchema = z.object({
  widget: z.enum(CASE_FIELD_PRESENTATION_WIDGETS),
  placeholder: z.string().max(200).optional(),
  visibility: z.enum(["SHOW", "HIDE_WHEN_EMPTY"]).optional(),
}).strict();
export const caseFieldPresentationSchema = z.object({
  version: z.literal(1),
  fields: z.record(caseFieldKey, caseFieldPresentationSettingSchema).refine(fields => Object.keys(fields).length <= 20, "At most 20 existing field presentation mappings are supported."),
}).strict();
export type CaseFieldPresentation = z.infer<typeof caseFieldPresentationSchema>;
export type CaseFieldPresentationSetting = z.infer<typeof caseFieldPresentationSettingSchema>;
type NativeWidget = Exclude<CaseFieldPresentationSetting["widget"], "AUTO"> | "NUMBER" | "DATE" | "NATIVE";
const allowedWidgets: Record<CaseFieldDefinition["type"], readonly string[]> = {
  TEXT: ["AUTO", "TEXT_INPUT", "PARAGRAPH"], CHOICE: ["AUTO", "DROPDOWN", "RADIO"], BOOLEAN: ["AUTO", "TRI_STATE", "CHECKBOX"], NUMBER: ["AUTO"], DATE: ["AUTO"],
};
function nativeWidget(field: CaseFieldDefinition | undefined): NativeWidget {
  return field?.type === "TEXT" ? "PARAGRAPH" : field?.type === "CHOICE" ? "DROPDOWN" : field?.type === "BOOLEAN" ? "TRI_STATE" : field?.type === "NUMBER" ? "NUMBER" : field?.type === "DATE" ? "DATE" : "NATIVE";
}
function settingProblem(field: CaseFieldDefinition, setting: CaseFieldPresentationSetting): string | null {
  if (!allowedWidgets[field.type]?.includes(setting.widget)) return "The widget is incompatible with the saved native field type.";
  if (Object.hasOwn(setting, "placeholder") && !["TEXT", "NUMBER"].includes(field.type)) return "Placeholders are supported only by native text and number controls.";
  return null;
}
function sameSetting(left: unknown, right: unknown) {
  const a = caseFieldPresentationSettingSchema.safeParse(left), b = caseFieldPresentationSettingSchema.safeParse(right);
  if (!a.success || !b.success) return false;
  return ["widget", "placeholder", "visibility"].every(key => Object.hasOwn(a.data, key) === Object.hasOwn(b.data, key) && a.data[key as keyof typeof a.data] === b.data[key as keyof typeof b.data]);
}

/** Write acceptance is separate from conservative read rendering. Unknown or
 * retired mappings can only retain an already saved exact setting, not become
 * editable, newly introduced or silently removed. No parser defaults exist. */
export function caseFieldPresentationWriteProblems(configuration: unknown, definitions: readonly CaseFieldDefinition[], prior?: CaseFieldPresentation): string[] {
  try { if (caseFieldPresentationJsonBytes(configuration) > 32768) return ["Presentation sibling exceeds 32 KiB; nothing was saved or truncated."]; }
  catch (error) { return [error instanceof Error ? error.message : "Presentation JSON is unsupported."]; }
  const parsed = caseFieldPresentationSchema.safeParse(configuration);
  if (!parsed.success) return ["Presentation settings are unsupported; nothing was normalized or replaced."];
  const problems: string[] = [];
  for (const [key, setting] of Object.entries(parsed.data.fields)) {
    const field = definitions.find(field => field.key === key);
    if (!field || field.retired) {
      if (!prior || !Object.hasOwn(prior.fields, key) || !sameSetting(prior.fields[key], setting)) problems.push(`Retained/unknown field ${key} cannot receive a new presentation setting.`);
    } else {
      const problem = settingProblem(field, setting); if (problem) problems.push(`${field.label}: ${problem}`);
    }
  }
  for (const key of Object.keys(prior?.fields ?? {})) if (!definitions.some(field => field.key === key && !field.retired) && !Object.hasOwn(parsed.data.fields, key)) problems.push(`Retained/unknown field ${key} presentation cannot be removed implicitly.`);
  return problems;
}

function compatibleNativeValue(field: CaseFieldDefinition, value: unknown): boolean {
  if (value === null) return true;
  if (field.type === "TEXT") return typeof value === "string" && value.length <= 2000;
  if (field.type === "NUMBER") return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e12;
  if (field.type === "BOOLEAN") return typeof value === "boolean";
  if (field.type === "CHOICE") return typeof value === "string" && field.options.includes(value);
  return typeof value === "string" && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
/** Missing-key-only hiding. In particular null/empty/whitespace/false/zero are
 * PRESENT. Return the exact value/reference, never a checkbox default or an API
 * payload. Native fallback does not rewrite unsupported saved metadata. */
export function resolveCaseFieldPresentation(args: { key: string; definition?: CaseFieldDefinition; setting?: unknown; values: Readonly<Record<string, unknown>>; touched?: boolean; revealed?: boolean }) {
  const { key, definition, values, touched = false, revealed = false } = args;
  const descriptor = Object.getOwnPropertyDescriptor(values, key);
  const present = descriptor !== undefined, value = descriptor && "value" in descriptor ? descriptor.value : undefined;
  const fallback = nativeWidget(definition);
  let warning: string | null = null;
  let readOnly = false;
  let setting: CaseFieldPresentationSetting | undefined;
  if (!definition || definition.key !== key || !allowedWidgets[definition.type]) { warning = "Unknown field metadata is retained read-only using native display."; readOnly = true; }
  else if (definition.retired) { warning = "Retired field metadata remains read-only; presentation cannot restore editing."; readOnly = true; }
  else if (present && !compatibleNativeValue(definition, value)) { warning = "Saved metadata is incompatible with its native field type. Its exact value is retained read-only, not normalized."; readOnly = true; }
  if (args.setting !== undefined) {
    let safe = true;
    try { caseFieldPresentationJsonBytes(args.setting); } catch { safe = false; }
    const parsed = safe ? caseFieldPresentationSettingSchema.safeParse(args.setting) : null;
    const problem = parsed?.success && definition ? settingProblem(definition, parsed.data) : "Saved presentation is unsupported.";
    if (!parsed?.success || problem) warning ??= `${problem ?? "Saved presentation is unsupported."} Native controls remain available without resetting saved preferences.`;
    else if (!readOnly) setting = parsed.data;
  }
  const hiddenAbsent = !present && !definition?.required && !touched && !revealed && !warning && setting?.visibility === "HIDE_WHEN_EMPTY";
  return { present, value, visible: !hiddenAbsent, canReveal: hiddenAbsent, readOnly, warning, widget: setting && setting.widget !== "AUTO" ? setting.widget as NativeWidget : fallback, ...(setting && Object.hasOwn(setting, "placeholder") ? { placeholder: setting.placeholder } : {}) };
}

/** Absence stays absent. Malformed siblings are reported, never reset to a
 * fabricated persisted configuration or coerced into new setting types. */
export function readCaseFieldPresentation(profile: unknown): { configuration: CaseFieldPresentation | undefined; warning: string | null } {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return { configuration: undefined, warning: "Project presentation context is unsupported and remains unchanged." };
  try { if (caseFieldPresentationJsonBytes(profile) > 262144) return { configuration: undefined, warning: "Project presentation context exceeds 256 KiB and remains unchanged." }; }
  catch { return { configuration: undefined, warning: "Project presentation context contains unsupported JSON structure and remains unchanged." }; }
  if (!Object.hasOwn(profile, "caseFieldPresentation")) return { configuration: undefined, warning: null };
  const raw = (profile as Record<string, unknown>).caseFieldPresentation, parsed = caseFieldPresentationSchema.safeParse(raw);
  return parsed.success ? { configuration: raw as CaseFieldPresentation, warning: null } : { configuration: undefined, warning: "Saved custom-field presentation is unsupported. Use native controls; the sibling was not reset." };
}

const utf8 = (text: string) => new TextEncoder().encode(text).length;
/** Conservative browser-pure JSONB-text admission estimate. No full object is
 * serialized and toJSON/accessor hooks are never invoked. The later native
 * service must still measure actual PostgreSQL octet_length before writing. */
export function caseFieldPresentationJsonBytes(value: unknown): number {
  let nodes = 0;
  const ancestors = new Set<object>();
  function visit(entry: unknown, depth: number): number {
    if (++nodes > 100000 || depth > 64) throw new Error("Presentation context exceeds the bounded JSON structure.");
    if (entry === null) return 4;
    if (typeof entry === "string") {
      for (const character of entry) { const code = character.codePointAt(0)!; if (code >= 0xd800 && code <= 0xdfff) throw new Error("Presentation JSON contains unsupported Unicode."); }
      return utf8(JSON.stringify(entry));
    }
    if (typeof entry === "boolean") return entry ? 4 : 5;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) throw new Error("Presentation JSON needs finite numbers.");
      const text = JSON.stringify(entry);
      if (!/[eE]/.test(text)) return text.length;
      // Account conservatively for expanded finite decimal exponent notation,
      // rather than treating compact 1e308 as five native JSONB text bytes.
      const match = text.match(/^(-?)(\d)(?:\.(\d+))?[eE]([+-]?\d+)$/);
      if (!match) throw new Error("Presentation numeric notation is unsupported.");
      const digits = 1 + (match[3]?.length ?? 0), position = 1 + Number(match[4]);
      return match[1]!.length + (position <= 0 ? 2 - position + digits : position >= digits ? position : digits + 1);
    }
    if (typeof entry !== "object" || !entry) throw new Error("Presentation JSON cannot implicitly omit or serialize unsupported values.");
    if (ancestors.has(entry)) throw new Error("Presentation JSON cannot contain cycles.");
    if (!Array.isArray(entry) && ![Object.prototype, null].includes(Object.getPrototypeOf(entry))) throw new Error("Presentation JSON cannot serialize custom object hooks.");
    const descriptors = Object.getOwnPropertyDescriptors(entry);
    if (Object.values(descriptors).some(descriptor => descriptor.get || descriptor.set)) throw new Error("Presentation JSON cannot invoke accessors.");
    ancestors.add(entry);
    try {
      if (Array.isArray(entry)) {
        if (Object.getPrototypeOf(entry) !== Array.prototype || Reflect.ownKeys(entry).length !== Object.keys(descriptors).length || Object.keys(descriptors).some(key => key !== "length" && (!/^(0|[1-9]\d*)$/.test(key) || !descriptors[key]!.enumerable)) || entry.length !== Object.keys(descriptors).length - 1) throw new Error("Presentation arrays cannot drop extra properties or missing entries.");
        return 2 + Math.max(0, entry.length - 1) * 2 + entry.reduce((sum, item) => sum + visit(item, depth + 1), 0);
      }
      const keys = Object.keys(descriptors);
      if (Reflect.ownKeys(entry).length !== keys.length || keys.some(key => !descriptors[key]!.enumerable)) throw new Error("Presentation JSON cannot silently omit own properties.");
      return 2 + Math.max(0, keys.length - 1) * 2 + keys.reduce((sum, key) => sum + visit(key, depth + 1) + 2 + visit(descriptors[key]!.value, depth + 1), 0);
    } finally { ancestors.delete(entry); }
  }
  return visit(value, 0);
}
export function mergeCaseFieldPresentation(profile: unknown, configuration: unknown, definitions: readonly CaseFieldDefinition[]) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("Existing project context cannot be replaced with a fabricated empty profile.");
  // Check BEFORE any property read/spread. Do not invoke a sibling getter or
  // omit symbols/non-enumerable source properties while preserving raw context.
  if (caseFieldPresentationJsonBytes(profile) > 262144) throw new Error("Existing project context exceeds 256 KiB and remains unchanged.");
  if (caseFieldPresentationJsonBytes(configuration) > 32768) throw new Error("Presentation sibling exceeds 32 KiB; nothing was saved or truncated.");
  const previous = readCaseFieldPresentation(profile);
  if (previous.warning) throw new Error(previous.warning);
  const problems = caseFieldPresentationWriteProblems(configuration, definitions, previous.configuration);
  if (problems.length) throw new Error(problems.join(" "));
  const descriptors = Object.getOwnPropertyDescriptors(profile);
  descriptors.caseFieldPresentation = { value: configuration as CaseFieldPresentation, enumerable: true, writable: true, configurable: true };
  const merged = Object.create(Object.getPrototypeOf(profile), descriptors) as Record<string, unknown> & { caseFieldPresentation: CaseFieldPresentation };
  if (caseFieldPresentationJsonBytes(merged) > 262144) throw new Error("Merged project context exceeds 256 KiB; every existing sibling remains unchanged.");
  return merged;
}
