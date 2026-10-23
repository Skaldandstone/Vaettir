import ts from "typescript";

// Formatting-neutral lexical contracts: only trivia is ignored. Identifier,
// operator, quoted-string and template-token contents remain exact. This is
// not a runtime/DOM proof; component fixtures and behavioral tests are separate.
function tokens(source) {
  const values = [];
  const file = ts.createSourceFile("contract.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    const children = node.getChildren(file);
    if (children.length) { for (const child of children) visit(child); return; }
    if (node.kind === ts.SyntaxKind.EndOfFileToken || node.end <= node.getStart(file)) return;
    if (node.kind === ts.SyntaxKind.JsxText) {
      // JSX formatting whitespace collapses in the rendered paragraph. Scan
      // just that text leaf; never let text punctuation consume code elsewhere.
      const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, node.getText(file));
      for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) values.push(`${kind}:${scanner.getTokenText()}`);
    } else values.push(`${node.kind}:${node.getText(file)}`);
  }
  visit(file);
  return `\u0000${values.join("\u0000")}\u0000`;
}
export function sourceCodeIncludes(source, fragment) {
  return tokens(source).includes(tokens(fragment));
}
