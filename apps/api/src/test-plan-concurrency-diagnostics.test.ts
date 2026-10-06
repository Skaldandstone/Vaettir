import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";

// Execute only the actual bounded failure-code helpers, never native fixtures,
// Prisma, SQL, environment admission or application callers.
const source = readFileSync(new URL("./test-plan-execution.integration.test.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("native-fixture.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) &&
  ["ownDataProperty", "concurrentFailureCodes"].includes(node.name?.text ?? ""));
if (selected.length !== 2) throw Error("Both original diagnostic helpers are required");
const printer = ts.createPrinter();
const context = vm.createContext({});
vm.runInContext(ts.transpileModule(selected.map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText, context);
const codes = (context as unknown as { concurrentFailureCodes(value: unknown): string }).concurrentFailureCodes;

it("emits only bounded public code fields, not messages, SQL, parameters or error stacks", () => {
  const value = { code: "INTERNAL_SERVER_ERROR", message: "synthetic-private-body", stack: "synthetic-stack",
    cause: { code: "P2034", message: "synthetic-SQL", meta: { code: "40P01", query: "synthetic-query", parameters: ["private"] } } };
  expect(JSON.parse(codes(value))).toEqual({ outerCode: "INTERNAL_SERVER_ERROR", nativeCode: "P2034", sqlState: "40P01" });
  expect(codes(value)).not.toMatch(/private|synthetic|query|parameters|stack|message/);
});

it("refuses arbitrary, excessive or missing code values without echoing them", () => {
  for (const code of ["private\nbody", "secret.example", "A".repeat(33), "", 40, null, undefined])
    expect(JSON.parse(codes({ code, cause: { code, meta: { code } } }))).toEqual({ outerCode: "UNAVAILABLE", nativeCode: "UNAVAILABLE", sqlState: "UNAVAILABLE" });
  for (const value of [null, undefined, "synthetic-private", 2])
    expect(JSON.parse(codes(value))).toEqual({ outerCode: "UNAVAILABLE", nativeCode: "UNAVAILABLE", sqlState: "UNAVAILABLE" });
});

it("does not invoke error getters or read inherited code properties", () => {
  let reads = 0;
  const value = Object.create({ code: "INHERITED" });
  Object.defineProperty(value, "cause", { get() { reads++; throw Error("must not execute"); } });
  expect(JSON.parse(codes(value))).toEqual({ outerCode: "UNAVAILABLE", nativeCode: "UNAVAILABLE", sqlState: "UNAVAILABLE" });
  expect(reads).toBe(0);
});

it("the original configuration concurrency assertion still requires success and exact version retention", () => {
  expect(source).toContain('expect(outcomes[1]!.status, outcomes[1]!.status === "rejected" ? concurrentFailureCodes(outcomes[1]!.reason) : undefined).toBe("fulfilled")');
  expect(source).toContain('expect(history.map((v) => v.versionNumber)).toEqual([6, 5, 4, 3, 2, 1])');
  expect(source).toContain('expect(history[4]?.executionTemplate).toEqual(saved.template)');
  expect(source).toContain('expect(outcomes[0]!.reason, concurrentFailureCodes(outcomes[0]!.reason)).toMatchObject({ code: "CONFLICT" })');
});
