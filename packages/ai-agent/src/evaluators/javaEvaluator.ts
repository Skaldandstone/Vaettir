import { registerFrameworkEvaluator, type ExtractedTestStructure, type ExtractedTestBlock } from "@vaettir/core";

// P5-09: JUnit and TestNG share the same @Test-annotation convention, so
// one evaluator covers both rather than one per framework. Java is
// brace-delimited, not indentation-based like Python (P5-08) -- finding a
// method's body means locating its opening `{` and walking forward
// counting brace depth until it returns to zero, not scanning indentation.
// This is a naive depth counter (doesn't exclude braces inside string/char
// literals or comments), so it can misfire on a body containing a literal
// "{"/"}" -- rare in real test code, and this evaluator returns null
// rather than a wrong extraction whenever it can't find a clean match,
// same safety contract every other evaluator in this file follows.

const TEST_ANNOTATION_RE = /@Test\b[^\n]*/g;
const DISPLAY_NAME_RE = /@DisplayName\(\s*"([^"]*)"\s*\)/;
const METHOD_NAME_RE = /(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/;
const CLASS_NAME_RE = /\bclass\s+(\w+)/;
const ASSERTION_START_RE = /\b(?:assert\w+|fail|check)\s*\(/g;

// Walks forward from `openBraceIndex` (which must point at a `{`) counting
// depth until it returns to zero, returning the index just past the
// matching `}`. Returns null if the braces never balance (truncated/
// malformed input) rather than looping forever or guessing.
function findMatchingBrace(content: string, openBraceIndex: number): number | null {
  let depth = 0;
  for (let i = openBraceIndex; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return null;
}

// Same depth-counting idea as findMatchingBrace, but for the parens of an
// assertion call -- needed because a plain "stop at the first semicolon"
// regex truncates mid-call for anything like `assertThrows(X.class, () ->
// { doThing(); })`, where the lambda body's own semicolon isn't the
// assertion call's real end.
function findMatchingParen(content: string, openParenIndex: number): number | null {
  let depth = 0;
  for (let i = openParenIndex; i < content.length; i++) {
    if (content[i] === "(") depth++;
    else if (content[i] === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return null;
}

function findAssertions(bodySnippet: string): string[] {
  const assertions: string[] = [];
  for (const match of bodySnippet.matchAll(ASSERTION_START_RE)) {
    const openParen = (match.index ?? 0) + match[0].length - 1;
    const end = findMatchingParen(bodySnippet, openParen);
    if (end !== null) assertions.push(bodySnippet.slice(match.index ?? 0, end).trim());
  }
  return assertions;
}

// Looks immediately around a @Test match for a @DisplayName annotation --
// checked both before and after, since annotation order on a method isn't
// fixed (`@Test @DisplayName(...)` and `@DisplayName(...) @Test` both
// appear in real code). `windowStart` is the caller-supplied lower bound
// (the end of the previous test's body, or 0 for the first) rather than a
// fixed lookback distance -- a fixed distance risks reaching backward past
// the previous method entirely and picking up *its* @DisplayName when two
// tests sit close together, exactly the bug a fixed 300-char window hit in
// verification.
function findDisplayName(content: string, windowStart: number, methodStart: number): string | null {
  const window = content.slice(windowStart, methodStart);
  return window.match(DISPLAY_NAME_RE)?.[1] ?? null;
}

export function extractJavaTestStructure(content: string): ExtractedTestStructure | null {
  const className = content.match(CLASS_NAME_RE)?.[1] ?? null;
  const testBlocks: ExtractedTestBlock[] = [];
  let previousBodyEnd = 0;

  for (const testMatch of content.matchAll(TEST_ANNOTATION_RE)) {
    const searchStart = (testMatch.index ?? 0) + testMatch[0].length;
    const braceIndex = content.indexOf("{", searchStart);
    if (braceIndex === -1) continue;

    // METHOD_NAME_RE expects the trailing `{` in its own match; re-append
    // one so the same pattern works against just the declaration slice
    // (everything between the @Test annotation and the real opening brace).
    const declaration = content.slice(searchStart, braceIndex);
    const resolvedName = `${declaration}{`.match(METHOD_NAME_RE)?.[1];
    if (!resolvedName) continue;

    const bodyEnd = findMatchingBrace(content, braceIndex);
    if (bodyEnd === null) continue;

    const bodySnippet = content.slice(braceIndex + 1, bodyEnd - 1);
    const displayName = findDisplayName(content, previousBodyEnd, braceIndex);
    const title = className ? `${className} > ${displayName ?? resolvedName}` : (displayName ?? resolvedName);
    previousBodyEnd = bodyEnd;

    testBlocks.push({
      title,
      assertions: findAssertions(bodySnippet),
      bodySnippet: bodySnippet.trim(),
    });
  }

  if (testBlocks.length === 0) return null;
  return { testBlocks };
}

export function registerJavaEvaluators(): void {
  for (const family of ["JUNIT", "TESTNG", "ESPRESSO"] as const) {
    registerFrameworkEvaluator({ family, extract: (content: string) => extractJavaTestStructure(content) });
  }
}
