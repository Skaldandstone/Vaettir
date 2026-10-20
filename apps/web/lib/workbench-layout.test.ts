import { expect, it } from "vitest";
import { panelPreference, sidebarPreference } from "./workbench-layout";

it("bounds stored widths and rejects malformed preferences", () => {
  for (const value of [null, "unsafe", [], { width: NaN }, { width: "320" }]) expect(sidebarPreference(value)).toEqual({ width: 184, collapsed: false });
  expect(sidebarPreference({ width: -100, collapsed: true })).toEqual({ width: 152, collapsed: true });
  expect(sidebarPreference({ width: 999999, collapsed: "true" })).toEqual({ width: 320, collapsed: false });
});
it("retains known layout IDs only and includes newly available panels", () => {
  expect(panelPreference({ order: ["b", "b", "foreign", 4], collapsed: ["a", "foreign"], wide: ["b", "b"] }, ["a", "b", "c"])).toEqual({ order: ["b", "a", "c"], collapsed: ["a"], wide: ["b"] });
  expect(panelPreference(null, ["a", "b"], ["b"])).toEqual({ order: ["a", "b"], collapsed: [], wide: ["b"] });
});
