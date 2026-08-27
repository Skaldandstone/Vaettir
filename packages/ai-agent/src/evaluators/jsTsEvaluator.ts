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

function calleeName(node: CallExpression["callee"]): string | null {
  // Matches `describe(...)`, `describe.only(...)`, `describe.skip(...)`,
  // and TS/Mocha's `describe.each(...)(...)`-style curried forms all the
  // same way -- only the innermost identifier name matters for
  // classifying a call as a describe/test/assertion entry point.
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") return calleeName(node.object as CallExpression["callee"]);
  if (node.type === "CallExpression") return calleeName(node.callee);
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
      const name = calleeName(path.node.callee);
      if (name && ASSERTION_ROOT_NAMES.has(name)) {
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
    const name = calleeName(node.callee);
    const title = firstStringArg(node);
    const callbackArg = node.arguments.find(
      (a): a is import("@babel/types").ArrowFunctionExpression | import("@babel/types").FunctionExpression =>
        a.type === "ArrowFunctionExpression" || a.type === "FunctionExpression",
    );

    if (name && DESCRIBE_NAMES.has(name) && title !== null && callbackArg) {
      describeStack.push(title);
      traverseBody(callbackArg);
      describeStack.pop();
      return;
    }

    if (name && TEST_NAMES.has(name) && title !== null && callbackArg) {
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

export function registerJsTsEvaluators(): void {
  for (const family of ["JEST", "VITEST", "MOCHA"] as const) {
    registerFrameworkEvaluator({ family, extract: (content: string) => extractJsTsTestStructure(content) });
  }
}
