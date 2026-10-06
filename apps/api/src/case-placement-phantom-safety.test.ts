// Pure admission/AST/source proofs only. Never import/execute the native suite.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
const native = readFileSync(
    new URL("./case-placement-phantom.integration.test.ts", import.meta.url),
    "utf8",
  ),
  ast = ts.createSourceFile(
    "fixture.ts",
    native,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
const pureNames = [
  "admitCasePlacementFixture",
  "placementFixtureEnabled",
  "assertPlacementFixtureOwner",
];
const pure = ast.statements
  .filter(
    (node) =>
      (ts.isFunctionDeclaration(node) &&
        pureNames.includes(node.name?.text ?? "")) ||
      (ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(
          (declaration) =>
            declaration.name.getText(ast) === "PLACEMENT_PHANTOM_OPT_IN",
        )),
  )
  .map((node) => node.getText(ast))
  .join("\n");
type Guards = {
  admitCasePlacementFixture: (env: Record<string, string | undefined>) => {
    route: string;
    database: string;
  };
  placementFixtureEnabled: (env: Record<string, string | undefined>) => boolean;
  assertPlacementFixtureOwner: (value: Record<string, string>) => void;
};
const guards: Guards = runInNewContext(
  ts.transpileModule(pure, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText + "\nexports;",
  { exports: {}, assertOwnedTestDatabase },
);
const database =
    "postgresql://synthetic:unused@127.0.0.1:5432/vaettir_day_test_1791327600000?schema=public&connection_limit=1",
  flag = "VAETTIR_CASE_PLACEMENT_PHANTOM_NATIVE_FIXTURE",
  prefix =
    "case-placement-phantom-1791327600000-11111111-1111-4111-8111-111111111111";
const owner = {
  prefix,
  organizationId: "minted-org",
  organizationSlug: `${prefix}-org`,
  projectId: "minted-project",
  actorId: "minted-native",
  clerkActorId: `${prefix}-owner`,
};
function calls(root: ts.Node) {
  const result: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return result;
}
describe("placement phantom authored fixture guard (no native execution)", () => {
  it("extracts only three actual pure gate functions, not suite/runtime code", () => {
    expect(
      pureNames.every(
        (name) => typeof guards[name as keyof Guards] === "function",
      ),
    ).toBe(true);
    expect(pure).not.toMatch(/\$queryRaw|PrismaClient|beforeAll|import\(/);
  });
  it("accepts exact local disposable route only with separate named opt-in", () => {
    expect(
      guards.admitCasePlacementFixture({ DATABASE_URL: database, [flag]: "1" }),
    ).toEqual({
      route: "LOCAL_DISPOSABLE",
      database: "vaettir_day_test_1791327600000",
    });
    expect(guards.placementFixtureEnabled({ DATABASE_URL: database })).toBe(
      false,
    );
    expect(
      guards.placementFixtureEnabled({ DATABASE_URL: database, [flag]: "yes" }),
    ).toBe(false);
  });
  for (const route of [
    database.replace("127.0.0.1", "customer.invalid"),
    database.replace("vaettir_day_test_1791327600000", "random_test"),
    database.replace("vaettir_day_test_1791327600000", "vaettir_test"),
    `${database}&host=127.0.0.1`,
    database.replace(":5432/", ":5433/"),
  ])
    it("refuses unsupported/remote/override route without credential diagnostic", () => {
      expect(
        guards.placementFixtureEnabled({ DATABASE_URL: route, [flag]: "1" }),
      ).toBe(false);
      try {
        guards.admitCasePlacementFixture({ DATABASE_URL: route, [flag]: "1" });
        throw Error("Unexpected admission");
      } catch (error) {
        expect(String(error)).not.toContain("synthetic:unused");
      }
    });
  it("exact minted native ownership rejects foreign/empty/unbounded namespace tuples", () => {
    expect(guards.assertPlacementFixtureOwner(owner)).toBeUndefined();
    for (const changed of [
      { prefix: "test" },
      { organizationSlug: "customer" },
      { clerkActorId: "customer" },
      { actorId: "" },
      { projectId: "x".repeat(201) },
      { organizationId: "bad\0id" },
    ])
      expect(() =>
        guards.assertPlacementFixtureOwner({ ...owner, ...changed }),
      ).toThrow("Exact minted");
  });
  it("static runtime import graph is only node tools, Vitest and existing pure admission; DB/service imports gated", () => {
    const imports = ast.statements
      .filter(ts.isImportDeclaration)
      .filter((node) => !node.importClause?.isTypeOnly)
      .map((node) => (node.moduleSpecifier as ts.StringLiteral).text);
    expect(imports).toEqual([
      "node:crypto",
      "vitest",
      "./testOnlyDatabaseSafety.js",
    ]);
    const registration = calls(ast).find(
      (call) => call.expression.getText(ast) === "beforeAll",
    );
    expect(registration).toBeDefined();
    const work = registration!.arguments[0]!,
      workCalls = calls(work),
      admission = workCalls.find(
        (call) => call.expression.getText(ast) === "admitCasePlacementFixture",
      );
    const runtimeImports = workCalls.filter(
      (call) => call.expression.kind === ts.SyntaxKind.ImportKeyword,
    );
    expect(runtimeImports.length).toBe(2);
    for (const runtime of runtimeImports)
      expect(admission!.pos).toBeLessThan(runtime.pos);
    for (const query of workCalls.filter((call) =>
      call.expression.getText(ast).includes(".$queryRaw"),
    ))
      expect(admission!.pos).toBeLessThan(query.pos);
  });
  it("three strict top-level regressions have no admitted skip/xfail/retry/deadline waiver or nested it", () => {
    const tests = calls(ast).filter(
      (call) => call.expression.getText(ast) === "it",
    );
    expect(tests).toHaveLength(3);
    for (const test of tests) {
      expect(test.arguments).toHaveLength(2);
      expect(
        ts.isExpressionStatement(test.parent) && ts.isBlock(test.parent.parent),
      ).toBe(true);
      expect(
        calls(test.arguments[1]!).some(
          (child) =>
            /^it(?:\.|\()/.test(child.expression.getText(ast)) ||
            child.expression.getText(ast) === "it",
        ),
      ).toBe(false);
    }
    expect(native).not.toMatch(
      /it\.skip|it\.fails|test\.fails|\.retry\(|testTimeout|hookTimeout/,
    );
    const race = ast.statements
      .flatMap((node) => calls(node))
      .find(
        (call) =>
          call.expression.getText(ast) ===
          "describe.skipIf(!placementFixtureEnabled(process.env))",
      );
    expect(race).toBeDefined();
    expect(native.replace(/\s/g, "")).toContain('code:"CONFLICT"');
  });
  it("barriers await actual query outputs and pause only after native calls, with no bogus result injection", () => {
    const barrier = ast.statements.find(
      (node) =>
        ts.isFunctionDeclaration(node) &&
        node.name?.text === "withNativeBarrier",
    )!;
    const text = barrier.getText(ast).replace(/\s/g, "");
    expect(text).toContain("constresult=awaitReflect.apply(value,model,args)");
    const forwards = calls(barrier).filter(
      (call) => call.expression.getText(ast) === "Reflect.apply",
    );
    expect(
      forwards.map((call) =>
        call.arguments.map((argument) => argument.getText(ast)),
      ),
    ).toEqual([
      ["value", "model", "args"],
      ["transaction.$queryRaw", "transaction", "args"],
    ]);
    expect(text).toContain("cohortReads===2");
    expect(text).not.toMatch(
      /Promise.resolve\(\[|return\[|DISABLETRIGGER|session_replication_role/,
    );
  });
  it("teardown retains rows/receipts and disconnects; actual native ownership protects each scenario writer", () => {
    const teardown = calls(ast)
      .find((call) => call.expression.getText(ast) === "afterAll")!
      .getText(ast);
    expect(teardown).toContain("$disconnect");
    expect(teardown).not.toMatch(/delete|erase|drop|hardDelete/i);
    expect(native).not.toMatch(
      /deleteMany|\.delete\(|DROP TABLE|DROP DATABASE|DISABLE TRIGGER|session_replication_role/,
    );
    for (const token of [
      "current_database()",
      "inet_server_addr()",
      "ConstraintCheckedPrismaClient",
      "ownedNative(dbB(),value.ownedIds)",
      "assertPlacementFixtureOwner(owner)",
      "createdById:owner.actorId",
      "sourceSiblingId",
      "caseFolderWrite.count",
      "auditLog.count",
    ]) {
      expect(native.replace(/\s/g, "")).toContain(token.replace(/\s/g, ""));
    }
  });
  it("source distinctly records Project allocator serialization vs unfenced suite/archive native trigger coverage", () => {
    const identity = readFileSync(
        new URL(
          "../../../packages/db/prisma/migrations/20261003060000_test_case_display_identity/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
      fields = readFileSync(
        new URL(
          "../../../packages/db/prisma/migrations/20261004030000_typed_case_fields/migration.sql",
          import.meta.url,
        ),
        "utf8",
      );
    expect(identity).toContain(
      'UPDATE "Project" SET "nextCaseNumber" = "nextCaseNumber" + 1',
    );
    const updateTrigger = fields.slice(
      fields.indexOf("CREATE TRIGGER vaettir_case_field_values_edit"),
    );
    expect(updateTrigger).not.toContain('"suitePath"');
    expect(updateTrigger).not.toContain('"archived"');
    expect(native).toContain("may already force");
    expect(native).toContain("Source");
    expect(native).toContain("NOT an observed native result");
  });
});
