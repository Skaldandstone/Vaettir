import type { ParsedXrayTest, XrayStep } from "./xrayImport.js";
import type { ZephyrConnection, ZephyrFolder, ZephyrTestCase } from "./zephyrClient.js";
import { fetchAllFolders, fetchAllPriorities, fetchAllTestCases, fetchTestSteps, fetchTestScript } from "./zephyrClient.js";

/**
 * P11-04: maps Zephyr Scale's folder tree + test cases onto the same
 * ParsedXrayTest shape TestRail's, Xray's, and qTest's importers already
 * produce, so this plugs into the same preview-row rendering
 * (toFilePreviewRow) and the same commitImportedTestCases write path.
 */

export type ParsedZephyrCase = ParsedXrayTest;

export interface ZephyrScanResult {
  cases: ParsedZephyrCase[];
  skipped: { rowNumber: number; reason: string }[];
}

// Builds "Parent > Child > Grandchild" suite paths keyed by folder id, same
// convention TestRail's/qTest's own folder/section trees already use.
export function buildFolderSuitePaths(folders: ZephyrFolder[]): Map<number, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const paths = new Map<number, string>();
  function pathFor(id: number): string {
    const cached = paths.get(id);
    if (cached !== undefined) return cached;
    const folder = byId.get(id);
    if (!folder) return "";
    const path = folder.parentId !== null && byId.has(folder.parentId) ? `${pathFor(folder.parentId)} > ${folder.name}` : folder.name;
    paths.set(id, path);
    return path;
  }
  for (const f of folders) pathFor(f.id);
  return paths;
}

// Zephyr's priority is a real project-scoped reference resource (id -> a
// name the project itself configured, e.g. "P1"/"Highest"/"Critical") -
// resolved via a separate /priorities lookup, then mapped tolerantly the
// same way every other importer here handles a project-specific priority
// scheme, defaulting to MEDIUM rather than guessing.
export function mapZephyrPriorityName(name: string | undefined): ParsedZephyrCase["priority"] {
  const p = (name ?? "").toLowerCase();
  if (!p) return "MEDIUM";
  if (p.includes("critical") || p.includes("highest") || p === "p1" || p.includes("blocker")) return "CRITICAL";
  if (p.includes("high") || p === "p2") return "HIGH";
  if (p.includes("low") || p.includes("lowest") || p === "p4" || p.includes("minor") || p.includes("trivial")) return "LOW";
  return "MEDIUM";
}

function mapStructuredSteps(steps: { inline?: { description?: string; testData?: string; expectedResult?: string } }[]): XrayStep[] {
  return steps
    .map((s) => s.inline)
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({ action: s.description ?? "", expectedActionOrData: s.testData ?? null, expectedResult: s.expectedResult ?? null }));
}

export interface MapZephyrArgs {
  testCase: ZephyrTestCase;
  rowNumber: number;
  suitePath: string | null;
  priorityName: string | undefined;
  steps: XrayStep[];
  // Present only when the case has no structured steps - Zephyr's "Plain
  // Text" or "BDD" script type, a single free-form text block rather than
  // step rows. Kept as raw lines rather than parsed as Gherkin: a BDD-type
  // script's exact wrapping (a bare scenario body vs. a full Feature/
  // Scenario document) isn't confirmed against a real instance, and a
  // wrong parse would be worse than an honest raw line dump.
  scriptText?: string | null;
}

export function mapZephyrTestCase(args: MapZephyrArgs): ParsedZephyrCase {
  const { testCase, rowNumber, suitePath, priorityName, steps, scriptText } = args;
  const given = testCase.precondition ? [testCase.precondition] : [];
  let when: string[];
  let then: string[];
  if (steps.length > 0) {
    when = steps.map((s) => s.action).filter(Boolean);
    then = steps.map((s) => s.expectedResult).filter((s): s is string => Boolean(s));
  } else if (scriptText) {
    when = scriptText.split("\n").map((l) => l.trim()).filter(Boolean);
    then = [];
  } else if (testCase.objective) {
    when = [testCase.objective];
    then = [];
  } else {
    when = [];
    then = [];
  }

  return {
    rowNumber,
    key: testCase.key,
    title: testCase.name,
    testType: "Manual",
    priority: mapZephyrPriorityName(priorityName),
    tags: [],
    suitePath,
    background: null,
    given,
    when,
    then,
    steps,
  };
}

// Walks every test case in a Zephyr Scale project - a live network
// operation (no static file export exists for this data). Fetches the
// project's priorities and folders once up front (small, whole-project
// lookups) rather than once per test case, then one steps-or-script
// fetch per case, since Zephyr doesn't embed either in the list response.
export async function scanZephyrProject(conn: ZephyrConnection, projectKey: string): Promise<ZephyrScanResult> {
  const [priorities, folders, testCases] = await Promise.all([
    fetchAllPriorities(conn, projectKey),
    fetchAllFolders(conn, projectKey),
    fetchAllTestCases(conn, projectKey),
  ]);
  const priorityNameById = new Map(priorities.map((p): [number, string] => [p.id, p.name]));
  const suitePaths = buildFolderSuitePaths(folders);

  const cases: ParsedZephyrCase[] = [];
  const skipped: { rowNumber: number; reason: string }[] = [];
  let rowNumber = 0;

  for (const tc of testCases) {
    rowNumber += 1;
    if (!tc.name?.trim()) {
      skipped.push({ rowNumber, reason: "missing test case name" });
      continue;
    }
    const rawSteps = await fetchTestSteps(conn, tc.key);
    const steps = mapStructuredSteps(rawSteps);
    // Only fetch the script when there are no structured steps - a case
    // has one or the other, never both, so this is one extra request at
    // most per case, never two wasted ones.
    const scriptText = steps.length === 0 ? ((await fetchTestScript(conn, tc.key))?.text ?? null) : null;

    cases.push(
      mapZephyrTestCase({
        testCase: tc,
        rowNumber,
        suitePath: tc.folder ? (suitePaths.get(tc.folder.id) ?? null) : null,
        priorityName: tc.priority ? priorityNameById.get(tc.priority.id) : undefined,
        steps,
        scriptText,
      }),
    );
  }

  return { cases, skipped };
}
