import { XMLParser } from "fast-xml-parser";

export interface ParsedFileCoverage {
  filePath: string;
  linesCovered: number;
  linesTotal: number;
  branchesCovered?: number;
  branchesTotal?: number;
}

export interface ParsedCoverage {
  linesCovered: number;
  linesTotal: number;
  branchesCovered?: number;
  branchesTotal?: number;
  files: ParsedFileCoverage[];
}

function sumFiles(files: ParsedFileCoverage[]): Omit<ParsedCoverage, "files"> {
  const hasBranches = files.some((f) => f.branchesTotal !== undefined);
  return {
    linesCovered: files.reduce((sum, f) => sum + f.linesCovered, 0),
    linesTotal: files.reduce((sum, f) => sum + f.linesTotal, 0),
    branchesCovered: hasBranches ? files.reduce((sum, f) => sum + (f.branchesCovered ?? 0), 0) : undefined,
    branchesTotal: hasBranches ? files.reduce((sum, f) => sum + (f.branchesTotal ?? 0), 0) : undefined,
  };
}

// Istanbul/nyc `coverage-final.json`: a map of absolute file path -> per-
// file coverage detail, keyed by statement/branch/function id rather than
// line number. Statement counts are used as the line-coverage proxy here
// (the common simplification most Istanbul-consuming tools make) since
// Istanbul doesn't track "lines" as a first-class unit the way Cobertura/
// JaCoCo do.
export function parseIstanbulJson(content: string): ParsedCoverage {
  const data = JSON.parse(content) as Record<
    string,
    { path?: string; s?: Record<string, number>; b?: Record<string, number[]> }
  >;

  const files: ParsedFileCoverage[] = Object.entries(data).map(([key, entry]) => {
    const statementCounts = Object.values(entry.s ?? {});
    const linesCovered = statementCounts.filter((c) => c > 0).length;
    const linesTotal = statementCounts.length;

    const branchGroups = Object.values(entry.b ?? {});
    const hasBranches = branchGroups.length > 0;
    const branchesTotal = hasBranches ? branchGroups.reduce((sum, g) => sum + g.length, 0) : undefined;
    const branchesCovered = hasBranches
      ? branchGroups.reduce((sum, g) => sum + g.filter((c) => c > 0).length, 0)
      : undefined;

    return { filePath: entry.path ?? key, linesCovered, linesTotal, branchesCovered, branchesTotal };
  });

  return { ...sumFiles(files), files };
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// Cobertura XML -- the format coverage.py's `coverage xml` emits, and also
// widely used/convertible-to from many other language ecosystems, making
// it as close to a "universal" coverage format as JUnit is for results.
export function parseCoberturaXml(content: string): ParsedCoverage {
  const doc = xmlParser.parse(content) as Record<string, unknown>;
  const root = doc.coverage as Record<string, unknown> | undefined;
  if (!root) return { linesCovered: 0, linesTotal: 0, files: [] };

  const packages = asArray(root.packages as Record<string, unknown> | undefined).flatMap((p) =>
    asArray((p as Record<string, unknown>).package as Record<string, unknown> | Record<string, unknown>[] | undefined),
  );

  const files: ParsedFileCoverage[] = [];
  for (const pkg of packages) {
    const classes = asArray(
      (pkg as Record<string, unknown>).classes as Record<string, unknown> | undefined,
    ).flatMap((c) => asArray((c as Record<string, unknown>).class as Record<string, unknown> | Record<string, unknown>[] | undefined));

    for (const cls of classes) {
      const filePath = String((cls as Record<string, unknown>)["@_filename"] ?? "");
      const lines = asArray(
        (cls as Record<string, unknown>).lines as Record<string, unknown> | undefined,
      ).flatMap((l) => asArray((l as Record<string, unknown>).line as Record<string, unknown> | Record<string, unknown>[] | undefined));

      let linesCovered = 0;
      let branchesCovered = 0;
      let branchesTotal = 0;
      let hasBranchInfo = false;
      for (const line of lines) {
        const hits = Number((line as Record<string, unknown>)["@_hits"] ?? 0);
        if (hits > 0) linesCovered++;
        const conditionCoverage = (line as Record<string, unknown>)["@_condition-coverage"];
        if (typeof conditionCoverage === "string") {
          const match = conditionCoverage.match(/\((\d+)\/(\d+)\)/);
          if (match) {
            hasBranchInfo = true;
            branchesCovered += Number(match[1]);
            branchesTotal += Number(match[2]);
          }
        }
      }

      if (filePath) {
        files.push({
          filePath,
          linesCovered,
          linesTotal: lines.length,
          branchesCovered: hasBranchInfo ? branchesCovered : undefined,
          branchesTotal: hasBranchInfo ? branchesTotal : undefined,
        });
      }
    }
  }

  return { ...sumFiles(files), files };
}

// JaCoCo XML -- a distinct shape from Cobertura: <report>/<package>/
// <sourcefile>, with per-line <line nr mi ci> entries (missed/covered
// INSTRUCTIONS, not statements) plus <counter type="LINE"> summaries.
// Per-file totals are derived from summing each sourcefile's own LINE/
// BRANCH <counter> elements rather than the per-<line> entries, since
// JaCoCo's per-line mi/ci counts instructions within that line, not
// whether the line itself is "covered" in the Cobertura/Istanbul sense.
export function parseJacocoXml(content: string): ParsedCoverage {
  const doc = xmlParser.parse(content) as Record<string, unknown>;
  const root = doc.report as Record<string, unknown> | undefined;
  if (!root) return { linesCovered: 0, linesTotal: 0, files: [] };

  function findCounter(node: Record<string, unknown>, type: string): { covered: number; missed: number } | null {
    const counters = asArray(node.counter as Record<string, unknown> | Record<string, unknown>[] | undefined);
    const found = counters.find((c) => (c as Record<string, unknown>)["@_type"] === type) as
      | Record<string, unknown>
      | undefined;
    if (!found) return null;
    return { covered: Number(found["@_covered"] ?? 0), missed: Number(found["@_missed"] ?? 0) };
  }

  const packages = asArray(root.package as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const files: ParsedFileCoverage[] = [];
  for (const pkg of packages) {
    const sourcefiles = asArray(
      (pkg as Record<string, unknown>).sourcefile as Record<string, unknown> | Record<string, unknown>[] | undefined,
    );
    for (const sf of sourcefiles) {
      const lineCounter = findCounter(sf as Record<string, unknown>, "LINE");
      if (!lineCounter) continue;
      const branchCounter = findCounter(sf as Record<string, unknown>, "BRANCH");
      const packageName = (pkg as Record<string, unknown>)["@_name"];
      const fileName = (sf as Record<string, unknown>)["@_name"];
      files.push({
        filePath: packageName ? `${packageName}/${fileName}` : String(fileName ?? ""),
        linesCovered: lineCounter.covered,
        linesTotal: lineCounter.covered + lineCounter.missed,
        branchesCovered: branchCounter?.covered,
        branchesTotal: branchCounter ? branchCounter.covered + branchCounter.missed : undefined,
      });
    }
  }

  return { ...sumFiles(files), files };
}
