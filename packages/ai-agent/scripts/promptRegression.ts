// P2-10: a fixed set of sample test files (one per common framework) with
// loose structural expectations, run against the REAL reverseEngineerTestFile
// to catch a system-prompt regression before it ships. Deliberately NOT a
// vitest .test.ts file and NOT part of the default `pnpm test` -- every run
// costs a real Claude API call per fixture, and LLM output isn't stable
// enough for exact snapshot assertions, so this checks structural/content
// signals (case count in range, non-empty BDD steps, expected keywords
// present somewhere in the extracted case) rather than byte-for-byte output.
// Run manually via `npx tsx scripts/promptRegression.ts` after touching the
// reverse-engineering system prompt.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { reverseEngineerTestFile } from "../src/reverseEngineer.js";
import { detectFramework } from "@vaettir/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

interface Fixture {
  file: string;
  expectFrameworkNotCustom: boolean;
  expectCaseCountRange: [number, number];
  // At least one extracted case's title/given/when/then must contain each
  // of these (case-insensitive) -- a loose proxy for "the extraction
  // actually understood what this test does," not an exact-text match.
  expectKeywordsSomewhere: string[];
}

const FIXTURES: Fixture[] = [
  {
    file: "login.test.js",
    expectFrameworkNotCustom: true,
    expectCaseCountRange: [3, 3],
    expectKeywordsSomewhere: ["lock", "credential"],
  },
  {
    file: "test_checkout.py",
    expectFrameworkNotCustom: true,
    expectCaseCountRange: [3, 3],
    expectKeywordsSomewhere: ["discount", "empty"],
  },
  {
    file: "OrderServiceTest.java",
    expectFrameworkNotCustom: true,
    expectCaseCountRange: [2, 2],
    expectKeywordsSomewhere: ["stock"],
  },
];

function caseText(tc: { title: string; given: string[]; when: string[]; then: string[] }): string {
  return [tc.title, ...tc.given, ...tc.when, ...tc.then].join(" ").toLowerCase();
}

async function runFixture(fixture: Fixture): Promise<{ pass: boolean; issues: string[] }> {
  const issues: string[] = [];
  const content = readFileSync(join(fixturesDir, fixture.file), "utf8");

  const heuristic = detectFramework(fixture.file, content);
  if (fixture.expectFrameworkNotCustom && heuristic.family === "CUSTOM") {
    issues.push(`expected a known framework to be detected, got CUSTOM`);
  }

  const result = await reverseEngineerTestFile({ filePath: fixture.file, content });
  const [min, max] = fixture.expectCaseCountRange;
  if (result.testCases.length < min || result.testCases.length > max) {
    issues.push(`expected ${min}-${max} test cases, got ${result.testCases.length}`);
  }

  for (const tc of result.testCases) {
    if (tc.given.length === 0 || tc.when.length === 0 || tc.then.length === 0) {
      issues.push(`case "${tc.title}" has an empty given/when/then step`);
    }
  }

  const allText = result.testCases.map(caseText).join(" ");
  for (const keyword of fixture.expectKeywordsSomewhere) {
    if (!allText.includes(keyword.toLowerCase())) {
      issues.push(`expected keyword "${keyword}" to appear somewhere in the extracted cases, not found`);
    }
  }

  return { pass: issues.length === 0, issues };
}

async function main() {
  let anyFailed = false;
  for (const fixture of FIXTURES) {
    process.stdout.write(`${fixture.file} ... `);
    try {
      const { pass, issues } = await runFixture(fixture);
      if (pass) {
        console.log("PASS");
      } else {
        anyFailed = true;
        console.log("FAIL");
        for (const issue of issues) console.log(`  - ${issue}`);
      }
    } catch (e) {
      anyFailed = true;
      console.log("ERROR");
      console.log(`  - ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (anyFailed) process.exit(1);
}

void main();
