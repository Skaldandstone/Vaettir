import { describe, it, expect } from "vitest";
import { parseTestCaseCsv } from "./testCaseCsvImport.js";

describe("parseTestCaseCsv", () => {
  it("parses a well-formed CSV with all recognized columns", () => {
    const csv = [
      "title,given,when,then,priority,tags",
      '"Login succeeds","a registered user","they submit valid credentials","they reach the dashboard",HIGH,"auth|smoke"',
    ].join("\n");
    const { cases, skipped } = parseTestCaseCsv(csv);
    expect(skipped).toHaveLength(0);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      title: "Login succeeds",
      given: ["a registered user"],
      when: ["they submit valid credentials"],
      then: ["they reach the dashboard"],
      priority: "HIGH",
      tags: ["auth", "smoke"],
    });
  });

  it("splits multi-step cells on the pipe delimiter", () => {
    const csv = ['title,given,when,then', '"Multi-step","a|b","c","d"'].join("\n");
    expect(parseTestCaseCsv(csv).cases[0]!.given).toEqual(["a", "b"]);
  });

  it("defaults priority to MEDIUM when the column is missing or invalid", () => {
    const csv = ['title,given,when,then', '"No priority","g","w","t"'].join("\n");
    expect(parseTestCaseCsv(csv).cases[0]!.priority).toBe("MEDIUM");

    const csvInvalid = ['title,given,when,then,priority', '"Bad priority","g","w","t","not-a-real-priority"'].join("\n");
    expect(parseTestCaseCsv(csvInvalid).cases[0]!.priority).toBe("MEDIUM");
  });

  it("throws when there's no title column at all", () => {
    const csv = ["name,description", "foo,bar"].join("\n");
    expect(() => parseTestCaseCsv(csv)).toThrow('must have a header row');
  });

  it("skips a row with no title, recording the row number and reason", () => {
    const csv = ['title,given,when,then', '"","g","w","t"'].join("\n");
    const { cases, skipped } = parseTestCaseCsv(csv);
    expect(cases).toHaveLength(0);
    expect(skipped).toEqual([{ rowNumber: 2, reason: "missing title" }]);
  });

  it("skips a row missing given/when/then, with the correct 1-indexed row number", () => {
    const csv = ["title,given,when,then", '"Has title only","","",""', '"Second bad row","g","",""'].join("\n");
    const { cases, skipped } = parseTestCaseCsv(csv);
    expect(cases).toHaveLength(0);
    expect(skipped.map((s) => s.rowNumber)).toEqual([2, 3]);
  });

  it("returns nothing for an empty or header-only CSV", () => {
    expect(parseTestCaseCsv("").cases).toHaveLength(0);
    expect(parseTestCaseCsv("title,given,when,then").cases).toHaveLength(0);
  });
});
