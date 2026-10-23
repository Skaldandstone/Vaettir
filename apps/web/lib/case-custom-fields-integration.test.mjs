import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import ts from "typescript";
import {
  caseFieldReadPins,
  assertCaseFieldAcknowledgement,
  retainedCaseFieldReceipt,
} from "./case-field-origin.ts";
import { caseFieldValueControlElements as elements } from "./case-field-value-controls.fixture.mjs";
const source = readFileSync(
    new URL("../components/CaseCustomFields.tsx", import.meta.url),
    "utf8",
  ),
  ast = ts.createSourceFile(
    "CaseCustomFields.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
const origin = {
  projectId: "p",
  caseId: "c",
  organizationId: "org",
  clerkActorId: "actor",
};
const field = {
  key: "count",
  label: "Count",
  type: "NUMBER",
  options: [],
  required: false,
  retired: false,
};
const baseline = {
  expectedSchemaHash: "schema",
  expectedValueHash: "values",
  canEdit: true,
  schema: { fields: [field] },
  values: { count: 12, prose: " exact\ntext " },
};
function compile(code) {
  return ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
}
function named(name) {
  let found;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name)
      found = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(found);
  return found;
}
function formFixture() {
  const hooks = [],
    effects = [],
    publications = [],
    styleCalls = [],
    reads = [];
  let cursor = 0;
  const config = {
    version: 1,
    fields: { count: { widget: "AUTO", placeholder: "raw decimal" } },
  };
  const scope = {
    access: { origin, readable: true },
    fresh: baseline,
    styles: {
      data: { configuration: config },
      error: null,
      isPending: false,
      isFetchedAfterMount: true,
      isFetching: false,
      isPaused: false,
    },
  };
  function marker() {
    return null;
  }
  const context = {
    React,
    CaseFieldValueControls: marker,
    caseFieldReadPins,
    structuredClone,
    useRef: (value) => {
      const index = cursor++;
      return (hooks[index] ??= { current: value });
    },
    useState: (value) => {
      const index = cursor++;
      if (!Object.hasOwn(hooks, index)) hooks[index] = value;
      return [
        hooks[index],
        (next) => {
          hooks[index] = typeof next === "function" ? next(hooks[index]) : next;
        },
      ];
    },
    useCallback: (fn) => fn,
    useLayoutEffect: (callback) => {
      callback();
    },
    useEffect: (callback) => {
      effects.push(callback);
    },
    useCaseFieldAccess: () => ({
      ...scope.access,
      fresh: scope.fresh,
      query: { error: null, isFetching: false, isPaused: false },
    }),
    trpcReact: {
      caseFieldPresentation: {
        get: {
          useQuery: (input, options) => {
            reads.push({ input, options });
            return scope.styles;
          },
        },
      },
    },
    fieldStylesForSnapshot: (read, original, hash) => {
      styleCalls.push({ read, original, hash });
      return {
        configuration: read?.configuration,
        warning: read ? null : "Native fallback",
      };
    },
  };
  vm.createContext(context);
  vm.runInContext(
    compile(
      `${named("clientProblems").getText(ast)}\n${named("CaseCustomFieldsForm")
        .getText(ast)
        .replace(/^export /, "")}`,
    ),
    context,
  );
  const render = (extra = {}) => {
    cursor = 0;
    effects.length = 0;
    const tree = context.CaseCustomFieldsForm({
      projectId: "p",
      caseId: "c",
      onChange: (value) => publications.push(value),
      ...extra,
    });
    return {
      tree,
      flush: () => effects.splice(0).forEach((callback) => callback()),
    };
  };
  return {
    scope,
    config,
    reads,
    render,
    publications,
    styleCalls,
    control: (tree) => elements(tree).find((node) => node.type === marker),
  };
}
function editorFixture({
  retained = false,
  allowed = true,
  failure,
  onSend,
  wrongAck = false,
} = {}) {
  const input = {
    projectId: "p",
    caseId: "c",
    requestId: "original",
    values: { count: 12, prose: " exact\ntext " },
    expectedSchemaHash: "schema",
    expectedValueHash: "values",
    reason: "Reviewed",
    confirmed: true,
  };
  const pending = retained ? { input, origin, uncertain: true } : null;
  const draft = {
    customFields: input.values,
    expectedFieldSchemaHash: "schema",
    expectedCustomFieldRevision: "values",
    ready: true,
  };
  const state = {
      pending,
      draft,
      confirmed: true,
      reason: "Reviewed",
      revision: 0,
      open: true,
    },
    calls = [];
  let owns = allowed;
  const context = {
    projectId: "p",
    caseId: "c",
    access: { origin, canEdit: true, owns: () => owns },
    fresh: baseline,
    pendingRef: { current: pending },
    draftRef: { current: draft },
    reasonRef: { current: "Reviewed" },
    confirmedRef: { current: true },
    busyRef: { current: false },
    frameRef: { current: { projectId: "p", caseId: "c" } },
    save: {
      isPending: false,
      mutateAsync: async (body) => {
        calls.push(body);
        await onSend?.(context);
        if (failure) throw failure;
        return {
          requestId: wrongAck ? "wrong" : body.requestId,
          replayed: retained,
        };
      },
    },
    crypto: { randomUUID: () => "new-uuid" },
    structuredClone,
    assertCaseFieldAcknowledgement,
    retainedCaseFieldReceipt,
    utils: {
      caseFields: { get: { invalidate: async () => calls.push("fields") } },
      testCases: { byId: { invalidate: async () => calls.push("case") } },
    },
    setDraft: (value) => {
      state.draft = value;
    },
    setConfirmed: (value) => {
      state.confirmed = value;
    },
    setPending: (value) => {
      state.pending =
        typeof value === "function" ? value(state.pending) : value;
    },
    setNotice: (value) => {
      state.notice = value;
    },
    setReason: (value) => {
      state.reason = value;
    },
    setRevision: (fn) => {
      state.revision = fn(state.revision);
    },
    setOpen: (value) => {
      state.open = value;
    },
  };
  const editor = named("CaseFieldEditor");
  const update = editor.body.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration) => declaration.name.getText(ast) === "updateDraft",
      ),
  );
  const declaration = update.declarationList.declarations.find(
    (declaration) => declaration.name.getText(ast) === "updateDraft",
  );
  vm.createContext(context);
  vm.runInContext(
    compile(
      `${named("commit").getText(ast)}\nconst updateDraft = ${declaration.initializer.arguments[0].getText(ast)}; globalThis.actualUpdateDraft = updateDraft;`,
    ),
    context,
  );
  return {
    context,
    state,
    calls,
    pending,
    input,
    draft,
    commit: context.commit,
    updateDraft: context.actualUpdateDraft,
    revoke: () => {
      owns = false;
    },
  };
}
test("actual form admits authorized pinned styles only with its schema baseline, and later style changes do not reseed values", () => {
  const h = formFixture();
  h.render().flush();
  let render = h.render();
  render.flush();
  assert.equal(h.reads[0].input.originalOrganizationId, "org");
  assert.equal(h.reads[0].input.expectedClerkActorId, "actor");
  assert.equal(h.styleCalls.length, 1);
  assert.equal(h.styleCalls[0].hash, "schema");
  const first = h.control(render.tree);
  assert.equal(
    first.props.presentation.fields.count.placeholder,
    "raw decimal",
  );
  first.props.onChange({ ...baseline.values, prose: " unsaved raw\nprose " });
  h.scope.styles = {
    ...h.scope.styles,
    data: { configuration: { version: 1, fields: {} } },
  };
  render = h.render();
  render.flush();
  assert.equal(h.styleCalls.length, 1);
  assert.equal(
    h.control(render.tree).props.presentation.fields.count.placeholder,
    "raw decimal",
  );
  assert.equal(
    h.control(render.tree).props.values.prose,
    " unsaved raw\nprose ",
  );
});
test("cache-only style data cannot pin a baseline, values or presentation before a completed mount read", () => {
  const h = formFixture();
  h.scope.styles.isFetchedAfterMount = false;
  h.render().flush();
  let rendered = h.render();
  rendered.flush();
  assert.equal(h.styleCalls.length, 0);
  assert.equal(h.control(rendered.tree), undefined);
  assert.equal(h.publications.at(-1), null);
  h.scope.styles.isFetching = true;
  h.render().flush();
  assert.equal(h.styleCalls.length, 0);
  h.scope.styles.isFetching = false;
  h.scope.styles.isFetchedAfterMount = true;
  h.render().flush();
  rendered = h.render();
  rendered.flush();
  assert.equal(h.styleCalls.length, 1);
  assert.equal(h.control(rendered.tree).props.values.count, 12);
  assert.equal(
    h.control(rendered.tree).props.presentation.fields.count.placeholder,
    "raw decimal",
  );
});
test("style read failure admits warned native fallback without resetting metadata or fabricating settings", () => {
  const h = formFixture();
  h.scope.styles.isFetchedAfterMount = false;
  h.scope.styles.error = new Error("Synthetic failure");
  h.render().flush();
  const render = h.render();
  render.flush();
  assert.equal(h.control(render.tree).props.presentation, undefined);
  assert.equal(h.control(render.tree).props.values.count, 12);
  assert.ok(
    elements(render.tree).some(
      (node) =>
        node.type === "p" &&
        String(node.props.children).includes("Native controls"),
    ),
  );
});
test("actual form publishes invalid numeric state immediately and standalone save cannot use the previous native number", async () => {
  const form = formFixture(),
    editor = editorFixture();
  form.render().flush();
  let render = form.render({ onChange: editor.updateDraft });
  render.flush();
  const control = form.control(render.tree);
  control.props.onValidityChange(false, ["Invalid number"]);
  assert.equal(editor.context.draftRef.current.ready, false);
  editor.context.confirmedRef.current = true;
  await editor.commit();
  assert.deepEqual(editor.calls, []);
  assert.equal(editor.context.draftRef.current.customFields.count, 12);
});
test("inactive/access-loss placeholders preserve the mounted control session and invalid local readiness", () => {
  const h = formFixture();
  h.render().flush();
  let render = h.render();
  render.flush();
  const original = h.control(render.tree);
  original.props.onValidityChange(false, []);
  h.scope.access.readable = false;
  h.scope.fresh = null;
  render = h.render({ active: false });
  render.flush();
  const hidden = h.control(render.tree);
  assert.equal(hidden.key, original.key);
  assert.deepEqual(Array.from(hidden.props.fields), []);
  assert.deepEqual({ ...hidden.props.values }, {});
  assert.equal(hidden.props.disabled, true);
  hidden.props.onValidityChange(true, []);
  h.scope.access.readable = true;
  h.scope.fresh = baseline;
  render = h.render();
  render.flush();
  assert.equal(h.publications.at(-1).ready, false);
});
test("same-event double save gets one UUID and frozen cloned body; definitive refusal keeps the unsaved draft", async () => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const h = editorFixture({
    onSend: async () => held,
    failure: { data: { code: "CONFLICT" } },
  });
  const first = h.commit();
  await h.commit();
  assert.equal(h.calls.length, 1);
  h.draft.customFields.prose = "later external mutation";
  assert.equal(h.calls[0].values.prose, " exact\ntext ");
  release();
  await first;
  assert.equal(h.state.pending, null);
  assert.equal(h.context.draftRef.current, h.draft);
  assert.equal(h.state.revision, 0);
  assert.equal(h.state.open, true);
});
test("unknown acknowledgement retries exact original body and blocked mounted-form updates cannot replace it", async () => {
  const h = editorFixture({ retained: true, wrongAck: true });
  h.updateDraft(null);
  assert.equal(h.context.draftRef.current, h.draft);
  await h.commit();
  const held = h.context.pendingRef.current;
  assert.equal(held.input, h.input);
  assert.equal(held.uncertain, true);
  await h.commit();
  assert.equal(h.calls[0], h.input);
  assert.equal(h.calls[1], h.input);
  assert.equal(h.state.revision, 0);
});
test("known late ACK consumes only its original receipt, with no draft/buffer/notices/cache/frame changes", async () => {
  let h;
  h = editorFixture({ retained: true, onSend: () => h.revoke() });
  await h.commit();
  assert.equal(h.state.pending, null);
  assert.equal(h.context.draftRef.current, h.draft);
  assert.equal(h.state.notice, null);
  assert.equal(h.state.revision, 0);
  assert.equal(h.state.open, true);
  assert.equal(h.calls.length, 1);
});
test("older ACK cannot consume a replacement pending request or reset a newer draft", async () => {
  const replacement = {
    input: { requestId: "newer" },
    uncertain: true,
    origin,
  };
  let h;
  h = editorFixture({
    retained: true,
    onSend: (context) => {
      context.pendingRef.current = replacement;
      h.state.pending = replacement;
      context.draftRef.current = { ...h.draft, ready: false };
    },
  });
  await h.commit();
  assert.equal(h.state.pending, replacement);
  assert.equal(h.context.draftRef.current.ready, false);
  assert.equal(h.state.revision, 0);
  assert.equal(h.calls.length, 1);
});
test("source always mounts the form with pending hidden/inactive and admits styles only during initial baseline", () => {
  assert.match(
    source,
    /<div hidden=\{!!pending \|\| !access.readable\}>\s*<CaseCustomFieldsForm/,
  );
  assert.match(
    source,
    /active=\{open && access.authReady && !pending && !save.isPending\}/,
  );
  assert.doesNotMatch(source, /!pending && \(\s*<CaseCustomFieldsForm/);
  assert.match(source, /!baseline &&\s*fresh &&/);
  assert.match(source, /fieldStylesForSnapshot\(/);
});
