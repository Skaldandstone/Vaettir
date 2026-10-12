import { describe, expect, it } from "vitest";
import { inferTestCaseType, inspectCsv, mapCsvRows, suggestCsvMapping } from "./csvFieldMapping.js";

const CSV = `Id,Title,Preconditions,Steps,Expected,Priority,Tags
TC-1,Login succeeds,Account exists,Open login|Choose OAuth,Dashboard opens,High,auth|smoke
TC-2,,Guest session,Open pricing,Plans are shown,Medium,billing
`;

const MAPPING = {
  externalId: "Id",
  title: "Title",
  given: "Preconditions",
  when: "Steps",
  then: "Expected",
  priority: "Priority",
  tags: "Tags",
};

describe("mapped CSV row repair", () => {
  it("maps explicit case names, actions, expected behavior, and tags to distinct roles", () => {
    const mapping = suggestCsvMapping(["Test_Case_Name", "Step Action", "Expected Behavior", "Tags"]);
    expect(mapping).toEqual({ title: "Test_Case_Name", when: "Step Action", then: "Expected Behavior", tags: "Tags" });
    const row = mapCsvRows('Test_Case_Name,Step Action,Expected Behavior,Tags\nPurchase restoration,Reinstall then check balance,Consumed coins are not restored,purchases\n', mapping).rows[0];
    expect(row).toMatchObject({ title: "Purchase restoration", given: [], when: ["Reinstall then check balance"], then: ["Consumed coins are not restored"], tags: ["purchases"] });
  });

  it("leaves ambiguous vendor prose and combined module/scenario columns for explicit review", () => {
    for (const header of ["Description", "Scenario Description", "Scenario Description/Test Case", "Test Case Description", "Test Scenario", "Test Module/Scenario", "Test Module/Scenerio"]) {
      const mapping = suggestCsvMapping([header, "Steps", "Expected Result"]);
      expect(mapping.title).toBeUndefined();
      expect(mapping.tags).toBeUndefined();
      expect(mapping).toMatchObject({ when: "Steps", then: "Expected Result" });
    }
    expect(suggestCsvMapping(["Title", "Test Case Name", "Steps"]).title).toBeUndefined();
    expect(suggestCsvMapping(["Title", "Steps", " Actions "]).when).toBeUndefined();
    expect(suggestCsvMapping(["Title", "Given", " Given "]).given).toBeUndefined();
  });

  it("rejects cross-mapping recognized fields and reused source columns before preview or commit", () => {
    const csv = 'Title,Steps,Expected Result,Tags,Preconditions\nRestore purchases,Check balance,Coins unchanged,purchase,Installed\n';
    for (const mapping of [
      { title: "Steps", when: "Title" },
      { title: "Title", given: "Expected Result" },
      { title: "Title", when: "Tags" },
      { title: "Title", tags: "Expected Result" },
      { title: "Title", then: "Preconditions" },
    ]) expect(() => mapCsvRows(csv, mapping)).toThrow("review the column mapping");
    expect(() => mapCsvRows(csv, { title: "Title", tags: "Title" })).toThrow("already mapped");
    expect(() => mapCsvRows(csv, { title: "Steps" }, undefined, [{ rowNumber: 2, title: "Reviewed title" }])).toThrow("recognized as");
  });

  it("allows an explicitly reviewed custom title header without guessing actions or tags from content", () => {
    const csv = 'Reviewed purpose,Steps,Expected Result\nVerify purchase restoration,Check balance,Coins unchanged\n';
    const row = mapCsvRows(csv, { title: "Reviewed purpose", when: "Steps", then: "Expected Result" }).rows[0];
    expect(row).toMatchObject({ title: "Verify purchase restoration", given: [], when: ["Check balance"], then: ["Coins unchanged"], tags: [] });
  });
  it("retains exact multiline procedure prose, numbering, indentation, pipes, and non-Gherkin text", () => {
    const actions = '1. After reinstall, open the app.\r\n\r\n  2. Check the coin balance.\nPayload: a|b';
    const expected = 'Coins remain consumed.2. Server does not restore consumables.\n  Balance = 0';
    const setup = 'Signed in\n\n  Original purchase consumed';
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = `Test Case Name,Preconditions,Actions,Expected Result,Tags\n${["Purchase restoration", setup, actions, expected, "purchase|coins"].map(quote).join(",")}\n`;
    const row = mapCsvRows(csv, inspectCsv(csv).suggestedMapping).rows[0];
    expect(row).toMatchObject({ title: "Purchase restoration", given: [setup], when: [actions], then: [expected], tags: ["purchase", "coins"] });
  });
  it("uses the same trimmed header identity in inspection and commit, preserving all BDD phases", () => {
    const csv = 'Title, Given ,"When\n",Then\nDelete own comment,Signed in as comment owner,Choose Delete,Comment removed\n';
    const mapping = inspectCsv(csv).suggestedMapping;
    expect(mapping).toMatchObject({ given: "Given", when: "When", then: "Then" });
    expect(mapCsvRows(csv, mapping).rows[0]).toMatchObject({
      given: ["Signed in as comment owner"],
      when: ["Choose Delete"],
      then: ["Comment removed"],
    });
  });

  it("rejects stale or ambiguous confirmed columns instead of silently omitting imported steps", () => {
    expect(() => mapCsvRows('Title,Then\nDelete comment,Removed\n', {
      title: "Title", given: "Preconditions", then: "Then",
    })).toThrow('mapped "given" column was not found');
    expect(() => mapCsvRows('Title,Given, Given ,Then\nDelete comment,A,B,Removed\n', {
      title: "Title", given: "Given", then: "Then",
    })).toThrow('mapped "given" column is ambiguous');
  });

  it("retains incomplete source rows with their mapped fields", () => {
    const result = mapCsvRows(CSV, MAPPING);

    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toEqual([{ rowNumber: 3, reason: "missing title" }]);
    expect(result.incompleteRows).toEqual([
      {
        rowNumber: 3,
        title: "",
        given: ["Guest session"],
        when: ["Open pricing"],
        then: ["Plans are shown"],
        priority: "MEDIUM",
        tags: ["billing"],
        testType: "FUNCTIONAL",
        automationStatus: "MANUAL",
        externalId: "TC-2",
      },
    ]);
  });

  it("applies reviewed row edits instead of dropping the source row", () => {
    const result = mapCsvRows(CSV, MAPPING, undefined, [
      {
        rowNumber: 3,
        title: "Pricing is visible to guests",
        when: ["Open the pricing page", "Review available plans"],
      },
    ]);

    expect(result.skipped).toEqual([]);
    expect(result.incompleteRows).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toMatchObject({
      rowNumber: 3,
      title: "Pricing is visible to guests",
      given: ["Guest session"],
      when: ["Open the pricing page", "Review available plans"],
      then: ["Plans are shown"],
      externalId: "TC-2",
    });
  });

  it("infers useful test types instead of flattening imports to functional", () => {
    expect(
      inferTestCaseType({
        title: "DAU matches Mixpanel event tracking",
        tags: ["Analytics"],
      }),
    ).toBe("INSTRUMENTATION");
    expect(
      inferTestCaseType({ title: "API rejects unauthorized permissions" }),
    ).toBe("SECURITY");
    expect(
      inferTestCaseType({ title: "Response time under concurrent load" }),
    ).toBe("PERFORMANCE");
    expect(
      inferTestCaseType({ title: "Screen reader announces the dialog" }),
    ).toBe("ACCESSIBILITY");
  });

  it("honors explicit type and automation columns over inference", () => {
    const csv = `Title,Type,Automation\nAPI health endpoint responds,Smoke,Automated\n`;
    const result = mapCsvRows(csv, {
      title: "Title",
      testType: "Type",
      automationStatus: "Automation",
    });
    expect(result.rows[0]).toMatchObject({
      testType: "SMOKE",
      automationStatus: "AUTOMATED",
    });
  });
});
