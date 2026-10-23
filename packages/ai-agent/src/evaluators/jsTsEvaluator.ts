import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import type { Node, CallExpression, StringLiteral } from "@babel/types";
import { registerFrameworkEvaluator, type ExtractedTestStructure, type ExtractedTestBlock } from "@vaettir/core";

// @babel/traverse's ESM default export is wrapped oddly under
// interop -- observed the same "callable default is actually
// { default: fn }" shape other Babel packages have under NodeNext module
// resolution. Unwrap once here rather than at every call site.
const traverse = (typeof _traverse === "function" ? _traverse : (_traverse as { default: typeof _traverse }).default) as typeof _traverse;

const DESCRIBE_NAMES = new Set(["describe", "context", "suite"]);
const TEST_NAMES = new Set(["it", "test", "specify"]);
const ASSERTION_ROOT_NAMES = new Set(["expect", "assert"]);
// Property names that modify a describe/test call rather than naming one --
// `describe.only(...)`, `it.skip(...)`, `test.each([...])(...)` all still
// mean "describe"/"test", not "only"/"skip"/"each".
const MODIFIER_PROPS = new Set(["only", "skip", "each", "todo", "concurrent", "serial", "fixme", "step"]);

// Collects every identifier name along a callee chain rather than picking
// just one -- `describe.only(...)` and Playwright's `test.describe(...)`
// are both `Identifier.Identifier` shapes, but the *meaningful* name is
// the object in one case and the property in the other. Filtering out
// known modifier names and checking DESCRIBE_NAMES before TEST_NAMES
// resolves the ambiguity correctly for both: `describe.only` ->
// ["describe"] (only filtered) -> describe; `test.describe` ->
// ["test", "describe"] -> describe wins since it's checked first.
function calleeIdentifiers(node: CallExpression["callee"]): string[] {
  if (node.type === "Identifier") return [node.name];
  if (node.type === "MemberExpression") {
    const objectNames = calleeIdentifiers(node.object as CallExpression["callee"]);
    const propName = node.property.type === "Identifier" ? node.property.name : null;
    return propName ? [...objectNames, propName] : objectNames;
  }
  if (node.type === "CallExpression") return calleeIdentifiers(node.callee);
  return [];
}

function classifyCallee(node: CallExpression["callee"]): "describe" | "test" | "assertion" | null {
  const names = calleeIdentifiers(node).filter((n) => !MODIFIER_PROPS.has(n));
  if (names.some((n) => DESCRIBE_NAMES.has(n))) return "describe";
  if (names.some((n) => TEST_NAMES.has(n))) return "test";
  if (names.some((n) => ASSERTION_ROOT_NAMES.has(n))) return "assertion";
  return null;
}

function firstStringArg(call: CallExpression): string | null {
  const first = call.arguments[0];
  return first?.type === "StringLiteral" ? (first as StringLiteral).value : null;
}

// Scans a test body for assertion-shaped call expressions (`expect(...)`,
// `assert...(...)`) and slices their exact source text -- best-effort, not
// a full static analysis. Missing one isn't a failure; bodySnippet is the
// fallback the agent reads directly for anything this scan doesn't catch.
function findAssertions(node: Node, source: string): string[] {
  const assertions: string[] = [];
  traverse(node, {
    noScope: true,
    CallExpression(path) {
      if (classifyCallee(path.node.callee) === "assertion") {
        const { start, end } = path.node;
        if (start !== null && end !== null) assertions.push(source.slice(start, end));
        // Without this, `expect(x).toBe(y)` also matches its own inner
        // `expect(x)` call as a second, redundant "assertion" -- skip
        // descending once the outer chain is captured.
        path.skip();
      }
    },
  });
  return assertions;
}

function extractTestBlocks(ast: Node, source: string): ExtractedTestBlock[] {
  const blocks: ExtractedTestBlock[] = [];
  const describeStack: string[] = [];

  function visitCallExpression(node: CallExpression) {
    const kind = classifyCallee(node.callee);
    const title = firstStringArg(node);
    const callbackArg = node.arguments.find(
      (a): a is import("@babel/types").ArrowFunctionExpression | import("@babel/types").FunctionExpression =>
        a.type === "ArrowFunctionExpression" || a.type === "FunctionExpression",
    );

    if (kind === "describe" && title !== null && callbackArg) {
      describeStack.push(title);
      traverseBody(callbackArg);
      describeStack.pop();
      return;
    }

    if (kind === "test" && title !== null && callbackArg) {
      const { start, end } = callbackArg;
      const bodySnippet = start !== null && end !== null ? source.slice(start, end) : "";
      blocks.push({
        title: [...describeStack, title].join(" > "),
        assertions: findAssertions(callbackArg, source),
        bodySnippet,
      });
    }
  }

  function traverseBody(root: Node) {
    traverse(root, {
      noScope: true,
      CallExpression(path) {
        visitCallExpression(path.node);
        // Each describe/test callback is walked independently via the
        // recursive visitCallExpression -> traverseBody calls above, so
        // this outer traversal must not also descend into a call it just
        // handled -- otherwise a nested it() inside a describe() would be
        // visited (and pushed to `blocks`) twice.
        path.skip();
      },
    });
  }

  traverseBody(ast);
  return blocks;
}

export function extractJsTsTestStructure(content: string): ExtractedTestStructure | null {
  let ast;
  try {
    ast = parse(content, {
      sourceType: "unambiguous",
      plugins: ["typescript", "jsx"],
      errorRecovery: true,
    });
  } catch {
    return null;
  }

  const testBlocks = extractTestBlocks(ast.program as unknown as Node, content);
  if (testBlocks.length === 0) return null;
  return { testBlocks };
}

// P5-10: Cypress and Playwright are both JS/TS and use the same
// describe/it(.only/.skip)/test.describe structural shape this evaluator
// already handles -- registered against the same extractor rather than a
// separate parser. `cy.*`/`page.*` step calls aren't picked out as a
// distinct "assertions" list (Cypress especially mixes actions and
// `.should(...)` assertions in one chain, and Playwright already uses
// `expect(...)` same as Jest/Vitest) -- bodySnippet already carries them
// as part of the full test body source, which is what the agent reads.
export function registerJsTsEvaluators(): void {
  for (const family of ["JEST", "VITEST", "MOCHA", "CYPRESS", "PLAYWRIGHT", "APPIUM", "DETOX"] as const) {
    registerFrameworkEvaluator({ family, extract: (content: string) => extractJsTsTestStructure(content) });
  }
}
