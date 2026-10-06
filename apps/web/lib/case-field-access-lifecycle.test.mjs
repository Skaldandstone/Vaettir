// Execute the actual access publication/cleanup and asynchronous handlers.
// These isolated lifecycle regressions are not mounted browser/auth proof.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  sameCaseFieldOrigin,
  assertCaseFieldAcknowledgement,
  retainedCaseFieldReceipt,
} from "./case-field-origin.ts";

const source = readFileSync(
  new URL("./use-case-field-access.ts", import.meta.url),
  "utf8",
);
const parsed = ts.createSourceFile(
  "access.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
);
const hook = parsed.statements.find(
  (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === "useCaseFieldAccess",
);
assert.ok(hook?.body);
const publication = hook.body.statements.find(
  (node) =>
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(parsed) === "useLayoutEffect",
);
const owns = hook.body.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "owns",
);
assert.ok(publication && owns);
const compiledAccess = ts.transpileModule(
  `const publish = ${publication.expression.arguments[0].getText(parsed)}; ${owns.getText(parsed)}; ({publish, owns});`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  },
).outputText;
const original = {
  projectId: "p",
  caseId: "c",
  organizationId: "org-a",
  clerkActorId: "actor-a",
};

function accessFixture(origin = original) {
  const context = {
    current: origin,
    fresh: { canEdit: true, canConfigure: true },
    accessNow: {
      current: { current: null, canEdit: false, canConfigure: false },
    },
    sameCaseFieldOrigin,
  };
  const actual = runInNewContext(compiledAccess, context, { timeout: 1000 });
  return { context, ...actual };
}
function assertRevoked(owns, origin = original) {
  for (const mode of ["read", "edit", "configure"])
    assert.equal(owns(origin, mode), false, mode);
}
test("layout cleanup revokes all retained callbacks before unmount completes", () => {
  const h = accessFixture();
  assertRevoked(h.owns);
  const cleanup = h.publish();
  for (const mode of ["read", "edit", "configure"])
    assert.equal(h.owns(original, mode), true);
  assert.equal(
    typeof cleanup,
    "function",
    "A retained asynchronous callback must lose authority on unmount",
  );
  cleanup();
  assertRevoked(h.owns);
  cleanup();
  assertRevoked(h.owns);
});
test("StrictMode setup cleanup setup restores only the same committed instance", () => {
  const h = accessFixture();
  h.publish()();
  assertRevoked(h.owns);
  const cleanup = h.publish();
  assert.equal(h.owns(original, "edit"), true);
  cleanup();
  assertRevoked(h.owns);
  const replacement = accessFixture();
  replacement.publish();
  assert.equal(replacement.owns(original, "edit"), true);
  assertRevoked(h.owns);
});
test("access updates publish fresh identity and roles only after revoking the prior state", () => {
  const h = accessFixture();
  let cleanup = h.publish();
  cleanup();
  h.context.current = { ...original, clerkActorId: "actor-b" };
  cleanup = h.publish();
  assertRevoked(h.owns);
  cleanup();
  h.context.current = original;
  h.context.fresh = { canEdit: false, canConfigure: false };
  cleanup = h.publish();
  assert.equal(h.owns(original), true);
  assert.equal(h.owns(original, "edit"), false);
  assert.equal(h.owns(original, "configure"), false);
  cleanup();
  h.context.current = null;
  h.context.fresh = null;
  h.publish();
  assertRevoked(h.owns);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function handlerFixture(component, mutation) {
  const origin =
    component === "ProjectCaseFields"
      ? { ...original, caseId: null }
      : original;
  const h = accessFixture(origin),
    cleanup = h.publish(),
    held = deferred();
  const text = readFileSync(
    new URL(`../components/${component}.tsx`, import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "component.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let handler;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "commit")
      handler = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(handler);
  const input = {
    projectId: "p",
    caseId: "c",
    requestId: "original-uuid",
    values: { count: 0, flag: false, note: "Original private draft" },
  };
  const pending = { input, origin, uncertain: true };
  const state = {
    pending,
    open: true,
    revision: 0,
    cursor: "original-page",
    selection: { auditId: "original-audit" },
  };
  const calls = [];
  const invalidate = async () => {
    calls.push("invalidate");
  };
  const context = {
    pending,
    projectId: "p",
    caseId: "c",
    busy: false,
    ...(component === "CaseCustomFields"
      ? {
          pendingRef: { current: pending },
          draftRef: { current: null },
          busyRef: { current: false },
          reasonRef: { current: "" },
          confirmedRef: { current: false },
          frameRef: { current: { projectId: "p", caseId: "c" } },
        }
      : {}),
    access: { origin, canEdit: true, canConfigure: true, owns: h.owns },
    [mutation]: {
      isPending: false,
      mutateAsync: (value) => {
        calls.push(value);
        return held.promise;
      },
    },
    utils: {
      caseFields: { get: { invalidate }, history: { invalidate } },
      testCases: { byId: { invalidate } },
    },
    assertCaseFieldAcknowledgement,
    retainedCaseFieldReceipt,
  };
  for (const key of [
    "pending",
    "open",
    "revision",
    "cursor",
    "selection",
    "notice",
    "reason",
    "confirmed",
  ]) {
    context[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => {
      state[key] = typeof value === "function" ? value(state[key]) : value;
    };
  }
  const compiled = ts.transpileModule(`${handler.getText(ast)}; commit;`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  const commit = runInNewContext(compiled, context, { timeout: 1000 });
  return { state, input, pending, calls, held, cleanup, commit, owns: h.owns };
}
for (const [component, mutation] of [
  ["CaseCustomFields", "save"],
  ["CaseFieldHistory", "restore"],
  ["ProjectCaseFields", "configure"],
]) {
  test(`${component}: held original ACK after unmount cannot invalidate or navigate the replacement view`, async () => {
    const h = handlerFixture(component, mutation),
      task = h.commit(h.input);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0], h.input);
    h.cleanup();
    h.held.resolve({ requestId: h.input.requestId, replayed: true });
    await task;
    assert.equal(
      h.state.pending,
      null,
      "Only the exact original acknowledged receipt is consumed",
    );
    assert.equal(h.calls.length, 1, "No late cache invalidation");
    assert.equal(h.state.open, true);
    assert.equal(h.state.revision, 0);
    assert.equal(h.state.cursor, "original-page");
    assert.equal(h.state.selection.auditId, "original-audit");
    assert.equal(h.state.reason, undefined);
    assert.equal(h.state.confirmed, undefined);
  });
  test(`${component}: lost held ACK after unmount retains the original unknown request`, async () => {
    const h = handlerFixture(component, mutation),
      task = h.commit(h.input);
    h.cleanup();
    h.held.reject(new Error("Synthetic lost acknowledgement"));
    await task;
    assert.equal(h.state.pending.input, h.input);
    assert.equal(h.state.pending.origin, h.pending.origin);
    assert.equal(h.state.pending.uncertain, true);
    assert.equal(h.calls.length, 1);
    await h.commit(h.input);
    assert.equal(h.calls.length, 1, "Dead instance cannot retry");
  });
}
