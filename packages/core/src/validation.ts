import { z as native } from "zod";

/** Application contracts measure stored text in UTF-16 units (String.length).
 * Zod 4.6 counts codepoints instead. Keep those existing limits without changing
 * strings, shared Zod prototypes, or the patched native array parser.
 * This adapter is deliberately pinned and tested against Zod 4.6.7. */
function text(schema: native.ZodString): native.ZodString {
  return new Proxy(schema, {
    get(target, key, receiver) {
      if (key === "min" || key === "max" || key === "length") {
        return (...args: Parameters<native.ZodString["min"]>) => {
          const bounded: native.ZodString = Reflect.apply(native.string()[key], native.string(), args);
          const check = bounded._zod.def.checks![0]!;
          check._zod.check = payload => {
            const value = payload.value as string;
            const limit = args[0];
            if (key === "min" ? value.length >= limit : key === "max" ? value.length <= limit : value.length === limit) return;
            const tooBig = key === "max" || key === "length" && value.length > limit;
            payload.issues.push({
              origin: "string",
              ...(tooBig ? { code: "too_big" as const, maximum: limit } : { code: "too_small" as const, minimum: limit }),
              inclusive: true,
              ...(key === "length" ? { exact: true } : {}),
              input: value,
              inst: check,
              continue: !check._zod.def.abort,
            });
          };
          return text(target.check(check));
        };
      }
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function" || key === "constructor") return value;
      return (...args: unknown[]) => {
        const result = Reflect.apply(value, target, args);
        return result instanceof native.ZodString ? text(result) : result;
      };
    },
  });
}

function string(...args: Parameters<typeof native.string>): native.ZodString {
  return text(native.string(...args));
}

// Preserve the existing one-argument string-key record constructors. Enum-key
// partial mappings must explicitly use partialRecord in Zod 4.
function record<V extends native.ZodType>(value: V): native.ZodRecord<native.ZodString, V>;
function record<K extends native.core.$ZodRecordKey, V extends native.core.SomeType>(key: K, value: V, params?: string | native.core.$ZodRecordParams): native.ZodRecord<K, V>;
function record(key: native.ZodType, value?: native.ZodType, params?: string | native.core.$ZodRecordParams) {
  return value === undefined ? native.record(native.string(), key) : native.record(key as native.core.$ZodRecordKey, value, params);
}

export const z = { ...native, string, record };
// eslint-disable-next-line @typescript-eslint/no-namespace -- Type-only merge preserves existing z.infer and schema type names; emits no namespace runtime.
export namespace z {
  export type infer<T extends native.ZodType> = native.infer<T>;
  export type input<T extends native.ZodType> = native.input<T>;
  export type output<T extends native.ZodType> = native.output<T>;
  export type RefinementCtx = native.RefinementCtx;
  export type ZodError = native.ZodError;
  export type ZodRawShape = native.ZodRawShape;
  export type ZodType<T = unknown> = native.ZodType<T>;
  export type ZodTypeAny = native.ZodType;
  export type ZodString = native.ZodString;
  export type ZodOptional<T extends native.ZodType> = native.ZodOptional<T>;
  export type ZodObject<T extends native.ZodRawShape> = native.ZodObject<T>;
}
