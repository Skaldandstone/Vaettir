import { z } from "zod";

/** Literal-value codecs only. They neither authorize a save nor reinterpret a
 * v1 template/run/UUID. Native JSONB admission and writer integration are separate. */
export const PLAN_EXECUTION_TEMPLATE_EXACT_BOUNDS = Object.freeze({
  templateBytes: 1024 * 1024,
  cases: 500,
  configurations: 20,
  depth: 64,
  nodes: 100000,
  objectKeys: 10000,
});
export const PLAN_EXECUTION_CONTEXT_EXACT_FIELDS = Object.freeze([
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
] as const);
const safeText = (value: string) =>
  ![...value].some((character) => {
    const point = character.codePointAt(0)!;
    return point === 0 || (point >= 0xd800 && point <= 0xdfff);
  });
const identity = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) =>
      safeText(value) &&
      ![...value].some((character) => {
        const point = character.codePointAt(0)!;
        return point < 32 || (point >= 127 && point <= 159);
      }),
  );
const literalText = (maximum: number) =>
  z.string().max(maximum).refine(safeText);

/** Complete browser-safe JSON representation admission before any Zod field
 * lookup. No accessor is invoked, no missing slot/value or unknown field is fixed.
 * This bounds in-memory JSON; it is not a native numeric/JSONB round-trip proof. */
export function inspectExactPlanExecutionJson(value: unknown) {
  const bounds = PLAN_EXECUTION_TEMPLATE_EXACT_BOUNDS,
    seen = new Set<object>(),
    encoder = new TextEncoder();
  let bytes = 0,
    nodes = 0;
  const refuse = () => {
    throw Error(
      "The complete literal template JSON representation is unsupported. No value was changed or clipped.",
    );
  };
  const add = (text: string) => {
    bytes += encoder.encode(text).length;
    if (bytes > bounds.templateBytes) refuse();
  };
  function visit(entry: unknown, depth: number): void {
    if (++nodes > bounds.nodes || depth > bounds.depth) refuse();
    if (
      entry === null ||
      typeof entry === "boolean" ||
      (typeof entry === "number" &&
        Number.isFinite(entry) &&
        !Object.is(entry, -0) &&
        (!Number.isInteger(entry) || Number.isSafeInteger(entry)))
    ) {
      add(JSON.stringify(entry));
      return;
    }
    if (typeof entry === "string") {
      if (entry.length > bounds.templateBytes || !safeText(entry)) refuse();
      add(JSON.stringify(entry));
      return;
    }
    if (!entry || typeof entry !== "object" || seen.has(entry)) return refuse();
    const array = Array.isArray(entry),
      proto = Object.getPrototypeOf(entry),
      keys = Reflect.ownKeys(entry);
    if (
      (proto !== (array ? Array.prototype : Object.prototype) &&
        !(proto === null && !array)) ||
      keys.some((key) => typeof key !== "string") ||
      keys.length > bounds.objectKeys
    )
      return refuse();
    seen.add(entry);
    add(array ? "[" : "{");
    if (array) {
      const length = Object.getOwnPropertyDescriptor(entry, "length");
      if (
        !length ||
        !("value" in length) ||
        !Number.isSafeInteger(length.value) ||
        length.value < 0 ||
        length.value > bounds.cases ||
        keys.length !== length.value + 1 ||
        keys.some(
          (key) =>
            key !== "length" &&
            (!/^(0|[1-9]\d*)$/.test(String(key)) ||
              Number(key) >= length.value),
        )
      )
        return refuse();
      for (let index = 0; index < length.value; index++) {
        const property = Object.getOwnPropertyDescriptor(entry, String(index));
        if (!property?.enumerable || !("value" in property)) return refuse();
        if (index) add(",");
        visit(property.value, depth + 1);
      }
    } else {
      let index = 0;
      for (const key of keys) {
        if (typeof key !== "string" || !safeText(key)) return refuse();
        const property = Object.getOwnPropertyDescriptor(entry, key)!;
        if (!property.enumerable || !("value" in property)) return refuse();
        if (index++) add(",");
        add(JSON.stringify(key) + ":");
        visit(property.value, depth + 1);
      }
    }
    add(array ? "]" : "}");
    seen.delete(entry);
  }
  visit(value, 0);
  return Object.freeze({ bytes, nodes });
}

const contextShape = z
  .object({
    configuration: literalText(2000),
    platform: literalText(300),
    build: literalText(300),
    hardwareRevision: literalText(300),
    firmwareVersion: literalText(300),
    rig: literalText(300),
    batchOrLot: literalText(300),
    environment: literalText(2000),
    calibrationReference: literalText(300),
    protocolReference: literalText(300),
  })
  .strict();
type LiteralContext = z.infer<typeof contextShape>;
const representationAndShape = (value: unknown, schema: z.ZodTypeAny) => {
  try {
    inspectExactPlanExecutionJson(value);
    return schema.safeParse(value).success;
  } catch {
    return false;
  }
};
/** z.custom validates the strict shape without replacing the supplied object or
 * its key order. Future owners must separately make an immutable request copy. */
export const planExecutionContextExactSchema = z.custom<LiteralContext>(
  (value) => representationAndShape(value, contextShape),
  {
    message:
      "All ten literal context strings are required and bounded; no field was defaulted or normalized.",
  },
);
const templateShape = z
  .object({
    version: z.literal(2),
    testCaseIds: z
      .array(identity)
      .max(PLAN_EXECUTION_TEMPLATE_EXACT_BOUNDS.cases),
    configurations: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            name: z
              .string()
              .min(1)
              .max(120)
              .refine((value) => safeText(value) && value.trim().length > 0),
            context: planExecutionContextExactSchema,
          })
          .strict(),
      )
      .max(PLAN_EXECUTION_TEMPLATE_EXACT_BOUNDS.configurations),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.testCaseIds).size !== value.testCaseIds.length ||
      new Set(value.configurations.map((configuration) => configuration.id))
        .size !== value.configurations.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Ordered case/configuration identities must remain unique.",
      });
  });
export const planExecutionTemplateExactSchema = z.custom<
  z.infer<typeof templateShape>
>((value) => representationAndShape(value, templateShape), {
  message:
    "The complete exact version-2 template is unsupported. No identity, text, order or field was changed or substituted.",
});
export type PlanExecutionContextExact = z.infer<
  typeof planExecutionContextExactSchema
>;
export type PlanExecutionTemplateExact = z.infer<
  typeof planExecutionTemplateExactSchema
>;
