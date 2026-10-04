import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

// Execute the actual component handler bodies, not a second lifecycle model.
// This covers handler/state contracts only; real mounted React/QueryClient,
// native focus, desktop/mobile and late-response rendering remain separate.
const source = readFileSync(
  new URL("../components/ReportBuilder.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "ReportBuilder.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const component = ast.statements.find(
  (statement) =>
    ts.isFunctionDeclaration(statement) &&
    statement.name?.text === "ProjectReportBuilder",
);
assert.ok(component?.body);
const names = [
  "begin",
  "closeBuilder",
  "keepCurrentReport",
  "applyStart",
  "requestStart",
  "publish",
];
const printer = ts.createPrinter();
const handlers = names
  .map((name) => {
    const declaration = component.body.statements.find(
      (statement) =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === name,
    );
    assert.ok(declaration, `actual ${name} handler exists`);
    return printer.printNode(ts.EmitHint.Unspecified, declaration, ast);
  })
  .join("\n");
const compiled = ts.transpileModule(handlers, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  },
}).outputText;
const fresh = () => ({
  audience: "stakeholders",
  templateId: "quality-status",
  windowDays: 30,
  sections: ["inventory", "execution", "defects"],
  summary: "",
  risks: "",
  nextActions: "",
});
function fixture() {
  const state = {
    readOnly: false,
    busy: false,
    actorMatches: true,
    workflowMatches: true,
    userId: "synthetic-actor",
    project: {
      data: { id: "synthetic-project", organizationId: "synthetic-org" },
    },
    projectId: "synthetic-project",
    workflowOrigin: null,
    draftStatus: "empty",
    replacement: null,
    focusEvents: [],
    open: false,
    title: "Quality status review",
    definition: fresh(),
    step: 0,
    request: null,
    saveRequest: null,
    review: null,
    resumeId: "",
    message: "",
    current: null,
    availableDefinitions: [],
    availableDrafts: [],
    freshDefinition: fresh,
    liveScope: {
      current: {
        actor: "synthetic-actor",
        organizationId: "synthetic-org",
        ready: true,
      },
    },
    approve: {
      mutateAsync: async () => ({
        id: "synthetic-approved",
        payload: { state: "approved" },
      }),
    },
    utils: { reportSnapshots: { catalog: { invalidate: async () => {} } } },
  };
  state.closeButton = { current: { focus: () => {
    state.focusEvents.push({ replacement: state.replacement, draft: draft(state) });
  } } };
  for (const field of [
    "workflowOrigin",
    "draftStatus",
    "replacement",
    "open",
    "title",
    "definition",
    "step",
    "request",
    "saveRequest",
    "review",
    "resumeId",
    "message",
  ]) {
    state[`set${field[0].toUpperCase()}${field.slice(1)}`] = (value) => {
      state[field] = value;
    };
  }
  const context = createContext(state);
  return {
    state,
    handlers: runInContext(`${compiled}; ({${names.join(",")}})`, context),
  };
}
const target = (kind, source) => ({
  kind,
  ...(source ? { source } : {}),
  actor: "synthetic-actor",
  organizationId: "synthetic-org",
});
const authored = (state) => {
  state.title = "Synthetic retained stakeholder review";
  state.step = 3;
  state.definition = {
    ...fresh(),
    sections: ["execution", "automation"],
    summary: "Exact authored summary",
    risks: "Literal risk",
    nextActions: "Next reviewed action",
    dateInterval: { start: "2026-09-01", end: "2026-09-30" },
    executionScope: {
      planId: "synthetic-plan",
      runId: "synthetic-run",
      platform: "Synthetic PC",
      environment: "Synthetic lab",
      build: "Synthetic build",
      releaseId: "synthetic-release",
    },
  };
};
const draft = (state) =>
  JSON.stringify({
    title: state.title,
    definition: state.definition,
    step: state.step,
    request: state.request,
    saveRequest: state.saveRequest,
    review: state.review,
    resumeId: state.resumeId,
    workflowOrigin: state.workflowOrigin,
    draftStatus: state.draftStatus,
  });

test("closing and reopening preserves every unsubmitted field and current wizard screen", () => {
  const { state, handlers: h } = fixture();
  h.begin();
  authored(state);
  const before = draft(state);
  h.closeBuilder();
  assert.equal(state.open, false);
  h.begin();
  assert.equal(state.open, true);
  assert.equal(draft(state), before);
  assert.equal(state.title, "Synthetic retained stakeholder review");
  assert.equal(state.step, 3);
});
test("closing at an untouched purpose screen still resumes that same draft", () => {
  const { state, handlers: h } = fixture();
  h.begin();
  const definition = state.definition;
  h.closeBuilder();
  h.begin();
  assert.equal(state.definition, definition);
  assert.equal(state.draftStatus, "draft");
});
test("unknown preview/save UUIDs and frozen preview pointers survive close/reopen", () => {
  for (const field of ["request", "saveRequest"]) {
    const { state, handlers: h } = fixture();
    h.begin();
    authored(state);
    state[field] = {
      requestId: "exact-synthetic-uuid",
      title: state.title,
      definition: state.definition,
    };
    state.review = { id: "retained-preview" };
    state.resumeId = "retained-server-preview";
    const before = draft(state),
      payload = state[field];
    h.closeBuilder();
    h.begin();
    assert.equal(draft(state), before);
    assert.equal(state[field], payload);
    h.requestStart(target("fresh"));
    h.applyStart(target("fresh"));
    assert.equal(draft(state), before);
    assert.equal(state.replacement, null);
  }
});
test("choosing another definition/preview or a fresh report requires explicit replacement", () => {
  for (const kind of ["fresh", "definition", "preview"]) {
    const { state, handlers: h } = fixture();
    h.begin();
    authored(state);
    const source =
      kind === "definition"
        ? {
            id: "saved-definition",
            name: "Saved synthetic settings",
            definition: fresh(),
          }
        : { id: "saved-preview", title: "Saved synthetic preview" };
    if (kind === "definition") state.availableDefinitions = [source];
    if (kind === "preview") state.availableDrafts = [source];
    const before = draft(state),
      next = target(kind, source);
    h.requestStart(next);
    assert.equal(draft(state), before);
    assert.equal(state.replacement, next);
    h.closeBuilder();
    assert.equal(state.replacement, null);
    assert.equal(draft(state), before);
    h.requestStart(next);
    h.applyStart(state.replacement);
    assert.equal(state.replacement, null);
    assert.equal(state.draftStatus, "draft");
    assert.equal(state.step, kind === "preview" ? 4 : 0);
    assert.equal(state.resumeId, kind === "preview" ? source.id : "");
    assert.equal(
      state.title,
      kind === "definition" ? source.name : "Quality status review",
    );
  }
});
test("fresh selection cannot replace the draft after actor/org/access changes or stale source", () => {
  for (const failure of ["readOnly", "actor", "organization", "source"]) {
    const { state, handlers: h } = fixture();
    h.begin();
    authored(state);
    const saved = {
      id: "saved-definition",
      name: "Synthetic replacement",
      definition: fresh(),
    };
    state.availableDefinitions = [saved];
    const next = target("definition", saved);
    h.requestStart(next);
    const before = draft(state);
    if (failure === "readOnly") state.readOnly = true;
    if (failure === "actor") state.userId = "other-actor";
    if (failure === "organization")
      state.project.data.organizationId = "other-org";
    if (failure === "source") state.availableDefinitions = [{ ...saved }];
    h.applyStart(next);
    assert.equal(draft(state), before);
    assert.equal(state.replacement, next);
  }
});
test("saved preview selection survives closing without silently resetting to purpose", () => {
  const { state, handlers: h } = fixture();
  const saved = { id: "saved-preview", title: "Synthetic private preview" };
  state.availableDrafts = [saved];
  h.requestStart(target("preview", saved));
  const before = draft(state);
  h.closeBuilder();
  h.begin();
  assert.equal(draft(state), before);
  assert.equal(state.step, 4);
  assert.equal(state.resumeId, saved.id);
});
test("acknowledged publication permits the next fresh report even when catalog refresh fails", async () => {
  const { state, handlers: h } = fixture();
  h.begin();
  authored(state);
  state.request = { requestId: "accepted-preview-uuid" };
  state.current = {
    id: "synthetic-preview",
    reviewOrgId: "synthetic-org",
    payload: { state: "preview" },
  };
  state.utils.reportSnapshots.catalog.invalidate = async () => {
    throw Error("Synthetic offline refresh");
  };
  await h.publish();
  assert.equal(state.draftStatus, "published");
  assert.equal(state.open, false);
  assert.equal(state.review.id, "synthetic-approved");
  assert.match(state.message, /acknowledged/);
  h.begin();
  assert.equal(state.draftStatus, "draft");
  assert.equal(state.title, "Quality status review");
  assert.equal(state.step, 0);
  assert.equal(state.review, null);
});
test("unknown approval or switched-scope acknowledgement cannot unlock a fresh draft", async () => {
  for (const switched of [false, true]) {
    const { state, handlers: h } = fixture();
    h.begin();
    authored(state);
    state.request = { requestId: "exact-preview-uuid" };
    state.current = {
      id: "retained-preview",
      reviewOrgId: "synthetic-org",
      payload: { state: "preview" },
    };
    if (switched) state.liveScope.current.actor = "other-actor";
    else
      state.approve.mutateAsync = async () => {
        throw Error("Synthetic unknown response");
      };
    const before = draft(state);
    await h.publish();
    assert.equal(draft(state), before);
    h.closeBuilder();
    h.begin();
    assert.equal(draft(state), before);
  }
});
test("replacement UI and lifecycle source keep actor/cache gates and explicit local-only retention", () => {
  const normalized = source.replace(/\s+/g, " ");
  assert.match(normalized, /Resume local report draft/);
  assert.match(
    normalized,
    /Reloading or leaving the project may lose an unsubmitted local draft/,
  );
  assert.match(normalized, /Review replacement of unfinished report/);
  assert.match(normalized, /Keep current report/);
  assert.match(normalized, /Discard local draft and continue/);
  assert.match(
    normalized,
    /replacement.actor === userId && replacement.organizationId === project.data\?\.organizationId/,
  );
  assert.match(normalized, /disabled=\{!replacementReady\}/);
  assert.match(
    normalized,
    /availableDefinitions\?\.some\(\(?row\)? => row === replacement.source\)/,
  );
  assert.match(
    normalized,
    /availableDrafts\?\.some\(\(?row\)? => row === replacement.source\)/,
  );
});

test("keeping the local report restores visible focus before clearing the replacement", () => {
  const { state, handlers: h } = fixture();
  h.begin();
  authored(state);
  h.requestStart(target("fresh"));
  const replacement = state.replacement, before = draft(state);
  state.focusEvents = [];
  h.keepCurrentReport();
  assert.equal(state.focusEvents.length, 1);
  assert.equal(state.focusEvents[0].replacement, replacement);
  assert.equal(state.focusEvents[0].draft, before);
  assert.equal(state.replacement, null);
  assert.equal(draft(state), before);
  assert.match(source.replace(/\s+/g, " "), /ref=\{closeButton\} className="btn-secondary modal-close"/);
  assert.match(source, /onClick=\{keepCurrentReport\}>Keep current report/);
});

test("replacement confirmation focuses before writes and refused routes never focus or clear review", () => {
  for (const action of ["keepCurrentReport", "applyStart"]) {
    for (const failure of ["readOnly", "busy", "actor", "organization", "request", "saveRequest", "source"]) {
      if (action === "keepCurrentReport" && failure === "source") continue;
      const { state, handlers: h } = fixture();
      h.begin();
      authored(state);
      const saved = { id: "saved-definition", name: "Synthetic next", definition: fresh() };
      state.availableDefinitions = [saved];
      const next = target("definition", saved);
      h.requestStart(next);
      if (failure === "readOnly" || failure === "busy") state[failure] = true;
      if (failure === "actor") state.userId = "other-actor";
      if (failure === "organization") state.project.data.organizationId = "other-org";
      if (failure === "request" || failure === "saveRequest") state[failure] = { requestId: "retained-uuid" };
      if (failure === "source") state.availableDefinitions = [{ ...saved }];
      const before = draft(state);
      state.focusEvents = [];
      h[action](next);
      assert.equal(state.focusEvents.length, 0, `${action}/${failure}`);
      assert.equal(state.replacement, next);
      assert.equal(draft(state), before);
    }
  }
  const { state, handlers: h } = fixture();
  h.begin();
  authored(state);
  const next = target("fresh");
  h.requestStart(next);
  const before = draft(state);
  state.focusEvents = [];
  h.applyStart(next);
  assert.equal(state.focusEvents.length, 1);
  assert.equal(state.focusEvents[0].replacement, next);
  assert.equal(state.focusEvents[0].draft, before);
  assert.equal(state.replacement, null);
  assert.equal(state.title, "Quality status review");
});
