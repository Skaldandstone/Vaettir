import { describe, it, expect } from "vitest";
import { buildFolderSuitePaths, mapZephyrPriorityName, mapZephyrTestCase } from "./zephyrImport.js";
import type { ZephyrFolder, ZephyrTestCase } from "./zephyrClient.js";

describe("buildFolderSuitePaths", () => {
  it("builds a flat path for a root folder", () => {
    const folders: ZephyrFolder[] = [{ id: 1, parentId: null, name: "Login" }];
    expect(buildFolderSuitePaths(folders).get(1)).toBe("Login");
  });

  it("builds a nested 'Parent > Child > Grandchild' path", () => {
    const folders: ZephyrFolder[] = [
      { id: 1, parentId: null, name: "Auth" },
      { id: 2, parentId: 1, name: "Login" },
      { id: 3, parentId: 2, name: "SSO" },
    ];
    const paths = buildFolderSuitePaths(folders);
    expect(paths.get(3)).toBe("Auth > Login > SSO");
  });

  it("does not crash on a folder whose parent isn't in the given list", () => {
    const folders: ZephyrFolder[] = [{ id: 2, parentId: 999, name: "Orphan" }];
    expect(buildFolderSuitePaths(folders).get(2)).toBe("Orphan");
  });
});

describe("mapZephyrPriorityName", () => {
  it("defaults to MEDIUM when undefined or unrecognized", () => {
    expect(mapZephyrPriorityName(undefined)).toBe("MEDIUM");
    expect(mapZephyrPriorityName("Normal")).toBe("MEDIUM");
  });

  it.each([
    ["Critical", "CRITICAL"],
    ["Highest", "CRITICAL"],
    ["P1", "CRITICAL"],
    ["High", "HIGH"],
    ["Low", "LOW"],
    ["Lowest", "LOW"],
    ["Minor", "LOW"],
  ] as const)("maps Zephyr priority name %s to %s", (name, expected) => {
    expect(mapZephyrPriorityName(name)).toBe(expected);
  });
});

describe("mapZephyrTestCase", () => {
  const baseTestCase: ZephyrTestCase = { key: "PROJ-T1", name: "Login works", precondition: "User has an account" };

  it("prefers structured steps when present", () => {
    const mapped = mapZephyrTestCase({
      testCase: baseTestCase,
      rowNumber: 1,
      suitePath: "Auth > Login",
      priorityName: "High",
      steps: [{ action: "Enter credentials", expectedActionOrData: null, expectedResult: "Logged in" }],
      scriptText: "should never be used since steps exist",
    });
    expect(mapped.key).toBe("PROJ-T1");
    expect(mapped.priority).toBe("HIGH");
    expect(mapped.suitePath).toBe("Auth > Login");
    expect(mapped.given).toEqual(["User has an account"]);
    expect(mapped.when).toEqual(["Enter credentials"]);
    expect(mapped.then).toEqual(["Logged in"]);
  });

  it("falls back to raw script-text lines when there are no structured steps", () => {
    const mapped = mapZephyrTestCase({
      testCase: baseTestCase,
      rowNumber: 1,
      suitePath: null,
      priorityName: undefined,
      steps: [],
      scriptText: "Given a user\nWhen they log in\n\nThen they see the dashboard",
    });
    expect(mapped.when).toEqual(["Given a user", "When they log in", "Then they see the dashboard"]);
    expect(mapped.then).toEqual([]);
  });

  it("falls back to the objective when there are no steps and no script", () => {
    const mapped = mapZephyrTestCase({
      testCase: { ...baseTestCase, objective: "Verify login succeeds", precondition: null },
      rowNumber: 1,
      suitePath: null,
      priorityName: undefined,
      steps: [],
      scriptText: null,
    });
    expect(mapped.given).toEqual([]);
    expect(mapped.when).toEqual(["Verify login succeeds"]);
  });
});
