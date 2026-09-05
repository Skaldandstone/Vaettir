import type { ReverseEngineerResult, ReverseEngineeredTestCase } from "./bdd.js";

// P2-13: Gherkin/.feature files are already BDD -- this validates and
// normalizes into the schema rather than inferring anything, so it's a
// plain parser, not an LLM call. Returns the same ReverseEngineerResult
// shape the AI agent produces, so it can flow through the exact same
// persist path (see reverseEngineerPersist.ts's `origin` param).
//
// Supports the common subset: Feature-level and Scenario-level tags,
// Background (folded into every scenario's `given`), Scenario, Scenario
// Outline + one Examples table (expanded into one case per row, with
// `<placeholder>` substitution in every step), and the standard
// Given/When/Then/And/But step keywords (And/But continue whichever
// section came before them). Not supported: multiple Examples blocks per
// outline, data tables or doc strings attached to individual steps, and
// Rule: blocks -- none of those are common enough in practice to be worth
// the added parser complexity for a first pass.

type StepKeyword = "given" | "when" | "then";

interface ParsedScenario {
  title: string;
  tags: string[];
  given: string[];
  when: string[];
  then: string[];
  isOutline: boolean;
  exampleHeader?: string[];
  exampleRows?: string[][];
}

function stripComment(line: string): string {
  const idx = line.indexOf("#");
  return idx === -1 ? line : line.slice(0, idx);
}

function parseTags(line: string): string[] {
  return line
    .trim()
    .split(/\s+/)
    .filter((t) => t.startsWith("@"))
    .map((t) => t.slice(1));
}

function substitutePlaceholders(text: string, row: string[], header: string[]): string {
  return text.replace(/<([^<>]+)>/g, (match, name) => {
    const idx = header.indexOf(name.trim());
    return idx === -1 ? match : (row[idx] ?? match);
  });
}

export function parseGherkin(content: string): { featureTitle: string; scenarios: ParsedScenario[] } {
  const lines = content.split("\n").map(stripComment);

  let featureTitle = "Untitled feature";
  const background: { keyword: StepKeyword; text: string }[] = [];
  const scenarios: ParsedScenario[] = [];

  let pendingTags: string[] = [];
  let section: "none" | "background" | "scenario" | "examples" = "none";
  let current: (ParsedScenario & { lastKeyword?: StepKeyword }) | null = null;
  let exampleTableRows: string[][] = [];

  function pushCurrentScenario() {
    if (!current) return;
    if (section === "examples" && exampleTableRows.length > 0) {
      current.exampleHeader = exampleTableRows[0];
      current.exampleRows = exampleTableRows.slice(1);
    }
    scenarios.push(current);
    current = null;
    exampleTableRows = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("@")) {
      pendingTags.push(...parseTags(line));
      continue;
    }

    // No \s* before the capture: it overlapped with (.*) on the same
    // whitespace, a polynomial-ReDoS shape CodeQL flagged. The capture is
    // already .trim()'d below, so the separator doesn't need its own match.
    const featureMatch = /^Feature:(.*)$/.exec(line);
    if (featureMatch) {
      featureTitle = (featureMatch[1] ?? "").trim() || featureTitle;
      pendingTags = [];
      continue;
    }

    if (/^Background:/.test(line)) {
      pushCurrentScenario();
      section = "background";
      pendingTags = [];
      continue;
    }

    // Same ReDoS shape as Feature: above - no \s* before the capture.
    const scenarioMatch = /^Scenario(?: Outline)?:(.*)$/.exec(line);
    if (scenarioMatch) {
      pushCurrentScenario();
      section = "scenario";
      current = {
        title: (scenarioMatch[1] ?? "").trim() || "Untitled scenario",
        tags: pendingTags,
        given: [],
        when: [],
        then: [],
        isOutline: /^Scenario Outline:/.test(line),
      };
      pendingTags = [];
      continue;
    }

    if (/^Examples:/.test(line)) {
      section = "examples";
      exampleTableRows = [];
      continue;
    }

    if (line.startsWith("|")) {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      if (section === "examples") exampleTableRows.push(cells);
      continue;
    }

    // A single \s, not \s+, before (.*): \s+ overlapped with the capture on
    // the same whitespace, the same polynomial-ReDoS shape as Feature/Scenario
    // above. .trim() below recovers the "keyword plus multiple spaces" case
    // \s+ used to absorb outright.
    const stepMatch = /^(Given|When|Then|And|But)\s(.*)$/.exec(line);
    if (stepMatch) {
      const rawKeyword = stepMatch[1];
      const text = stepMatch[2]?.trim();
      if (!rawKeyword || text === undefined) continue;
      const explicit = rawKeyword.toLowerCase() as "given" | "when" | "then" | "and" | "but";
      const target = section === "background" ? { lastKeyword: undefined as StepKeyword | undefined } : current;
      if (!target) continue;

      let keyword: StepKeyword;
      if (explicit === "and" || explicit === "but") {
        keyword = target.lastKeyword ?? "given";
      } else {
        keyword = explicit;
      }
      target.lastKeyword = keyword;

      if (section === "background") {
        background.push({ keyword, text });
      } else if (current) {
        current[keyword].push(text);
      }
      continue;
    }
  }
  pushCurrentScenario();

  // Fold Background's given/when/then onto the front of every scenario's
  // own steps -- a Background is shared setup, so it belongs first in
  // whichever section it was written under, not bolted on separately.
  for (const s of scenarios) {
    if (background.length === 0) continue;
    s.given = [...background.filter((b) => b.keyword === "given").map((b) => b.text), ...s.given];
    s.when = [...background.filter((b) => b.keyword === "when").map((b) => b.text), ...s.when];
    s.then = [...background.filter((b) => b.keyword === "then").map((b) => b.text), ...s.then];
  }

  return { featureTitle, scenarios };
}

export function gherkinToReverseEngineerResult(content: string): ReverseEngineerResult {
  const { scenarios } = parseGherkin(content);
  const testCases: ReverseEngineeredTestCase[] = [];

  for (const s of scenarios) {
    if (s.isOutline && s.exampleHeader && s.exampleRows && s.exampleRows.length > 0) {
      s.exampleRows.forEach((row, i) => {
        const sub = (steps: string[]) => steps.map((step) => substitutePlaceholders(step, row, s.exampleHeader!));
        testCases.push({
          title: `${s.title} (example ${i + 1}: ${s.exampleHeader!.map((h, j) => `${h}=${row[j] ?? ""}`).join(", ")})`,
          background: null,
          given: sub(s.given),
          when: sub(s.when),
          then: sub(s.then),
          tags: s.tags,
          testType: "FUNCTIONAL",
          confidence: 1,
          sourceFunctionName: s.title,
          notes: null,
        });
      });
      continue;
    }
    if (s.given.length === 0 || s.when.length === 0 || s.then.length === 0) continue; // not a usable case
    testCases.push({
      title: s.title,
      background: null,
      given: s.given,
      when: s.when,
      then: s.then,
      tags: s.tags,
      testType: "FUNCTIONAL",
      confidence: 1,
      sourceFunctionName: s.title,
      notes: null,
    });
  }

  return { detectedFramework: "gherkin", detectedFrameworkFamily: "CUSTOM", testCases };
}
