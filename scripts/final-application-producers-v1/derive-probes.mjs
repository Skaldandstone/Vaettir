// Deterministic AST derivation of retained integration assertions; never executes them.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  sha,
  requireThat as ok,
} from "../production-native-successor-v1/contracts.mjs";
import { assertProbeEnvironment, assertSubset } from "./probe-guard.mjs";
const require = createRequire(import.meta.url),
  root = fileURLToPath(new URL("./", import.meta.url));
const compilerPin = JSON.parse(readFileSync(root + "policy.json")).typescript,
  compilerBytes = readFileSync(require.resolve("typescript"));
ok(
  compilerPin &&
    compilerBytes.length === compilerPin.bytes &&
    sha(compilerBytes) === compilerPin.sha256,
  "TypeScript compiler bytes changed",
);
const ts = require("typescript");
ok(ts.version === compilerPin.version, "TypeScript compiler version changed");
const printer = ts.createPrinter(),
  emit = (n, s) => printer.printNode(ts.EmitHint.Unspecified, n, s);
function callName(n) {
  return ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
    ? n.expression.expression.getText()
    : "";
}
export function deriveProbe(role, source, raw, pin) {
  ok(
    ["plugin", "android", "import"].includes(role) &&
      /^[a-f0-9]{40}$/.test(source) &&
      sha(raw) === pin,
    "Pinned test source required",
  );
  const s = ts.createSourceFile(
    "fixture.ts",
    raw.toString(),
    ts.ScriptTarget.Latest,
    true,
  );
  ok(s.parseDiagnostics.length === 0, "Fixture syntax");
  const suite = s.statements.find((n) => callName(n).startsWith("describe"));
  ok(suite, "Missing suite");
  const cb = suite.expression.arguments.find(ts.isArrowFunction);
  ok(cb && ts.isBlock(cb.body), "Missing suite body");
  const tests = cb.body.statements.filter((n) => callName(n) === "it");
  const imports = s.statements
    .filter(ts.isImportDeclaration)
    .filter((n) => {
      const p = n.moduleSpecifier.text;
      return (
        p === "node:crypto" ||
        p === "@vaettir/db" ||
        p === "fastify" ||
        p.startsWith("./services/") ||
        p === "./routers/importJobs.js"
      );
    })
    .filter(
      (n) =>
        !n.importClause?.isTypeOnly &&
        (role !== "import" ||
          ["node:crypto", "@vaettir/db", "./routers/importJobs.js"].includes(
            n.moduleSpecifier.text,
          )),
    );
  let parts = imports.map((n) => emit(n, s));
  if (role === "import") {
    const globals = s.statements.filter(
      (n) =>
        ts.isVariableStatement(n) &&
        n.declarationList.declarations.some((d) =>
          ["tag", "orgId"].includes(d.name.getText()),
        ),
    );
    const hook = s.statements.find((n) => callName(n) === "beforeAll");
    ok(globals.length === 2 && hook, "Missing import setup");
    let setup = emit(hook, s);
    ok(setup.split("assertDatabase();").length === 2, "Import guard drift");
    setup = setup.replace("assertDatabase();", "");
    parts.push(...globals.map((n) => emit(n, s)), setup);
    const each = cb.body.statements[0];
    ok(callName(each).startsWith("it.each("), "Missing exact CSV cases");
    const invocation = each.expression,
      values = invocation.expression.arguments[0],
      fn = invocation.arguments[1];
    ok(
      ts.isArrayLiteralExpression(values) &&
        values.elements.length === 2 &&
        ts.isArrowFunction(fn),
      "CSV cases changed",
    );
    parts.push(
      `${emit(values, s)}.forEach((csvText,index)=>it('unresolved CSV mapping route '+index, async()=>{${fn.body.statements.map((n) => emit(n, s)).join("\n")}}));`,
    );
  } else {
    const fixture = s.statements.find(
      (n) => ts.isFunctionDeclaration(n) && n.name?.text === "fixture",
    );
    ok(fixture, "Missing actual fixture");
    ok(
      tests.length === (role === "plugin" ? 4 : 5),
      "Changed original case count",
    );
    parts.push(emit(fixture, s), ...tests.map((n) => emit(n, s)));
  }
  if (role === "plugin")
    parts.push(readFileSync(root + "plugin-extra.mjs.txt", "utf8"));
  const chosen = ts.createSourceFile(
    "chosen.ts",
    parts.join("\n"),
    ts.ScriptTarget.Latest,
    true,
  );
  let assertions = 0,
    testCount = role === "import" ? 2 : tests.length;
  const transform = (context) => {
    const f = context.factory;
    const call = (name, args) =>
      f.createCallExpression(f.createIdentifier(name), undefined, args);
    function visit(n) {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression)
      ) {
        const matcher = n.expression.name.text;
        let base = n.expression.expression,
          negate = false,
          reject = false;
        if (ts.isPropertyAccessExpression(base) && base.name.text === "not") {
          negate = true;
          base = base.expression;
        }
        if (
          ts.isPropertyAccessExpression(base) &&
          base.name.text === "rejects"
        ) {
          reject = true;
          base = base.expression;
        }
        if (
          ts.isCallExpression(base) &&
          base.expression.getText() === "expect"
        ) {
          assertions++;
          const value = ts.visitNode(base.arguments[0], visit),
            args = n.arguments.map((a) => ts.visitNode(a, visit));
          if (reject) {
            ok(
              matcher === "toThrow" && !negate,
              "Unsupported rejection assertion",
            );
            return call("assert.rejects", [value, ...args]);
          }
          if (matcher === "toMatchObject") {
            ok(!negate, "Unsupported partial negation");
            return call("assertSubset", [value, ...args]);
          }
          if (matcher === "toHaveLength") {
            ok(!negate, "Unsupported length negation");
            return call("assert.equal", [
              f.createPropertyAccessExpression(value, "length"),
              ...args,
            ]);
          }
          if (matcher === "toContain") {
            ok(!negate, "Unsupported contains negation");
            return call("assert.ok", [
              f.createCallExpression(
                f.createPropertyAccessExpression(value, "includes"),
                undefined,
                args,
              ),
            ]);
          }
          const names = {
            toBe: negate ? "assert.notEqual" : "assert.equal",
            toEqual: negate ? "assert.notDeepEqual" : "assert.deepEqual",
            toMatch: negate ? "assert.doesNotMatch" : "assert.match",
            toBeNull: negate ? "assert.notEqual" : "assert.equal",
          };
          ok(names[matcher], "Unsupported matcher " + matcher);
          return call(names[matcher], [
            value,
            ...(matcher === "toBeNull" ? [f.createNull()] : args),
          ]);
        }
      }
      if (
        ts.isCallExpression(n) &&
        n.expression.getText() === "it" &&
        n.arguments.length === 3
      )
        return f.updateCallExpression(n, n.expression, n.typeArguments, [
          n.arguments[0],
          f.createObjectLiteralExpression([
            f.createPropertyAssignment("timeout", n.arguments[2]),
          ]),
          ts.visitNode(n.arguments[1], visit),
        ]);
      return ts.visitEachChild(n, visit, context);
    }
    return (node) => ts.visitNode(node, visit);
  };
  const transformed = ts.transform(chosen, [transform]);
  let code = printer.printFile(transformed.transformed[0]);
  transformed.dispose();
  const result = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    reportDiagnostics: true,
  });
  ok(
    !result.diagnostics?.some(
      (d) => d.category === ts.DiagnosticCategory.Error,
    ),
    "Transpile failure",
  );
  code = result.outputText;
  ok(
    !/\bexpect\(|skipIf|\.skip\(|vitest|assertDatabase/.test(code),
    "Untranslated/disabled fixture",
  );
  code = code
    .replaceAll('"./services/', '"./dist/services/')
    .replaceAll('"./routers/', '"./dist/routers/');
  // Dynamic imports follow the strict DB/image/process guard, before any fixture query.
  code = code
    .replace(
      /^import \{([^}]+)\} from "([^"]+)";$/gm,
      (_, names, p) => `const {${names}} = await import(${JSON.stringify(p)});`,
    )
    .replace(
      /^import Fastify from "fastify";$/m,
      'const {default:Fastify} = await import("fastify");',
    );
  if (role === "plugin") testCount += 2;
  const header = `import assert from 'node:assert/strict';\nimport {test as it,before as beforeAll,after as afterAll} from 'node:test';\n${assertProbeEnvironment.toString()}\n${assertSubset.toString()}\nassertProbeEnvironment(process.env,process.platform,process.cwd(),${JSON.stringify(source)},${JSON.stringify(role)});\nlet externalCalls=0;globalThis.fetch=async()=>{externalCalls++;throw Error('External provider calls forbidden');};\n`;
  return {
    code:
      header +
      code +
      `\nafterAll(async()=>{try{assert.equal(externalCalls,0);}finally{await prisma.$disconnect();}});\n`,
    tests: testCount,
    retainedAssertions: assertions,
    originalSha256: pin,
    compilerSha256: compilerPin.sha256,
    source,
    scope: "COMPILED_BACKEND_POSTGRES_ONLY",
    realDeviceAccepted: false,
    packagedMcpTransportAccepted: false,
    releaseAccepted: false,
  };
}
