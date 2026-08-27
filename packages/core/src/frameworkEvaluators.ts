import type { FrameworkFamily } from "./frameworks.js";

// P5-11: formalizes the fallback-to-AI path that already exists
// conceptually in detectFramework -- a known framework with a registered
// native evaluator gets deterministic structure extraction (describe/it
// blocks, each test's own source) handed to the agent instead of the raw
// file; a family with no registered evaluator (or an evaluator that fails
// to extract anything, e.g. a file too unusual for its own heuristics)
// falls back to the existing raw-source-to-agent path unchanged. Adding a
// new native evaluator (P5-07/08/09/10) is registering one more entry
// here, not a branch in reverseEngineerTestFile itself.
export interface ExtractedTestBlock {
  // Full describe/context chain plus the test's own title, e.g.
  // "Cart > checkout > throws on empty cart" -- the same shape a human
  // would read off nested describe() blocks, not just the leaf name alone.
  title: string;
  // Assertion call source text found in the test body (e.g. an
  // `expect(...)` or `assert...` call), best-effort -- absence doesn't
  // mean the extraction failed, just that nothing matched the scan.
  assertions: string[];
  // The test body's own source, sliced from the original file rather than
  // regenerated -- preserves exact original text (variable names,
  // formatting) for the agent to read, scoped to just this one test
  // instead of the whole file.
  bodySnippet: string;
}

export interface ExtractedTestStructure {
  testBlocks: ExtractedTestBlock[];
}

export interface FrameworkEvaluator {
  family: FrameworkFamily;
  // Returns null (not a thrown error) when this file doesn't parse cleanly
  // under this evaluator's assumptions, or has no recognizable test
  // blocks -- the caller's response to either is the same: fall back to
  // raw-source-to-agent, not fail the whole reverse-engineer job.
  extract(content: string, filePath: string): ExtractedTestStructure | null;
}

const registry = new Map<FrameworkFamily, FrameworkEvaluator>();

export function registerFrameworkEvaluator(evaluator: FrameworkEvaluator): void {
  registry.set(evaluator.family, evaluator);
}

export function getFrameworkEvaluator(family: FrameworkFamily): FrameworkEvaluator | undefined {
  return registry.get(family);
}
