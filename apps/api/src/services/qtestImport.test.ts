import { describe, it, expect } from "vitest";
import { buildModuleSuitePaths, mapQTestPriority, mapQTestTestCase, findQTestProperty } from "./qtestImport.js";
import type { QTestModule, QTestProperty, QTestTestCase } from "./qtestClient.js";

describe("buildModuleSuitePaths", () => {
  it("builds a flat path for a root module with no parent", () => {
    const modules: QTestModule[] = [{ id: 1, pid: "MD-1", name: "Login", parent_id: null }];
    expect(buildModuleSuitePaths(modules).get(1)).toBe("Login");
  });

  it("builds a nested 'Parent > Child > Grandchild' path", () => {
    const modules: QTestModule[] = [
      { id: 1, pid: "MD-1", name: "Auth", parent_id: null },
      { id: 2, pid: "MD-2", name: "Login", parent_id: 1 },
      { id: 3, pid: "MD-3", name: "SSO", parent_id: 2 },
    ];
    const paths = buildModuleSuitePaths(modules);
    expect(paths.get(1)).toBe("Auth");
    expect(paths.get(2)).toBe("Auth > Login");
    expect(paths.get(3)).toBe("Auth > Login > SSO");
  });

  it("does not infinite-loop or crash on a module whose parent isn't in the given list", () => {
    const modules: QTestModule[] = [{ id: 2, pid: "MD-2", name: "Orphan", parent_id: 999 }];
    expect(buildModuleSuitePaths(modules).get(2)).toBe("Orphan");
  });
});

describe("findQTestProperty / mapQTestPriority", () => {
  it("returns undefined when no property matches", () => {
    expect(findQTestProperty([{ field_id: 1, field_name: "Status" }], "priority")).toBeUndefined();
  });

  it("matches case-insensitively on a substring of field_name", () => {
    const props: QTestProperty[] = [{ field_id: 1, field_name: "Test Priority", field_value_name: "High" }];
    expect(findQTestProperty(props, "priority")).toBe(props[0]);
  });

  it("defaults to MEDIUM when no priority-shaped property exists", () => {
    expect(mapQTestPriority(undefined)).toBe("MEDIUM");
    expect(mapQTestPriority([{ field_id: 1, field_name: "Status", field_value_name: "Open" }])).toBe("MEDIUM");
  });

  it.each([
    ["Critical", "CRITICAL"],
    ["P1", "CRITICAL"],
    ["Blocker", "CRITICAL"],
    ["High", "HIGH"],
    ["P2", "HIGH"],
    ["Low", "LOW"],
    ["Minor", "LOW"],
    ["Trivial", "LOW"],
    ["Medium", "MEDIUM"],
    ["Normal", "MEDIUM"],
  ] as const)("maps qTest priority value %s to %s", (value, expected) => {
    const props: QTestProperty[] = [{ field_id: 1, field_name: "Priority", field_value_name: value }];
    expect(mapQTestPriority(props)).toBe(expected);
  });

  it("falls back to field_value when field_value_name is absent", () => {
    const props: QTestProperty[] = [{ field_id: 1, field_name: "Priority", field_value: "critical" }];
    expect(mapQTestPriority(props)).toBe("CRITICAL");
  });
});

describe("mapQTestTestCase", () => {
  it("maps structured steps in order, sorted by their `order` field", () => {
    const tc: QTestTestCase = {
      id: 1,
      pid: "TC-1",
      name: "Login with valid credentials",
      precondition: "User has a registered account",
      test_steps: [
        { id: 2, description: "Enter password", expected: "Password field accepts input", order: 2 },
        { id: 1, description: "Enter username", expected: "Username field accepts input", order: 1 },
      ],
    };
    const mapped = mapQTestTestCase(tc, 1, "Auth > Login");
    expect(mapped.key).toBe("TC-1");
    expect(mapped.title).toBe("Login with valid credentials");
    expect(mapped.suitePath).toBe("Auth > Login");
    expect(mapped.given).toEqual(["User has a registered account"]);
    expect(mapped.when).toEqual(["Enter username", "Enter password"]);
    expect(mapped.then).toEqual(["Username field accepts input", "Password field accepts input"]);
    expect(mapped.steps).toHaveLength(2);
    expect(mapped.steps[0]).toEqual({ action: "Enter username", expectedActionOrData: null, expectedResult: "Username field accepts input" });
  });

  it("derives a minimal BDD shape from the description when there are no structured steps", () => {
    const tc: QTestTestCase = { id: 2, pid: "TC-2", name: "Smoke test", description: "Verify the app loads" };
    const mapped = mapQTestTestCase(tc, 1, null);
    expect(mapped.when).toEqual(["Verify the app loads"]);
    expect(mapped.then).toEqual([]);
    expect(mapped.given).toEqual([]);
    expect(mapped.steps).toEqual([]);
  });

  it("reads priority from properties via mapQTestPriority", () => {
    const tc: QTestTestCase = {
      id: 3,
      pid: "TC-3",
      name: "Critical path",
      properties: [{ field_id: 9, field_name: "Priority", field_value_name: "Critical" }],
    };
    expect(mapQTestTestCase(tc, 1, null).priority).toBe("CRITICAL");
  });
});
