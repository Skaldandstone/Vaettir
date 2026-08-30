import { describe, expect, it } from "vitest";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { parseJUnitXml } from "./junitParse";
import { parseCoberturaXml, parseJacocoXml } from "./coverageParse";

describe("fast-xml-parser upgrade compatibility", () => {
  it("preserves JUnit attributes, empty statuses, CDATA and numeric-looking names", () => {
    const cases = parseJUnitXml(`<testsuites><testsuite>
      <testcase classname="suite" name="001" time="0.025" file="tests/a.test.ts" />
      <testcase name="failure"><failure message="expected &lt; true"><![CDATA[detail <x>]]></failure></testcase>
      <testcase name="skip"><skipped /></testcase>
      <testcase name="error"><error><![CDATA[stack <trace>]]></error></testcase>
    </testsuite></testsuites>`);
    expect(cases).toEqual([
      { externalTestId: "suite::001", status: "PASS", durationMs: 25, errorMessage: null, externalFilePath: "tests/a.test.ts" },
      { externalTestId: "failure", status: "FAIL", durationMs: null, errorMessage: "expected < true", externalFilePath: null },
      { externalTestId: "skip", status: "SKIP", durationMs: null, errorMessage: null, externalFilePath: null },
      { externalTestId: "error", status: "FAIL", durationMs: null, errorMessage: "stack <trace>", externalFilePath: null },
    ]);
  });

  it("preserves singleton JUnit and absent roots", () => {
    expect(parseJUnitXml('<testsuite><testcase name="single" /></testsuite>')).toHaveLength(1);
    expect(parseJUnitXml("<unrelated />")).toEqual([]);
  });

  it("preserves Cobertura line and branch counts", () => {
    expect(parseCoberturaXml(`<coverage><packages><package><classes><class filename="src/a.ts"><lines>
      <line number="1" hits="2" condition-coverage="50% (1/2)" /><line number="2" hits="0" />
    </lines></class></classes></package></packages></coverage>`)).toEqual({
      linesCovered: 1, linesTotal: 2, branchesCovered: 1, branchesTotal: 2,
      files: [{ filePath: "src/a.ts", linesCovered: 1, linesTotal: 2, branchesCovered: 1, branchesTotal: 2 }],
    });
  });

  it("preserves JaCoCo's DOCTYPE, package paths and counters", () => {
    const result = parseJacocoXml(`<?xml version="1.0"?><!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd">
      <report><package name="org/example"><sourcefile name="Main.java">
        <counter type="LINE" covered="8" missed="2" /><counter type="BRANCH" covered="3" missed="1" />
      </sourcefile></package></report>`);
    expect(result.files).toEqual([{ filePath: "org/example/Main.java", linesCovered: 8, linesTotal: 10, branchesCovered: 3, branchesTotal: 4 }]);
  });

  it("does not fetch external entity contents", () => {
    expect(() => parseJUnitXml('<!DOCTYPE testsuite [<!ENTITY external SYSTEM "file:///vaettir-must-not-read">]><testsuite><testcase name="&external;" /></testsuite>')).toThrow("External entities are not supported");
  });

  it("retains explicit malformed XML validation and bounded entity support", () => {
    expect(XMLValidator.validate("<testsuite><testcase></testsuite>")).not.toBe(true);
    const parser = new XMLParser({ processEntities: { maxEntityCount: 2 } });
    expect(() => parser.parse('<!DOCTYPE r [<!ENTITY a "one"><!ENTITY b "two"><!ENTITY c "three">]><r>&a;</r>')).toThrow("exceeds maximum allowed");
  });
});
