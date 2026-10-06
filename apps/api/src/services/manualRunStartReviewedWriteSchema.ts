import { z } from "zod";
import type { ManualRunStartLegacyRawInput } from "./manualRunStartLegacySchema.js";
import {
  manualRunStartReviewedAuthenticatedSubject as identity,
  manualRunStartReviewedReadScope,
} from "./manualRunStartReviewedWireSchema.js";

export const REVIEWED_START_WIRE_BOUNDS = Object.freeze({
  bytes: 2 * 1024 * 1024,
  nodes: 10000,
  depth: 16,
  array: 1000,
  keys: 64,
});
const message =
  "The complete retained run-start envelope is unsupported or exceeds bounded plain JSON. Nothing was normalized, dropped or submitted.";

/** Descriptor admission before property access/cloning/encoding. No getters,
 * toJSON, holes, custom prototypes, nonenumerable private fields or undefined.
 * This inspects wire representation, NOT native permission or raw SQL fidelity. */
export function inspectReviewedStartWire(value: unknown) {
  let bytes = 0,
    nodes = 0;
  const encoder = new TextEncoder(),
    ancestors = new Set<object>();
  const add = (text: string) => {
    bytes += encoder.encode(text).byteLength;
    if (bytes > REVIEWED_START_WIRE_BOUNDS.bytes) throw Error(message);
  };
  const visit = (value: unknown, depth: number) => {
    if (
      ++nodes > REVIEWED_START_WIRE_BOUNDS.nodes ||
      depth > REVIEWED_START_WIRE_BOUNDS.depth
    )
      throw Error(message);
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      add(JSON.stringify(value));
      return;
    }
    if (!value || typeof value !== "object" || ancestors.has(value))
      throw Error(message);
    const array = Array.isArray(value),
      prototype = Object.getPrototypeOf(value),
      keys = Reflect.ownKeys(value);
    if (
      (prototype !== (array ? Array.prototype : Object.prototype) &&
        !(prototype === null && !array)) ||
      keys.some((key) => typeof key !== "string") ||
      keys.length >
        (array
          ? REVIEWED_START_WIRE_BOUNDS.array + 1
          : REVIEWED_START_WIRE_BOUNDS.keys)
    )
      throw Error(message);
    ancestors.add(value);
    add(array ? "[" : "{");
    if (array) {
      if (
        value.length > REVIEWED_START_WIRE_BOUNDS.array ||
        keys.length !== value.length + 1 ||
        keys.some(
          (key) =>
            key !== "length" &&
            (!/^\d+$/.test(String(key)) ||
              String(Number(key)) !== key ||
              Number(key) >= value.length),
        )
      )
        throw Error(message);
      for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor?.enumerable || !("value" in descriptor))
          throw Error(message);
        if (i) add(",");
        visit(descriptor.value, depth + 1);
      }
    } else {
      let i = 0;
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!descriptor.enumerable || !("value" in descriptor))
          throw Error(message);
        if (i++) add(",");
        add(JSON.stringify(key) + ":");
        visit(descriptor.value, depth + 1);
      }
    }
    add(array ? "]" : "}");
    ancestors.delete(value);
  };
  visit(value, 0);
  return Object.freeze({ bytes, nodes });
}
const bounded = z.unknown().superRefine((value, context) => {
  try {
    inspectReviewedStartWire(value);
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message });
  }
});
const trimmedLength = (max: number) =>
  z
    .string()
    .refine(
      (value) => value.trim().length <= max,
      "Unsupported retained configuration length",
    );
// Validation mirrors the OLD parser's accepted known fields, but contains NO
// trim/default/strip/coerce operation. The original parser/hash is still owned
// by the writer, and raw old UNKNOWN bodies retain omissions and key order.
const rawConfiguration = z
  .object({
    configuration: trimmedLength(2000).optional(),
    platform: trimmedLength(300).optional(),
    build: trimmedLength(300).optional(),
    hardwareRevision: trimmedLength(300).optional(),
    firmwareVersion: trimmedLength(300).optional(),
    rig: trimmedLength(300).optional(),
    batchOrLot: trimmedLength(300).optional(),
    environment: trimmedLength(2000).optional(),
    calibrationReference: trimmedLength(300).optional(),
    protocolReference: trimmedLength(300).optional(),
  })
  .strict();
const rawInner = z
  .object({
    projectId: z.string(),
    testCaseIds: z.array(z.string()).min(1).max(1000),
    expectedProfileHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    executionContext: rawConfiguration.optional(),
    idempotencyKey: z.string().uuid().optional(),
    planReference: z
      .object({
        testPlanId: z.string().min(1).max(200),
        expectedTemplateHash: z.string().regex(/^[a-f0-9]{64}$/),
        configurationId: z.string().uuid(),
      })
      .strict()
      .optional(),
    originalOrganizationId: z.string().min(1).max(200).optional(),
    expectedClerkActorId: z.string().min(1).max(200).optional(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.originalOrganizationId) ===
        Boolean(value.expectedClerkActorId) &&
      (!value.originalOrganizationId || !!value.idempotencyKey),
  );
const retainedInner = z.custom<ManualRunStartLegacyRawInput>((value) => {
  try {
    inspectReviewedStartWire(value);
    return rawInner.safeParse(value).success;
  } catch {
    return false;
  }
}, message);
const outer = z
  .object({
    projectId: identity,
    originalOrganizationId: identity,
    expectedClerkActorId: identity,
    expectedNativeActorId: identity,
    request: retainedInner,
  })
  .strict();
function sameOuter(value: z.infer<typeof outer>) {
  return (
    value.projectId === value.request.projectId &&
    (value.request.originalOrganizationId === undefined ||
      value.request.originalOrganizationId === value.originalOrganizationId) &&
    (value.request.expectedClerkActorId === undefined ||
      value.request.expectedClerkActorId === value.expectedClerkActorId)
  );
}
const checkedStart = outer
  .extend({ mode: z.literal("START") })
  .strict()
  .superRefine((value, context) => {
    if (
      !sameOuter(value) ||
      !value.request.idempotencyKey ||
      !value.request.expectedProfileHash ||
      !Object.hasOwn(value.request, "executionContext") ||
      value.request.originalOrganizationId !== value.originalOrganizationId ||
      value.request.expectedClerkActorId !== value.expectedClerkActorId ||
      !value.request.testCaseIds.every(
        (caseId) => identity.safeParse(caseId).success,
      ) ||
      new Set(value.request.testCaseIds).size !==
        value.request.testCaseIds.length
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Review the complete original project/profile/configuration and distinct supported cases with a durable key before starting.",
      });
  });
const checkedRecovery = outer
  .extend({ mode: z.literal("LEGACY_RECOVERY") })
  .strict()
  .superRefine((value, context) => {
    if (!sameOuter(value) || !value.request.idempotencyKey)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Keep the exact old project/request/key and original native author before recovering; no old pins were inferred or injected.",
      });
  });
// Entire envelopes, not just inner bodies, retain their original key ordering.
export const manualRunStartReviewedStartInput = bounded.pipe(
  z.custom<z.infer<typeof checkedStart>>(
    (value) => checkedStart.safeParse(value).success,
    message,
  ),
);
export const manualRunStartReviewedRecoveryInput = bounded.pipe(
  z.custom<z.infer<typeof checkedRecovery>>(
    (value) => checkedRecovery.safeParse(value).success,
    message,
  ),
);
export type ManualRunStartReviewedStartInput = z.infer<
  typeof manualRunStartReviewedStartInput
>;
export type ManualRunStartReviewedRecoveryInput = z.infer<
  typeof manualRunStartReviewedRecoveryInput
>;
export type ManualRunStartReviewedWriteInput =
  ManualRunStartReviewedStartInput | ManualRunStartReviewedRecoveryInput;

/** Owned immutable copy before asynchronous authorization. Every own key/order,
 * literal string and omission is retained; never freeze/mutate caller objects. */
export function freezeReviewedStartEnvelope<
  T extends ManualRunStartReviewedWriteInput,
>(value: T): T {
  inspectReviewedStartWire(value);
  function copy(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return Object.freeze(value.map(copy));
    const result = Object.create(Object.getPrototypeOf(value)) as Record<
      string,
      unknown
    >;
    for (const key of Object.keys(value))
      Object.defineProperty(result, key, {
        value: copy(Object.getOwnPropertyDescriptor(value, key)!.value),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    return Object.freeze(result);
  }
  return copy(value) as T;
}
const legacyAck = z
  .object({
    testRunId: z.string().regex(/^manual_[a-f0-9]{64}$/),
    originalOrganizationId: identity.optional(),
    expectedClerkActorId: identity.optional(),
    idempotencyKey: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.originalOrganizationId) ===
        Boolean(value.expectedClerkActorId) &&
      (!value.originalOrganizationId || !!value.idempotencyKey),
  );
export const manualRunStartReviewedAckSchema = z
  .object({
    mode: z.enum(["START", "LEGACY_RECOVERY"]),
    currentScope: manualRunStartReviewedReadScope,
    idempotencyKey: z.string().uuid(),
    legacyAck,
    historicalOuterProvenance: z.literal("UNRECORDED"),
    interpretation: z.literal("LEGACY_NORMALIZED_NOT_RAW_LOSSLESS"),
  })
  .strict();
export type ManualRunStartReviewedAck = z.infer<
  typeof manualRunStartReviewedAckSchema
>;
