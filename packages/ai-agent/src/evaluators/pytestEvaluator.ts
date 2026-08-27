import { registerFrameworkEvaluator, type ExtractedTestStructure, type ExtractedTestBlock } from "@vaettir/core";

// P5-08: a JS-side heuristic rather than a Python microservice (the
// ticket's other option) -- adding a whole new deployment unit/runtime to
// this monorepo for one evaluator is a much bigger commitment than the
// value justifies here, and Python's indentation-based syntax makes block
// boundaries unambiguous to scan line-by-line without a real parser: a
// `def`/`class` line's body is exactly "every following line indented
// further than it, until one that isn't." This isn't a full AST (no
// handling of multi-line def signatures, decorators are read but not
// evaluated, string content isn't excluded from indentation scanning), but
// it's structurally sound for the common case, and returning `null` on
// anything that doesn't look like real pytest structure is always safe --
// the caller falls back to raw-source-to-agent, never a wrong extraction.

const CLASS_RE = /^(\s*)class\s+(Test\w*)\s*[:(]/;
const DEF_RE = /^(\s*)def\s+(test_\w+)\s*\(/;
const ASSERT_RE = /^\s*assert\b.*/;

function indentOf(line: string): number {
  return line.match(/^(\s*)/)?.[1]?.length ?? 0;
}

// Collects every line from `startIndex + 1` up to (not including) the next
// line whose indentation is <= `indent` -- i.e. this def/class's own body.
function collectBlock(lines: string[], startIndex: number, indent: number): { body: string[]; endIndex: number } {
  const body: string[] = [];
  let i = startIndex + 1;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim().length === 0) {
      body.push(line);
      continue;
    }
    if (indentOf(line) <= indent) break;
    body.push(line);
  }
  return { body, endIndex: i };
}

export function extractPytestStructure(content: string): ExtractedTestStructure | null {
  const lines = content.split("\n");
  const testBlocks: ExtractedTestBlock[] = [];

  // Single top-to-bottom pass: a Test* class consumes its whole body in one
  // jump (its methods extracted from those lines directly), so a
  // module-level `def test_...` scan below it never re-visits lines a
  // class already claimed.
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const classMatch = line.match(CLASS_RE);
    if (classMatch) {
      const indentStr = classMatch[1] ?? "";
      const className = classMatch[2] ?? "";
      const { body, endIndex } = collectBlock(lines, i, indentStr.length);
      testBlocks.push(...extractDefsFromLines(body, className));
      i = endIndex;
      continue;
    }

    const defMatch = line.match(DEF_RE);
    if (defMatch) {
      const indentStr = defMatch[1] ?? "";
      const testName = defMatch[2] ?? "";
      const { body, endIndex } = collectBlock(lines, i, indentStr.length);
      testBlocks.push(buildBlock(testName, body));
      i = endIndex;
      continue;
    }

    i++;
  }

  if (testBlocks.length === 0) return null;
  return { testBlocks };
}

function extractDefsFromLines(classBodyLines: string[], className: string): ExtractedTestBlock[] {
  const blocks: ExtractedTestBlock[] = [];
  let i = 0;
  while (i < classBodyLines.length) {
    const line = classBodyLines[i] ?? "";
    const defMatch = line.match(DEF_RE);
    if (defMatch) {
      const indentStr = defMatch[1] ?? "";
      const testName = defMatch[2] ?? "";
      const { body, endIndex } = collectBlock(classBodyLines, i, indentStr.length);
      blocks.push(buildBlock(testName, body, className));
      i = endIndex;
      continue;
    }
    i++;
  }
  return blocks;
}

function buildBlock(testName: string, bodyLines: string[], className?: string): ExtractedTestBlock {
  const assertions = bodyLines.map((l) => l.trim()).filter((l) => ASSERT_RE.test(l));
  return {
    title: className ? `${className} > ${testName}` : testName,
    assertions,
    bodySnippet: bodyLines.join("\n"),
  };
}

export function registerPytestEvaluator(): void {
  registerFrameworkEvaluator({ family: "PYTEST", extract: (content: string) => extractPytestStructure(content) });
}
