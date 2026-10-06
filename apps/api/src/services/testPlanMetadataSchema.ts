import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { caseFieldPresentationJsonBytes } from "./caseFieldPresentationSchema.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";

export const MAX_PLAN_FIELD_SCHEMA_BYTES = 32768;
export const MAX_PLAN_METADATA_PATCH_BYTES = 65536;
const reserved = new Set(["__proto__", "constructor", "prototype"]);
const supportedKey = (key: string) =>
  key.length > 0 &&
  key.length <= 200 &&
  Buffer.byteLength(key, "utf8") <= 800 &&
  !reserved.has(key) &&
  !key.includes("\0") &&
  Array.from(key).every((character) => {
    const point = character.codePointAt(0)!;
    return point < 0xd800 || point > 0xdfff;
  });
export const planMetadataChange = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("SET"),
      key: z
        .string()
        .refine(supportedKey, "Select a supported declared field key."),
      value: z.union([
        z.string().max(40000),
        z.number().finite(),
        z.boolean(),
        z.array(z.string().max(10000)).max(500),
      ]),
    })
    .strict(),
  z
    .object({
      operation: z.literal("REMOVE"),
      key: z
        .string()
        .refine(supportedKey, "Select a supported declared field key."),
    })
    .strict(),
]);
export const planMetadataChanges = z
  .unknown()
  .superRefine((raw, ctx) => {
    try {
      if (caseFieldPresentationJsonBytes(raw) > MAX_PLAN_METADATA_PATCH_BYTES)
        ctx.addIssue({
          code: "custom",
          message:
            "Reviewed metadata edits exceed 64 KiB; nothing was truncated.",
        });
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Reviewed metadata edits contain unsupported JSON structure.",
      });
    }
  })
  .pipe(
    z
      .array(planMetadataChange)
      .min(1)
      .max(50)
      .refine(
        (changes) =>
          new Set(changes.map((change) => change.key)).size === changes.length,
        "Review each changed key once.",
      ),
  );
export type PlanMetadataChange = z.infer<typeof planMetadataChange>;
type FieldKind = "string" | "number" | "boolean" | "string-array";
const record = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keysOnly = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
export function supportedPlanMetadataDefinition(schema: unknown): {
  supported: boolean;
  fields: Map<string, FieldKind>;
} {
  try {
    if (caseFieldPresentationJsonBytes(schema) > MAX_PLAN_FIELD_SCHEMA_BYTES)
      return { supported: false, fields: new Map() };
  } catch {
    return { supported: false, fields: new Map() };
  }
  const supported =
    record(schema) &&
    (schema.type === "object" || schema.type === undefined) &&
    keysOnly(schema, ["type", "properties", "title", "description"]) &&
    (schema.properties === undefined || record(schema.properties));
  if (!supported) return { supported: false, fields: new Map() };
  const properties = record(schema.properties) ? schema.properties : {};
  if (Object.keys(properties).length > 200)
    return { supported: false, fields: new Map() };
  const fields = new Map<string, FieldKind>();
  for (const key of Object.keys(properties)) {
    const prop = properties[key];
    if (
      !supportedKey(key) ||
      !record(prop) ||
      !keysOnly(prop, ["type", "items", "title", "description"]) ||
      (prop.title !== undefined && typeof prop.title !== "string") ||
      (prop.description !== undefined && typeof prop.description !== "string")
    )
      continue;
    if (
      prop.type === "array" &&
      record(prop.items) &&
      prop.items.type === "string" &&
      keysOnly(prop.items, ["type"])
    )
      fields.set(key, "string-array");
    else if (
      ["string", "number", "boolean"].includes(String(prop.type)) &&
      prop.items === undefined
    )
      fields.set(key, prop.type as FieldKind);
  }
  return { supported: true, fields };
}
const matches = (kind: FieldKind, value: unknown) =>
  kind === "string"
    ? typeof value === "string"
    : kind === "number"
      ? typeof value === "number" && Number.isFinite(value)
      : kind === "boolean"
        ? typeof value === "boolean"
        : Array.isArray(value) &&
          value.every((item) => typeof item === "string");
export function planMetadataSchemaHash(
  testPlanTypeId: string,
  fieldSchema: unknown,
) {
  return qualityProfileHash({ testPlanTypeId, fieldSchema });
}
export function editablePlanMetadata(schema: unknown, values: unknown) {
  const definition = supportedPlanMetadataDefinition(schema);
  return (
    definition.supported &&
    record(values) &&
    [...definition.fields].some(
      ([key, kind]) =>
        !Object.hasOwn(values, key) || matches(kind, values[key]),
    )
  );
}
export function applyReviewedPlanMetadata(
  schema: unknown,
  values: unknown,
  raw: unknown,
): Record<string, unknown> {
  const changes = planMetadataChanges.parse(raw),
    definition = supportedPlanMetadataDefinition(schema);
  try {
    caseFieldPresentationJsonBytes(values);
  } catch {
    throw unsupported();
  }
  if (!definition.supported || !record(values)) throw unsupported();
  const descriptors = Object.getOwnPropertyDescriptors(values);
  for (const change of changes) {
    const kind = definition.fields.get(change.key),
      present = Object.hasOwn(values, change.key);
    if (!kind || (present && !matches(kind, values[change.key])))
      throw unsupported();
    if (change.operation === "REMOVE") {
      if (!present)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "A reviewed removal names an unset field. Nothing was changed.",
        });
      delete descriptors[change.key];
    } else {
      if (!matches(kind, change.value)) throw unsupported();
      Object.defineProperty(descriptors, change.key, {
        value: {
          value: change.value,
          writable: true,
          configurable: true,
          enumerable: true,
        },
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }
  const after = Object.create(
    Object.getPrototypeOf(values),
    descriptors,
  ) as Record<string, unknown>;
  if (qualityProfileHash(after) === qualityProfileHash(values))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "The reviewed metadata edits contain no native change. Nothing was written or versioned.",
    });
  return after;
  function unsupported() {
    return new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Metadata edits must use supported declared types and compatible current values. Unknown, reserved, incompatible, null or non-object native values were retained unchanged.",
    });
  }
}
