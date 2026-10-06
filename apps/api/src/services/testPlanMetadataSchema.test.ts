import { describe, expect, it } from "vitest";
import {
  applyReviewedPlanMetadata,
  planMetadataChanges,
  supportedPlanMetadataDefinition,
  editablePlanMetadata,
  planMetadataSchemaHash,
  MAX_PLAN_METADATA_PATCH_BYTES,
} from "./testPlanMetadataSchema.js";
const schema = {
  type: "object",
  properties: {
    prose: { type: "string" },
    rows: { type: "array", items: { type: "string" } },
    enabled: { type: "boolean" },
    count: { type: "number" },
    future: { type: "string", enum: ["one"] },
  },
};
describe("exact supported declared plan metadata patches", () => {
  it("retains raw whitespace, duplicate/empty list rows, false/zero and all unknown nested siblings", () => {
    const before = Object.freeze({
      prose: "previous",
      rows: ["same", "same", ""],
      enabled: false,
      count: 0,
      unknown: { list: [false, 0, null, " raw\n"] },
      future: "one",
    });
    const after = applyReviewedPlanMetadata(schema, before, [
      { operation: "SET", key: "prose", value: " raw\n exact " },
      { operation: "SET", key: "rows", value: ["", "same", "same", " line\n"] },
    ]);
    expect(after).toEqual({
      ...before,
      prose: " raw\n exact ",
      rows: ["", "same", "same", " line\n"],
    });
    expect(after.unknown).toBe(before.unknown);
    expect(before.prose).toBe("previous");
  });
  it("missing declared values require explicit SET; REMOVE only existing supported compatible native values", () => {
    expect(
      applyReviewedPlanMetadata(schema, {}, [
        { operation: "SET", key: "enabled", value: false },
        { operation: "SET", key: "count", value: 0 },
      ]),
    ).toEqual({ enabled: false, count: 0 });
    expect(
      applyReviewedPlanMetadata(schema, { enabled: false, unknown: "retain" }, [
        { operation: "REMOVE", key: "enabled" },
      ]),
    ).toEqual({ unknown: "retain" });
    expect(() =>
      applyReviewedPlanMetadata(schema, {}, [
        { operation: "REMOVE", key: "enabled" },
      ]),
    ).toThrow("unset");
    expect(() =>
      applyReviewedPlanMetadata(schema, { prose: "same" }, [
        { operation: "SET", key: "prose", value: "same" },
      ]),
    ).toThrow("no native change");
  });
  it("null, scalar, array roots and incompatible/unknown/unsupported current fields cannot be replaced or removed", () => {
    for (const root of [null, [], "old", false, 0])
      expect(() =>
        applyReviewedPlanMetadata(schema, root, [
          { operation: "SET", key: "prose", value: "new" },
        ]),
      ).toThrow("retained unchanged");
    for (const key of ["prose", "future", "unknown"])
      for (const operation of ["SET", "REMOVE"])
        expect(() =>
          applyReviewedPlanMetadata(
            schema,
            { prose: null, future: "one", unknown: "private" },
            [
              {
                operation,
                key,
                ...(operation === "SET" ? { value: "new" } : {}),
              },
            ],
          ),
        ).toThrow("retained unchanged");
  });
  it("safe own reserved keys survive unrelated updates, never become editable or get prototype-normalized", () => {
    const before = JSON.parse(
      '{"prose":"old","__proto__":{"retained":true},"constructor":"keep","prototype":["exact"]}',
    ) as Record<string, unknown>;
    const after = applyReviewedPlanMetadata(schema, before, [
      { operation: "SET", key: "prose", value: "new" },
    ]);
    for (const key of ["__proto__", "constructor", "prototype"]) {
      expect(Object.hasOwn(after, key)).toBe(true);
      expect(after[key]).toBe(before[key]);
      expect(
        planMetadataChanges.safeParse([{ operation: "REMOVE", key }]).success,
      ).toBe(false);
    }
    expect(Object.getPrototypeOf(after)).toBe(Object.getPrototypeOf(before));
    expect(Object.getPrototypeOf(after)).toBe(Object.prototype);
  });
  it("rejects duplicate/unbounded/coercive or non-JSON patches without invoking hooks or dropping array properties", () => {
    for (const changes of [
      [],
      Array.from({ length: 51 }, (_, index) => ({
        operation: "REMOVE",
        key: `key${index}`,
      })),
      [
        { operation: "REMOVE", key: "prose" },
        { operation: "SET", key: "prose", value: "new" },
      ],
      [{ operation: "SET", key: "count", value: NaN }],
      [{ operation: "SET", key: "prose", value: null }],
      [{ operation: "SET", key: "prose", value: "x".repeat(40001) }],
      [
        {
          operation: "SET",
          key: "rows",
          value: Array.from({ length: 501 }, () => ""),
        },
      ],
    ])
      expect(planMetadataChanges.safeParse(changes).success).toBe(false);
    const oversized = [
      {
        operation: "SET",
        key: "rows",
        value: Array.from({ length: 7 }, () => "x".repeat(10000)),
      },
    ];
    expect(JSON.stringify(oversized).length).toBeGreaterThan(
      MAX_PLAN_METADATA_PATCH_BYTES,
    );
    expect(planMetadataChanges.safeParse(oversized).success).toBe(false);
    let calls = 0;
    const accessor = Object.defineProperty({}, "prose", {
      get: () => {
        calls++;
        return "secret";
      },
      enumerable: true,
    });
    expect(() =>
      applyReviewedPlanMetadata(schema, accessor, [
        { operation: "SET", key: "prose", value: "new" },
      ]),
    ).toThrow();
    expect(calls).toBe(0);
    const decorated = Object.assign(["row"], { privateExtra: "must not drop" });
    expect(
      planMetadataChanges.safeParse([
        { operation: "SET", key: "rows", value: decorated },
      ]).success,
    ).toBe(false);
  });
  it("does not infer required/enum/default/date/nested field behavior or normalize schema before hashing", () => {
    for (const raw of [
      { ...schema, required: ["prose"] },
      { ...schema, additionalProperties: false },
      null,
      [],
    ])
      expect(supportedPlanMetadataDefinition(raw).supported).toBe(false);
    const definition = supportedPlanMetadataDefinition(schema);
    expect([...definition.fields.keys()]).toEqual([
      "prose",
      "rows",
      "enabled",
      "count",
    ]);
    expect(
      editablePlanMetadata(schema, {
        prose: null,
        enabled: null,
        rows: null,
        count: null,
      }),
    ).toBe(false);
    expect(editablePlanMetadata(schema, {})).toBe(true);
    expect(planMetadataSchemaHash("type", schema)).not.toBe(
      planMetadataSchemaHash("other-type", schema),
    );
    expect(
      planMetadataSchemaHash("type", { ...schema, title: " raw " }),
    ).not.toBe(planMetadataSchemaHash("type", { ...schema, title: "raw" }));
  });
});
