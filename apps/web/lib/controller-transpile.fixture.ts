import ts from "typescript";

/**
 * Synthetic controller fixtures intentionally stop at the native-button boundary.
 * Expose ActionButton's complete action description to their existing selectors,
 * retaining every handler, disabled state and other prop verbatim. This is not a
 * rendering assertion: the real component's label, tooltip, keyboard, pointer,
 * touch, form and ref behavior is covered by action-button-ui.test.mjs.
 */
export function controllerTranspile(source: string, options: ts.TranspileOptions) {
  const buttons: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const f = context.factory;
    const visit: ts.Visitor = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
        && /(?:^|\/)ActionButton$/.test(node.moduleSpecifier.text)) return undefined;
      if (ts.isJsxElement(node) && ts.isIdentifier(node.openingElement.tagName)
        && node.openingElement.tagName.text === "ActionButton") {
        const tooltip = node.openingElement.attributes.properties.find(
          (prop): prop is ts.JsxAttribute => ts.isJsxAttribute(prop) && prop.name.getText() === "tooltip",
        );
        const initial = tooltip?.initializer;
        const expression = initial && ts.isJsxExpression(initial) ? initial.expression : initial;
        const children = expression && ts.isJsxFragment(expression)
          ? [...expression.children]
          : expression ? [f.createJsxExpression(undefined, expression)] : node.children;
        // The tooltip wrapper adds formatting whitespace around the original
        // label. Remove only those boundary JSX spaces, never field values or
        // the contents of expressions (notes, step text, request bodies).
        const label = [...children];
        while (label.length && ts.isJsxText(label[0]!) && !label[0]!.getText().trim()) label.shift();
        while (label.length && ts.isJsxText(label[label.length - 1]!) && !label[label.length - 1]!.getText().trim()) label.pop();
        if (label[0] && ts.isJsxText(label[0])) label[0] = f.createJsxText(label[0].text.trimStart());
        const last = label.length - 1;
        if (label[last] && ts.isJsxText(label[last]!)) label[last] = f.createJsxText((label[last] as ts.JsxText).text.trimEnd());
        return ts.visitEachChild(f.updateJsxElement(node,
          f.updateJsxOpeningElement(node.openingElement, f.createIdentifier("button"), undefined,
            f.updateJsxAttributes(node.openingElement.attributes,
              node.openingElement.attributes.properties.filter((prop) => prop !== tooltip))),
          label, f.updateJsxClosingElement(node.closingElement, f.createIdentifier("button"))), visit, context);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (file) => ts.visitNode(file, visit) as ts.SourceFile;
  };
  return ts.transpileModule(source, {
    ...options,
    transformers: { ...options.transformers, before: [buttons, ...(options.transformers?.before ?? [])] },
  });
}
