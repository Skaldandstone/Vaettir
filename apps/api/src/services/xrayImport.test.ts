import { describe, it, expect } from "vitest";
import { parseXrayExport, parseXraySteps, mapXrayPriority } from "./xrayImport.js";

// Fixtures are constructed from Xray's documented export shapes (Jira CSV
// issue export with Xray custom fields; Xray JSON test export) - there is
// no live Jira/Xray instance in this environment to capture a real one.

const SERVER_STEPS = JSON.stringify([
  { index: 1, fields: { Action: "Open the login page", Data: "https://app/login", "Expected Result": "Form is shown" } },
  { index: 2, fields: { Action: "Submit valid credentials", Data: "", "Expected Result": "Dashboard loads" } },
]);

function csvCell(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

const JIRA_CSV = [
  "Summary,Issue key,Issue Type,Priority,Labels,Labels,Description,Custom field (Test Type),Custom field (Manual Test Steps),Custom field (Cucumber Scenario),Custom field (Test Repository Path)",
  [
    csvCell("Login succeeds"),
    "ABC-101",
    "Test",
    "High",
    "auth",
    "smoke",
    csvCell("A registered user exists\n\nMore detail here."),
    "Manual",
    csvCell(SERVER_STEPS),
    "",
    "/Auth/Login",
  ].join(","),
  [
    csvCell("Checkout totals"),
    "ABC-102",
    "Test",
    "Highest",
    "cart",
    "",
    "",
    "Cucumber",
    "",
    csvCell("Scenario Outline: totals\n  Given a cart with <qty> items\n  When I check out\n  Then the total is <total>\n  Examples:\n    | qty | total |\n    | 1 | 10 |\n    | 2 | 20 |"),
    "/Checkout",
  ].join(","),
  [csvCell("Empty test"), "ABC-103", "Test", "Low", "", "", "", "Manual", "", "", ""].join(","),
  [csvCell("API ping"), "ABC-104", "Test", "Medium", "", "", "", "Generic", "", "", ""].join(",") + "",
].join("\n");

describe("parseXrayExport (Jira CSV)", () => {
  const result = parseXrayExport(JIRA_CSV);

  it("detects the format and maps a manual test with structured steps", () => {
    expect(result.format).toBe("jira-csv");
    const login = result.cases.find((c) => c.key === "ABC-101")!;
    expect(login).toMatchObject({
      title: "Login succeeds",
      testType: "Manual",
      priority: "HIGH",
      tags: ["auth", "smoke"],
      suitePath: "/Auth/Login",
      given: ["A registered user exists"],
      when: ["Open the login page", "Submit valid credentials"],
      then: ["Form is shown", "Dashboard loads"],
    });
    expect(login.steps).toEqual([
      { action: "Open the login page", expectedActionOrData: "https://app/login", expectedResult: "Form is shown" },
      { action: "Submit valid credentials", expectedActionOrData: null, expectedResult: "Dashboard loads" },
    ]);
    expect(login.background).toContain("More detail here.");
  });

  it("expands a Cucumber scenario outline into one case per example row", () => {
    const totals = result.cases.filter((c) => c.key.startsWith("ABC-102"));
    expect(totals.map((c) => c.key)).toEqual(["ABC-102", "ABC-102#2"]);
    expect(totals[0]).toMatchObject({ priority: "CRITICAL", tags: ["cart"], given: ["a cart with 1 items"], then: ["the total is 10"] });
    expect(totals[1]!.given).toEqual(["a cart with 2 items"]);
    expect(totals[0]!.title).toContain("Checkout totals");
  });

  it("skips a manual test with no steps, with the row number and a reason", () => {
    expect(result.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ rowNumber: 4, reason: expect.stringContaining("No steps") })]));
    expect(result.cases.some((c) => c.key === "ABC-103")).toBe(false);
  });

  it("skips a generic test with no definition rather than inventing one", () => {
    expect(result.cases.some((c) => c.key === "ABC-104")).toBe(false);
    expect(result.skipped.some((s) => s.rowNumber === 5)).toBe(true);
  });

  it("rejects a CSV that is not a Jira export", () => {
    expect(() => parseXrayExport("title,given\n\"x\",\"y\"")).toThrow(/no "Summary" column/);
  });
});

describe("parseXrayExport (Xray JSON)", () => {
  it("maps Cloud-style steps, labels and a generic definition", () => {
    const json = JSON.stringify([
      {
        key: "XR-1",
        summary: "Reset password",
        type: "Manual",
        priority: "Lowest",
        labels: ["account"],
        precondition: "User has an account",
        steps: [{ action: "Request reset", data: "email", result: "Email sent" }],
      },
      { key: "XR-2", summary: "Health endpoint", type: "Generic", definition: "GET /health returns 200" },
      { key: "XR-3", summary: "Nothing here", type: "Manual" },
    ]);
    const r = parseXrayExport(json);
    expect(r.format).toBe("xray-json");
    expect(r.cases.map((c) => c.key)).toEqual(["XR-1", "XR-2"]);
    expect(r.cases[0]).toMatchObject({
      priority: "LOW",
      tags: ["account"],
      given: ["User has an account"],
      when: ["Request reset"],
      then: ["Email sent"],
      steps: [{ action: "Request reset", expectedActionOrData: "email", expectedResult: "Email sent" }],
    });
    expect(r.cases[1]).toMatchObject({ testType: "Generic", when: ["GET /health returns 200"], then: [] });
    expect(r.skipped).toEqual([{ rowNumber: 3, reason: expect.stringContaining("No steps") }]);
  });

  it("accepts the { tests: [...] } wrapper and rejects other objects", () => {
    expect(parseXrayExport(JSON.stringify({ tests: [{ key: "A-1", summary: "s", definition: "d" }] })).cases).toHaveLength(1);
    expect(() => parseXrayExport("{}")).toThrow(/expected an array/);
  });
});

describe("parseXraySteps", () => {
  it("tolerates malformed JSON and non-step items", () => {
    expect(parseXraySteps("not json")).toEqual([]);
    expect(parseXraySteps(JSON.stringify([1, null, { fields: { Data: "no action" } }]))).toEqual([]);
  });
});

describe("mapXrayPriority", () => {
  it("maps Jira's default scheme and falls back to MEDIUM", () => {
    expect(mapXrayPriority("Highest")).toBe("CRITICAL");
    expect(mapXrayPriority("Blocker")).toBe("CRITICAL");
    expect(mapXrayPriority("high")).toBe("HIGH");
    expect(mapXrayPriority("Medium")).toBe("MEDIUM");
    expect(mapXrayPriority("Trivial")).toBe("LOW");
    expect(mapXrayPriority(undefined)).toBe("MEDIUM");
    expect(mapXrayPriority("P2 - weird")).toBe("MEDIUM");
  });
});
