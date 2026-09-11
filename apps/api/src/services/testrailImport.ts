import { XMLParser } from "fast-xml-parser";
import type { ParsedXrayTest } from "./xrayImport.js";

// P11-03 (file-based slice): TestRail's built-in "Export to XML" of a test
// suite (Test Cases → Export → XML). The ticket's full scope is the REST
// API (cases/suites/sections + runs/results); no TestRail instance or API
// key exists in this environment, so this covers the half a customer can
// hand over as a file: the suite → section tree → cases with their
// templates. Runs/results stay on the REST-API half (and most TestRail
// automation results already arrive as JUnit, which Phase 5 ingests).
//
// Shape (from TestRail's documented export):
//   <suite><name/><description/><sections><section><name/><description/>
//     <cases><case><id>C123</id><title/><template/><type/><priority/>
//       <estimate/><references/><custom>
//         <preconds/>                                  (all templates)
//         <steps/><expected/>                          (Test Case (Text))
//         <steps_separated><step><index/><content/><expected/></step>…   (Test Case (Steps))
//         <mission/><goals/>                           (Exploratory Session)
//       </custom></case></cases>
//     <sections>…nested…</sections></section></sections></suite>
//
// Fixtures in testrailImport.test.ts are constructed from that
// documentation, not captured from a live instance - hence the tolerant
// handling of optional/single/array nodes below.

export type ParsedTestRailCase = ParsedXrayTest;

export interface TestRailParseResult {
  format: "testrail-xml";
  suiteName: string | null;
  cases: ParsedTestRailCase[];
  skipped: { rowNumber: number; reason: string }[];
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", trimValues: true });

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const t = (value as Record<string, unknown>)["#text"];
    return typeof t === "string" ? t.trim() || null : typeof t === "number" ? String(t) : null;
  }
  return null;
}

// TestRail's default priorities are Critical/High/Medium/Low; older
// installs used "1 - Don't Test" … "4 - Must Test" and custom names exist.
export function mapTestRailPriority(raw: string | null): ParsedTestRailCase["priority"] {
  const p = (raw ?? "").trim().toLowerCase();
  if (!p) return "MEDIUM";
  if (p.includes("critical") || p.includes("must test") || p.startsWith("4")) return "CRITICAL";
  if (p.includes("high") || p.includes("test if time") || p.startsWith("3")) return "HIGH";
  if (p.includes("low") || p.includes("don't test") || p.includes("dont test") || p.startsWith("1")) return "LOW";
  return "MEDIUM";
}

// Free-text step fields in TestRail are commonly numbered lines ("1. Open
// the page"), one step per line/paragraph. Split on blank lines or
// numbered-line boundaries; a single unnumbered paragraph stays one step.
function splitFreeText(value: string | null): string[] {
  if (!value) return [];
  const lines = value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const numbered = lines.filter((l) => /^\d+[.)]\s+/.test(l)).length;
  if (numbered >= 2 && numbered >= lines.length / 2) {
    return lines.map((l) => l.replace(/^\d+[.)]\s+/, ""));
  }
  return value
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

interface Ctx {
  cases: ParsedTestRailCase[];
  skipped: { rowNumber: number; reason: string }[];
  counter: number;
}

function walkSection(node: Record<string, unknown>, path: string[], ctx: Ctx): void {
  const name = text(node.name);
  const here = name ? [...path, name] : path;
  const casesNode = node.cases as Record<string, unknown> | undefined;
  for (const c of asArray(casesNode?.case as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    ctx.counter += 1;
    const rowNumber = ctx.counter;
    const title = text(c.title);
    if (!title) {
      ctx.skipped.push({ rowNumber, reason: "Case has no title" });
      continue;
    }
    const custom = (c.custom ?? {}) as Record<string, unknown>;
    const preconds = text(custom.preconds);
    const separated = asArray(
      ((custom.steps_separated as Record<string, unknown> | undefined)?.step ?? undefined) as
        | Record<string, unknown>
        | Record<string, unknown>[]
        | undefined,
    );
    const steps = separated
      .map((s) => ({
        action: text(s.content) ?? "",
        expectedActionOrData: null,
        expectedResult: text(s.expected),
      }))
      .filter((s) => s.action.length > 0);

    let when: string[];
    let then: string[];
    if (steps.length > 0) {
      when = steps.map((s) => s.action);
      then = steps.map((s) => s.expectedResult).filter((s): s is string => Boolean(s));
    } else {
      const mission = text(custom.mission);
      const goals = text(custom.goals);
      when = mission ? [mission] : splitFreeText(text(custom.steps));
      then = goals ? splitFreeText(goals) : splitFreeText(text(custom.expected));
    }
    if (when.length === 0 && then.length === 0) {
      ctx.skipped.push({ rowNumber, reason: `"${title}" has no steps, expected result, mission or goals` });
      continue;
    }

    const references = text(c.references);
    const id = text(c.id) ?? `case-${rowNumber}`;
    ctx.cases.push({
      rowNumber,
      key: id,
      title,
      testType: text(c.template) ?? text(c.type) ?? "Test Case",
      priority: mapTestRailPriority(text(c.priority)),
      tags: references ? references.split(/[,\s]+/).map((r) => r.trim()).filter(Boolean) : [],
      suitePath: here.length > 0 ? here.join("/") : null,
      background: null,
      given: preconds ? splitFreeText(preconds) : [],
      when,
      then,
      steps,
    });
  }
  const sectionsNode = node.sections as Record<string, unknown> | undefined;
  for (const sub of asArray(sectionsNode?.section as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    walkSection(sub, here, ctx);
  }
}

export function parseTestRailXml(xml: string): TestRailParseResult {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`TestRail XML could not be parsed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  const suite = doc.suite as Record<string, unknown> | undefined;
  if (!suite || typeof suite !== "object") {
    throw new Error('Not a TestRail XML export: no <suite> root element (use Test Cases → Export → XML)');
  }
  const ctx: Ctx = { cases: [], skipped: [], counter: 0 };
  const suiteName = text(suite.name);
  // The suite name is the top of the path; TestRail's default single suite
  // is literally named "Master", which nobody wants prefixed on every
  // case's suite path.
  const root = suiteName && suiteName.toLowerCase() !== "master" ? [suiteName] : [];
  walkSection({ sections: suite.sections, cases: suite.cases }, root, ctx);
  return { format: "testrail-xml", suiteName, cases: ctx.cases, skipped: ctx.skipped };
}
