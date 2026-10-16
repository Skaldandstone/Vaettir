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

  it("auto-maps vendor scenario descriptions while keeping modules and procedures separate", () => {
    for (const header of ["Description", "Scenario Description", "Scenario Description/Test Case", "Test Case Description", "Test Scenario"]) {
      const mapping = suggestCsvMapping([header, "Steps", "Expected Result"]);
      expect(mapping.title).toBe(header);
      expect(mapping.tags).toBeUndefined();
      expect(mapping).toMatchObject({ when: "Steps", then: "Expected Result" });
    }
    for (const header of ["Test Module/Scenario", "Test Module/Scenerio"]) {
      expect(suggestCsvMapping([header, "Steps", "Expected Result"]).title).toBeUndefined();
      expect(suggestCsvMapping([header, "Scenario Description/Test Case", "Steps", "Expected Result"])).toMatchObject({ title: "Scenario Description/Test Case", tags: header, when: "Steps", then: "Expected Result" });
    }
  });

  it("uses samples only to distinguish plausible headers and leaves genuine ties reviewable", () => {
    expect(suggestCsvMapping(["Title", "Test Case Name", "Steps"]).title).toBeUndefined();
    expect(suggestCsvMapping(["Title", "Steps", " Actions "]).when).toBeUndefined();
    expect(suggestCsvMapping(["Title", "Given", " Given "]).given).toBeUndefined();
    expect(suggestCsvMapping(["Title", "Test Case Name", "Steps"], [["", "Restore purchases", "Check balance"]]).title).toBe("Test Case Name");
    expect(suggestCsvMapping(["Title", "Test Scenario", "Steps"], [["Restore purchases", "Detailed scenario", "Check balance"]]).title).toBe("Title");
    expect(suggestCsvMapping(["Steps", "Expected Result"], [["Verify restoration", "Coins unchanged"]]).title).toBeUndefined();
    expect(suggestCsvMapping(["Description", "Owner", "Status"]).title).toBeUndefined();
  });

  it("honors human corrections to inferred roles while still rejecting reused source columns", () => {
    const csv = 'Title,Steps,Expected Result,Tags,Preconditions\nRestore purchases,Check balance,Coins unchanged,purchase,Installed\n';
    for (const mapping of [
      { title: "Steps", when: "Title" },
      { title: "Title", given: "Expected Result" },
      { title: "Title", when: "Tags" },
      { title: "Title", tags: "Expected Result" },
      { title: "Title", then: "Preconditions" },
    ]) expect(mapCsvRows(csv, mapping).rows).toHaveLength(1);
    expect(() => mapCsvRows(csv, { title: "Title", tags: "Title" })).toThrow("already mapped");
    expect(mapCsvRows(csv, { title: "Steps" }, undefined, [{ rowNumber: 2, title: "Reviewed title" }]).rows[0]?.title).toBe("Reviewed title");
    expect(mapCsvRows(csv, { title: "Steps", when: "Title" }).rows[0]).toMatchObject({ title: "Check balance", when: ["Restore purchases"] });
  });

  it("recognizes punctuation, camel-case vendor labels and optional field aliases", () => {
    expect(suggestCsvMapping(["TestCaseName", "Pre-requisites", "Steps to Reproduce", "Expected Output", "Test Case Type", "Execution Mode", "TCID"])).toMatchObject({ title: "TestCaseName", given: "Pre-requisites", when: "Steps to Reproduce", then: "Expected Output", testType: "Test Case Type", automationStatus: "Execution Mode", externalId: "TCID" });
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
        testType: "OTHER",
        automationStatus: "MANUAL",
        externalId: "TC-2",
      },
    ]);
  });

  it("identifies label/ID-only rows separately without dropping actual incomplete procedures", () => {
    const csv = 'ID,Title,Module,Steps,Expected,Other\nScenario 2: Renewal,,,,,\n,,Billing,,,\nTC-40,,,,,\nTC-41,,,Tap renew,,\nTC-42,,,,,Unmapped source detail\nTC-43,Renewal succeeds,Billing,Tap renew,Subscription renewed,\n';
    const mapping = { externalId: "ID", title: "Title", tags: "Module", when: "Steps", then: "Expected" };
    const result = mapCsvRows(csv, mapping);
    expect(result.nonCaseRows?.map(row => row.rowNumber)).toEqual([2, 3, 4]);
    expect(result.incompleteRows.map(row => row.rowNumber)).toEqual([5, 6]);
    expect(result.rows[0]).toMatchObject({ title: "Renewal succeeds", when: ["Tap renew"] });
    expect(result.skipped).toHaveLength(5);
    const included = mapCsvRows(csv, mapping, undefined, [{ rowNumber: 4, title: "Manually added case" }]);
    expect(included.rows.some(row => row.rowNumber === 4 && row.title === "Manually added case")).toBe(true);
    expect(included.nonCaseRows?.map(row => row.rowNumber)).toEqual([2, 3]);
  });

  it("proposes reversible row-layout corrections without changing normally populated columns", () => {
    const csv = 'Test Case ID,Test Module/Scenario,Scenario Description/Test Case,Pre-conditions,Test Steps,Expected\nTC-1,Verify purchase restoration,1. Reinstall. 2. Restore.,Entitlement is restored,,\nTC-2,Billing,Verify receipt,Logged in,Open receipt,Receipt shown\n';
    const mapping = suggestCsvMapping(inspectCsv(csv).headers);
    const result = mapCsvRows(csv, mapping);
    expect(result.rows[0]).toMatchObject({title: "Verify purchase restoration", tags: [], given: [], when: ["1. Reinstall. 2. Restore."], then: ["Entitlement is restored"]});
    expect(result.rows[1]).toMatchObject({title: "Verify receipt", tags: ["Billing"], given: ["Logged in"], when: ["Open receipt"], then: ["Receipt shown"]});
    expect(result.rowMappingSuggestions).toHaveLength(1);
    const original = result.rowMappingSuggestions![0]!.original;
    expect(original).toMatchObject({title: "1. Reinstall. 2. Restore.", tags: ["Verify purchase restoration"], given: ["Entitlement is restored"]});
    const kept = mapCsvRows(csv, mapping, undefined, [original]);
    expect(kept.rows[0]).toMatchObject(original);expect(kept.rowMappingSuggestions).toBeUndefined();
    const edited = mapCsvRows(csv, mapping, undefined, [{...result.rows[0]!, title: "Reviewed restore case"}]);
    expect(edited.rows[0]).toMatchObject({title: "Reviewed restore case", when: ["1. Reinstall. 2. Restore."]});
    expect(mapCsvRows(csv, {...mapping, tags: undefined}).rowMappingSuggestions).toBeUndefined();
  });

  it("uses corroborated alternate layouts for non-assertion titles, not isolated ambiguous categories", () => {
    const header = 'Test Case ID,Test Module/Scenario,Scenario Description/Test Case,Pre-conditions,Test Steps,Expected\n';
    const ambiguous = 'TC-4,Guest taps reward,Tap reward,Prompt appears,,\n';
    const mapping = suggestCsvMapping(inspectCsv(header + ambiguous).headers);
    expect(mapCsvRows(header + ambiguous, mapping).rowMappingSuggestions).toBeUndefined();
    const support = [1,2,3,5].map(id => `TC-${id},Verify reward ${id},Tap reward,Prompt appears,,\n`).join('');
    expect(mapCsvRows(header + support + ambiguous, mapping).rowMappingSuggestions).toHaveLength(5);
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

  it("does not pretend parsing can infer a type from feature keywords", () => {
    expect(
      inferTestCaseType({
        title: "DAU matches Mixpanel event tracking",
        tags: ["Analytics"],
      }),
    ).toBe("OTHER");
    expect(
      inferTestCaseType({ title: "API rejects unauthorized permissions" }),
    ).toBe("OTHER");
    expect(
      inferTestCaseType({ title: "Response time under concurrent load" }),
    ).toBe("OTHER");
    expect(
      inferTestCaseType({ title: "Screen reader announces the dialog" }),
    ).toBe("OTHER");
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

  it("automatically preserves section hierarchy and source notes without inventing cases or steps", () => {
    const csv = 'ID,Title,Steps,Expected\nWorkflow C: Reinstall,,,\nUC-S2.05: Restore purchase,,,\nBased on the recommendation below,,,\nTC-1,Verify restoration,Reinstall then restore,Balance unchanged\nTC_040,,,\n';
    const result = mapCsvRows(csv, { externalId: "ID", title: "Title", when: "Steps", then: "Expected" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ title: "Verify restoration", suitePath: "Workflow C: Reinstall / UC-S2.05: Restore purchase", background: "Based on the recommendation below", when: ["Reinstall then restore"], then: ["Balance unchanged"] });
    expect(result.nonCaseRows?.map(row => row.sourceRowKind)).toEqual(["SECTION", "SECTION", "NOTE", "PLACEHOLDER"]);
    expect(result.recommendations?.[0]?.reviewReasons).toContain("Section grouping was inferred from a preceding source heading.");
    const edited = mapCsvRows(csv, { externalId: "ID", title: "Title", when: "Steps", then: "Expected" }, undefined, [{ ...result.rows[0]!, suitePath: "Restoration", testType: "REGRESSION", typeOrigin: "REVIEWER" }]);
    expect(edited.rows[0]).toMatchObject({ suitePath: "Restoration", testType: "REGRESSION" });
    expect(edited.rows[0]?.reviewReasons?.length).toBeGreaterThan(0);
  });

  it("recommends types from effective corrected text, flags unrecognized values, and respects edits", () => {
    const csv = 'Test Case ID,Test Module/Scenario,Scenario Description/Test Case,Pre-conditions,Test Steps,Expected,Type\nTC-1,Verify keyboard navigation,Press Tab,Dialog focused,,,Unknown\n';
    const mapping = inspectCsv(csv).suggestedMapping;
    const result = mapCsvRows(csv, mapping);
    expect(result.rows[0]).toMatchObject({ title: "Verify keyboard navigation", when: ["Press Tab"], testType: "OTHER", typeOrigin: "UNCLASSIFIED" });
    expect(result.rows[0]?.typeRecommendation).toContain("full-definition AI review");
    expect(result.rows[0]?.reviewReasons?.join(" ")).toContain("Unrecognized source type");
    const edited = mapCsvRows(csv, mapping, undefined, [{ ...result.rows[0]!, testType: "FUNCTIONAL", typeOrigin: "REVIEWER" }]);
    expect(edited.rows[0]?.testType).toBe("FUNCTIONAL");
    expect(edited.recommendations).toHaveLength(1);
    const known = mapCsvRows('Title,Type\nVerify keyboard navigation,Smoke\n', { title: "Title", testType: "Type" });
    expect(known.rows[0]?.testType).toBe("SMOKE");
    expect(known.recommendations).toBeUndefined();
  });

  it("maps a descriptive assertion misplaced in an identity column as an incomplete-definition case for review", () => {
    const result = mapCsvRows('ID,Title,Steps\nVerify purchase restoration,,\n', { externalId: "ID", title: "Title", when: "Steps" });
    expect(result.rows[0]).toMatchObject({ title: "Verify purchase restoration", when: [], then: [] });
    expect(result.nonCaseRows).toBeUndefined();
    expect(result.rows[0]?.reviewReasons?.join(" ")).toContain("procedure is not recorded");
  });

  it("adding a source heading or note as a case never silently changes context on following cases", () => {
    const csv = 'ID,Title,Steps,Expected\nScenario 8: Restore purchase,,,\nNote: Account only,,,\nTC-1,Verify restoration,Restore,Coins retained\n';
    const mapping = { externalId: "ID", title: "Title", when: "Steps", then: "Expected" };
    const preview = mapCsvRows(csv, mapping);
    const edited = mapCsvRows(csv, mapping, undefined, [
      { ...preview.nonCaseRows![0]!, title: "Owner-added case" },
      { ...preview.nonCaseRows![1]!, title: "Owner-added note case" },
    ]);
    expect(edited.rows).toHaveLength(3);
    expect(edited.rows.find(row => row.externalId === "TC-1")).toEqual(preview.rows[0]);
    expect(edited.rows[0]?.title).toBe("Owner-added case");
  });
});
