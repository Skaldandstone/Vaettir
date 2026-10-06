import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  manualRunStartLegacyInputSchema as input,
  manualRunStartLegacyOutputSchema as output,
} from "./manualRunStartLegacySchema.js";

function originalSchemas() {
  const source = readFileSync(
      new URL("../routers/manualExecution.ts", import.meta.url),
      "utf8",
    ),
    ast = ts.createSourceFile(
      "router.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
  let start: ts.PropertyAssignment | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "start")
      start = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!start) throw Error("Original start route missing");
  const schemas: Record<string, string> = {},
    printer = ts.createPrinter({ removeComments: true });
  let expression = start.initializer;
  while (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression)
  ) {
    const method = expression.expression.name.text;
    if (method === "input" || method === "output")
      schemas[method] = printer.printNode(
        ts.EmitHint.Unspecified,
        expression.arguments[0]!,
        ast,
      );
    expression = expression.expression.expression;
  }
  return schemas;
}
function semantics(code: string) {
  const ast = ts.createSourceFile(
    "expression.ts",
    code,
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (node: ts.Node): unknown => {
    if (ts.isParenthesizedExpression(node)) return visit(node.expression);
    const children: unknown[] = [];
    ts.forEachChild(node, (child) => {
      children.push(visit(child));
    });
    return [
      ts.SyntaxKind[node.kind],
      node.kind !== ts.SyntaxKind.SourceFile &&
      "text" in node &&
      typeof node.text === "string"
        ? node.text
        : null,
      children,
    ];
  };
  return visit(ast);
}
describe("exact legacy run-start schema extraction (original router still unmodified)", () => {
  it("input/output expressions are exact original ASTs, including optional absence and old normalization", () => {
    const original = originalSchemas(),
      source = readFileSync(
        new URL("./manualRunStartLegacySchema.ts", import.meta.url),
        "utf8",
      ),
      ast = ts.createSourceFile(
        "schemas.ts",
        source,
        ts.ScriptTarget.Latest,
        true,
      ),
      printer = ts.createPrinter({ removeComments: true });
    const values = new Map<string, ts.Expression>();
    for (const statement of ast.statements)
      if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations)
          if (ts.isIdentifier(declaration.name) && declaration.initializer)
            values.set(declaration.name.text, declaration.initializer);
    expect(
      semantics(
        printer.printNode(
          ts.EmitHint.Unspecified,
          values.get("manualRunStartLegacyInputSchema")!,
          ast,
        ),
      ),
    ).toEqual(semantics(original.input!));
    expect(
      semantics(
        printer.printNode(
          ts.EmitHint.Unspecified,
          values.get("manualRunStartLegacyOutputSchema")!,
          ast,
        ),
      ),
    ).toEqual(semantics(original.output!));
  });
  it("unpinned legacy request remains exactly unpinned, unknown keys stripped without invented UUID/context", () => {
    expect(
      input.parse({
        projectId: "project",
        testCaseIds: ["two", "one"],
        outerNonce: "not-inner",
      }),
    ).toEqual({ projectId: "project", testCaseIds: ["two", "one"] });
    const parsed = input.parse({ projectId: "project", testCaseIds: ["case"] });
    for (const key of [
      "executionContext",
      "expectedProfileHash",
      "idempotencyKey",
      "originalOrganizationId",
      "expectedClerkActorId",
      "planReference",
    ])
      expect(parsed).not.toHaveProperty(key);
    expect(output.parse({ testRunId: "manual-fixture" })).toEqual({
      testRunId: "manual-fixture",
    });
  });
  it("old execution context trims/defaults exactly, preserving inner line breaks and complete property order", () => {
    const parsed = input.parse({
      projectId: "p",
      testCaseIds: ["case"],
      executionContext: { configuration: " raw\nprose ", build: "0" },
    });
    expect(parsed.executionContext).toEqual({
      configuration: "raw\nprose",
      platform: "",
      build: "0",
      hardwareRevision: "",
      firmwareVersion: "",
      rig: "",
      batchOrLot: "",
      environment: "",
      calibrationReference: "",
      protocolReference: "",
    });
    expect(Object.keys(parsed.executionContext!)).toEqual([
      "configuration",
      "platform",
      "build",
      "hardwareRevision",
      "firmwareVersion",
      "rig",
      "batchOrLot",
      "environment",
      "calibrationReference",
      "protocolReference",
    ]);
  });
  it("paired pins still require the original UUID and cannot be half supplied", () => {
    const base = { projectId: "p", testCaseIds: ["case"] };
    for (const pins of [
      { originalOrganizationId: "org" },
      { expectedClerkActorId: "clerk" },
      { originalOrganizationId: "org", expectedClerkActorId: "clerk" },
    ])
      expect(input.safeParse({ ...base, ...pins }).success).toBe(false);
    expect(
      input.parse({
        ...base,
        originalOrganizationId: "org",
        expectedClerkActorId: "clerk",
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
      }),
    ).toHaveProperty("expectedClerkActorId", "clerk");
  });
  it("legacy IDs and 1000 cap are not silently tightened, widened or reordered by extraction", () => {
    expect(
      input.parse({ projectId: "", testCaseIds: [""] }).testCaseIds,
    ).toEqual([""]);
    expect(
      input.safeParse({ projectId: "p", testCaseIds: Array(1000).fill("case") })
        .success,
    ).toBe(true);
    expect(
      input.safeParse({ projectId: "p", testCaseIds: Array(1001).fill("case") })
        .success,
    ).toBe(false);
    expect(
      input.parse({
        projectId: "p",
        testCaseIds: ["two", "one"],
        expectedProfileHash: undefined,
      }),
    ).toHaveProperty("expectedProfileHash", undefined);
  });
});
