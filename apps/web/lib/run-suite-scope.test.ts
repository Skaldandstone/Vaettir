import { expect, it } from "vitest";
import {
  RUN_SUITE_ALL_VALUE,
  RUN_SUITE_SCOPE_WIRE_BYTES,
  encodeRunSuiteScope,
  parseRunSuiteScope,
  resolveRunSuiteScope,
  runSuiteScopeMatches,
  runSuiteScopeOptions,
} from "./run-suite-scope";
it("ALL, native null and the literal empty saved path are distinct immutable selectors", () => {
  const catalog = runSuiteScopeOptions([null, "", "Unassigned", null, ""]);
  expect(catalog.options).toHaveLength(4);
  const unassigned = resolveRunSuiteScope(
      encodeRunSuiteScope({ kind: "UNASSIGNED" }),
      catalog.options,
    ),
    empty = resolveRunSuiteScope(
      encodeRunSuiteScope({ kind: "PATH", path: "" }),
      catalog.options,
    );
  expect(unassigned.specific).toBe(true);
  expect(empty.specific).toBe(true);
  expect(runSuiteScopeMatches(unassigned.scope, null)).toBe(true);
  expect(runSuiteScopeMatches(unassigned.scope, "")).toBe(false);
  expect(runSuiteScopeMatches(empty.scope, "")).toBe(true);
  expect(runSuiteScopeMatches(empty.scope, null)).toBe(false);
  expect(catalog.options.map((row) => row.label)).toContain(
    "Saved empty suite path",
  );
  expect(Object.isFrozen(catalog.options)).toBe(true);
  expect(Object.isFrozen(unassigned.scope)).toBe(true);
});
it.each([
  "",
  "  ",
  "\n\t ",
  "Suite A",
  "Unassigned",
  RUN_SUITE_ALL_VALUE,
  '{"kind":"UNASSIGNED"}',
  "__proto__",
  "A/🎮/Ö",
  ' x "quoted"\nretained ',
])(
  "preserves exact saved PATH %j without normalizing or treating a label as a sentinel",
  (path) => {
    const wire = encodeRunSuiteScope({ kind: "PATH", path }),
      catalog = runSuiteScopeOptions([path]),
      selected = resolveRunSuiteScope(wire, catalog.options);
    expect(parseRunSuiteScope(wire)).toEqual({ kind: "PATH", path });
    expect(selected.available).toBe(true);
    expect(runSuiteScopeMatches(selected.scope, path)).toBe(true);
    expect(runSuiteScopeMatches(selected.scope, null)).toBe(false);
    expect(runSuiteScopeMatches(selected.scope, path + " ")).toBe(false);
  },
);
it.each([
  undefined,
  null,
  "",
  "Suite A",
  "null",
  "[]",
  "{}",
  '{"kind":"ALL","path":""}',
  '{"kind":"PATH"}',
  '{"kind":"PATH","path":null}',
  '{"kind":"UNASSIGNED","extra":true}',
])("unsupported wire %j never falls back to ALL", (wire) => {
  const value = resolveRunSuiteScope(
    wire,
    runSuiteScopeOptions([null, ""]).options,
  );
  expect(value.available).toBe(false);
  expect(value.scope).toBeNull();
  expect(runSuiteScopeMatches(value.scope, null)).toBe(false);
});
it("stale or noncanonical selector is unavailable even when a superficially similar path remains", () => {
  const old = encodeRunSuiteScope({ kind: "PATH", path: " A " });
  expect(
    resolveRunSuiteScope(old, runSuiteScopeOptions(["A"]).options).available,
  ).toBe(false);
  expect(
    resolveRunSuiteScope(' {"kind":"ALL"}', runSuiteScopeOptions([]).options)
      .available,
  ).toBe(false);
});
it("missing/unsupported native metadata never generates unassigned; ALL invents no suite metadata", () => {
  const catalog = runSuiteScopeOptions([undefined, 0, false, {}, "A"]);
  expect(catalog.unsupportedCount).toBe(4);
  expect(catalog.options.some((row) => row.scope.kind === "UNASSIGNED")).toBe(
    false,
  );
  const all = resolveRunSuiteScope(RUN_SUITE_ALL_VALUE, catalog.options);
  expect(all.specific).toBe(false);
  expect(runSuiteScopeMatches(all.scope, undefined)).toBe(true);
  expect(runSuiteScopeMatches({ kind: "UNASSIGNED" }, undefined)).toBe(false);
});
it("selector byte overflow is explicitly unavailable without clipping identities or native text", () => {
  const path = "x".repeat(RUN_SUITE_SCOPE_WIRE_BYTES),
    original = [path, path, null];
  const catalog = runSuiteScopeOptions(original);
  expect(catalog.unsupportedCount).toBe(2);
  expect(catalog.options).toHaveLength(2);
  expect(original).toEqual([path, path, null]);
  expect(parseRunSuiteScope(JSON.stringify({ kind: "PATH", path }))).toBeNull();
});
