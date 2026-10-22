import { expect, it } from "vitest";
import { directoryObservationLabel, sameDirectoryMappings } from "./identity-directory-view";

const project = { externalGroupId: "one", roleId: "reader", scope: { kind: "projects" as const, projectIds: ["b", "a"] } };
const workspace = { externalGroupId: "two", roleId: "author", scope: { kind: "workspace" as const } };
it("ignores mapping and project ordering without mutating saved data", () => {
  const initial = structuredClone([project, workspace]);
  expect(sameDirectoryMappings(initial, [workspace, { ...project, scope: { kind: "projects", projectIds: ["a", "b"] } }])).toBe(true);
  expect(initial).toEqual([project, workspace]);
  expect(sameDirectoryMappings([], [])).toBe(true);
});
it("retains real group, role and scope changes including permission reductions", () => {
  for (const changed of [{ ...project, roleId: "writer" }, { ...project, externalGroupId: "new" },
    { ...project, scope: { kind: "workspace" as const } }, { ...project, scope: { kind: "projects" as const, projectIds: ["a"] } }]) {
    expect(sameDirectoryMappings([project], [changed])).toBe(false);
  }
  expect(sameDirectoryMappings([project], [])).toBe(false);
});
it("never reports an unobserved or empty directory as current members", () => {
  const empty = { enabled: true, staleMembers: 0, observedMembers: 0, lastObservedAt: null };
  expect(directoryObservationLabel(empty)).toBe("Not yet synced");
  expect(directoryObservationLabel({ ...empty, lastObservedAt: "2026-10-22T00:00:00Z" })).toBe("No members observed");
  expect(directoryObservationLabel({ ...empty, enabled: false })).toBe("Disabled");
  const observed = { ...empty, lastObservedAt: "2026-10-22T00:00:00Z", observedMembers: 2 };
  expect(directoryObservationLabel(observed)).toBe("Observations current");
  expect(directoryObservationLabel({ ...observed, staleMembers: 1 })).toBe("Sync needed");
});
