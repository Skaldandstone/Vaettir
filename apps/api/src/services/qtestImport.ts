import type { ParsedXrayTest, XrayStep } from "./xrayImport.js";
import type { QTestConnection, QTestModule, QTestProperty, QTestTestCase } from "./qtestClient.js";
import { fetchAllModules, fetchTestCasesInModule } from "./qtestClient.js";

/**
 * P11-06: maps qTest's module tree + test cases onto the exact same
 * ParsedXrayTest shape TestRail's and Xray's importers already produce, so
 * this plugs into the same preview-row rendering (toFilePreviewRow) and the
 * same commitImportedTestCases write path with zero new plumbing.
 */

export type ParsedQTestCase = ParsedXrayTest;

export interface QTestScanResult {
  cases: ParsedQTestCase[];
  skipped: { rowNumber: number; reason: string }[];
}

// Builds "Parent > Child > Grandchild" suite paths keyed by module id, the
// same convention TestRail's section tree already uses.
export function buildModuleSuitePaths(modules: QTestModule[]): Map<number, string> {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const paths = new Map<number, string>();
  function pathFor(moduleId: number): string {
    const cached = paths.get(moduleId);
    if (cached !== undefined) return cached;
    const mod = byId.get(moduleId);
    if (!mod) return "";
    const path = mod.parent_id !== null && byId.has(mod.parent_id) ? `${pathFor(mod.parent_id)} > ${mod.name}` : mod.name;
    paths.set(moduleId, path);
    return path;
  }
  for (const m of modules) pathFor(m.id);
  return paths;
}

// qTest priority is a customer-defined custom field (a Property), not a
// fixed top-level field - conventionally named "Priority" with values like
// "P1"/"Critical"/"High"/etc, but never guaranteed. Tolerant, case-
// insensitive matching, same posture as TestRail's own priority mapper;
// defaults to MEDIUM when no priority-shaped property is found rather than
// guessing at a project's specific custom-field configuration.
export function findQTestProperty(properties: QTestProperty[] | undefined, nameSubstring: string): QTestProperty | undefined {
  return properties?.find((p) => p.field_name?.toLowerCase().includes(nameSubstring.toLowerCase()));
}

export function mapQTestPriority(properties: QTestProperty[] | undefined): ParsedQTestCase["priority"] {
  const prop = findQTestProperty(properties, "priority");
  const raw = (prop?.field_value_name ?? prop?.field_value ?? "").toLowerCase();
  if (!raw) return "MEDIUM";
  if (raw.includes("critical") || raw === "p1" || raw.includes("blocker")) return "CRITICAL";
  if (raw.includes("high") || raw === "p2") return "HIGH";
  if (raw.includes("low") || raw === "p4" || raw.includes("minor") || raw.includes("trivial")) return "LOW";
  return "MEDIUM";
}

function mapQTestSteps(tc: QTestTestCase): XrayStep[] {
  const steps = tc.test_steps ?? [];
  return [...steps]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ action: s.description ?? "", expectedActionOrData: null, expectedResult: s.expected || null }));
}

export function mapQTestTestCase(tc: QTestTestCase, rowNumber: number, suitePath: string | null): ParsedQTestCase {
  const steps = mapQTestSteps(tc);
  // No structured steps recorded (a purely descriptive test case) - derive
  // a minimal BDD shape so every BDD-only surface still sees something
  // real, same fallback Xray's manual-test mapping already uses.
  const given = tc.precondition ? [tc.precondition] : [];
  const when = steps.length > 0 ? steps.map((s) => s.action).filter(Boolean) : tc.description ? [tc.description] : [];
  const then = steps.length > 0 ? steps.map((s) => s.expectedResult).filter((s): s is string => Boolean(s)) : [];

  return {
    rowNumber,
    key: tc.pid,
    title: tc.name,
    testType: "Manual",
    priority: mapQTestPriority(tc.properties),
    tags: [],
    suitePath,
    background: null,
    given,
    when,
    then,
    steps,
  };
}

// Walks the whole module tree and every test case within it. A live
// network operation (qTest has no static file export for this data), so
// this is called once for `previewQTest` (to compute a real, accurate
// count - not an estimate) and again for `commitQTest`. Known, documented
// gap: qTest allows test cases to sit directly under a project's root with
// no module at all - this walk only visits modules, so root-level unfiled
// cases are not fetched. Left honest rather than guessing at the
// undocumented root-listing call, matching this codebase's existing
// posture on unverified third-party behavior (e.g. TestRail's own file
// importer skipping runs/results rather than guessing their shape).
export async function scanQTestProject(conn: QTestConnection, qtestProjectId: number): Promise<QTestScanResult> {
  const modules = await fetchAllModules(conn, qtestProjectId);
  const suitePaths = buildModuleSuitePaths(modules);

  const cases: ParsedQTestCase[] = [];
  const skipped: { rowNumber: number; reason: string }[] = [];
  let rowNumber = 0;

  for (const mod of modules) {
    const testCases = await fetchTestCasesInModule(conn, qtestProjectId, mod.id);
    for (const tc of testCases) {
      rowNumber += 1;
      if (!tc.name?.trim()) {
        skipped.push({ rowNumber, reason: "missing test case name" });
        continue;
      }
      cases.push(mapQTestTestCase(tc, rowNumber, suitePaths.get(mod.id) ?? null));
    }
  }

  return { cases, skipped };
}
