import { XMLParser } from "fast-xml-parser";

export type JUnitResultStatus = "PASS" | "FAIL" | "SKIP";

export interface ParsedJUnitCase {
  externalTestId: string; // "<classname>::<name>", matching TestCaseSource.externalTestId's documented shape
  status: JUnitResultStatus;
  durationMs: number | null;
  errorMessage: string | null;
  // The `file` attribute is a common (if not universal) JUnit XML extension
  // -- pytest's --junitxml and Vitest's junit reporter both emit it, among
  // others. Read only if actually present; never guessed/derived from
  // `classname` (a Java-style dotted classname->path mapping is a real
  // heuristic with real failure modes, not something worth guessing at
  // silently for P5-14's auto-enqueue to then fetch the wrong file).
  externalFilePath: string | null;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });

// JUnit XML has no single canonical root: some reporters emit a wrapping
// <testsuites>, others emit a single top-level <testsuite>, and a <testsuite>
// with exactly one <testcase> often loses the array wrapper entirely under
// fast-xml-parser's default parsing. All three shapes are normalized to a
// flat array of raw testcase nodes here so the rest of the parser only
// has one shape to deal with.
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function extractMessage(node: Record<string, unknown>): string | null {
  const failureOrError = node.failure ?? node.error;
  if (!failureOrError) return null;
  const entry = Array.isArray(failureOrError) ? failureOrError[0] : failureOrError;
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    const message = obj["@_message"];
    const text = obj["#text"];
    if (typeof message === "string" && message.length > 0) return message;
    if (typeof text === "string" && text.length > 0) return text;
  }
  return "Test failed";
}

export function parseJUnitXml(xml: string): ParsedJUnitCase[] {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const root = (doc.testsuites ?? doc.testsuite) as Record<string, unknown> | undefined;
  if (!root) return [];

  const suites = doc.testsuites ? asArray(root.testsuite as Record<string, unknown> | Record<string, unknown>[] | undefined) : [root];

  const results: ParsedJUnitCase[] = [];
  for (const suite of suites) {
    const cases = asArray(suite.testcase as Record<string, unknown> | Record<string, unknown>[] | undefined);
    for (const tc of cases) {
      const classname = String(tc["@_classname"] ?? "").trim();
      const name = String(tc["@_name"] ?? "").trim();
      if (!name) continue;
      const externalTestId = classname ? `${classname}::${name}` : name;

      let status: JUnitResultStatus = "PASS";
      if (tc.failure !== undefined || tc.error !== undefined) status = "FAIL";
      else if (tc.skipped !== undefined) status = "SKIP";

      const timeAttr = tc["@_time"];
      const durationMs = timeAttr !== undefined && !Number.isNaN(Number(timeAttr)) ? Math.round(Number(timeAttr) * 1000) : null;

      const fileAttr = tc["@_file"];

      results.push({
        externalTestId,
        status,
        durationMs,
        errorMessage: status === "FAIL" ? extractMessage(tc) : null,
        externalFilePath: typeof fileAttr === "string" && fileAttr.length > 0 ? fileAttr : null,
      });
    }
  }
  return results;
}
