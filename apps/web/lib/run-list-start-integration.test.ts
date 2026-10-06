// Actual route handlers + existing completion controller, with synthetic hooks,
// native metadata/auth/RPC boundaries. Not React DOM, SDK lifecycle or SQL proof.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { expect, it, vi } from "vitest";
import { applyRunBulkSelection } from "./run-bulk-selection";
import { currentSessionScope } from "./auth-query-cache";
import { RunConfigCompletionController } from "./run-config-completion";
import {
  freezeRunConfiguration,
  type ReviewedRunConfiguration,
} from "./run-configuration-request";
import type { RunConfigurationModal as ModalType } from "../components/RunConfigurationModal";
const source = readFileSync(
  new URL("../app/projects/[projectId]/test-runs/page.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "page.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const page = ast.statements.find(
  (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === "TestRunsPage",
)!;
const code = ts.transpileModule(
  ts
    .createPrinter()
    .printNode(ts.EmitHint.Unspecified, page, ast)
    .replace("export default ", "") + "\nthis.page = TestRunsPage;",
  {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
  },
).outputText;
type Element = React.ReactElement<Record<string, unknown>>;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return React.isValidElement<Record<string, unknown>>(node)
    ? text(node.props.children)
    : "";
}
type ConfigurationProps = React.ComponentProps<typeof ModalType>;
const stub = () => null;
function harness() {
  const slots: unknown[] = [];
  let cursor = 0,
    tree: unknown;
  const permissions = { canEdit: true, organizationId: "org" };
  const access = {
    ready: true,
    canWrite: true,
    origin: { organizationId: "org", clerkActorId: "clerk" },
  };
  const browser = {
    Clerk: { loaded: true, session: { id: "A", user: { id: "clerk" } } },
  };
  const all = Array.from({ length: 851 }, (_, i) => ({
    id: `case-${i}`,
    displayId: `TC-${i}`,
    title: `Case ${i}`,
    testType: "FUNCTIONAL",
    priority: i < 10 ? "HIGH" : "MEDIUM",
    tags: [i < 10 ? "matching" : "other"],
    suitePath: i % 2 ? "Suite A" : "Suite B",
    archived: false,
    reviewStatus: "APPROVED",
  }));
  const query = {
    data: [
      ...all,
      { ...all[0]!, id: "archived", archived: true },
      { ...all[0]!, id: "pending", reviewStatus: "PENDING_REVIEW" },
    ],
    isFetchedAfterMount: true,
    isFetching: false,
    isPaused: false,
    isLoading: false,
    error: null as Error | null,
  };
  const send = vi.fn<(request: ReviewedRunConfiguration) => Promise<unknown>>(),
    navigate = vi.fn();
  const mutation = { isPending: false, mutateAsync: send };
  const context = vm.createContext({
    React,
    window: browser,
    useState: (initial: unknown) => {
      const at = cursor++;
      if (at >= slots.length)
        slots[at] = typeof initial === "function" ? initial() : initial;
      return [
        slots[at],
        (next: unknown) => {
          slots[at] = typeof next === "function" ? next(slots[at]) : next;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const at = cursor++;
      if (at >= slots.length) slots[at] = { current: initial };
      return slots[at];
    },
    useSyncExternalStore: () => null,
    useParams: () => ({ projectId: "project" }),
    useRouter: () => ({ push: navigate }),
    useProjectPermissions: () => permissions,
    useManualExecutionAccess: () => access,
    currentSessionScope,
    applyRunBulkSelection,
    trpcReact: {
      testCases: { list: { useQuery: () => query } },
      manualExecution: { start: { useMutation: () => mutation } },
    },
    RunConfigurationModal: stub,
    Modal: stub,
    Drawer: stub,
    RunHistoryDashboard: stub,
    RunAllPagesDashboard: stub,
    CiRunDetail: stub,
    CoverageSection: stub,
    HealingSignalSection: stub,
    subscribeRunHash: () => {},
    readRunHash: () => null,
    inspectorLabel: (value: string) => value,
  });
  vm.runInContext(code, context);
  const route = context.page as () => unknown;
  function render() {
    cursor = 0;
    tree = route();
    return tree;
  }
  function button(label: string) {
    const found = elements(tree).find(
      (node) => node.type === "button" && text(node.props.children) === label,
    );
    if (!found) throw Error(`Missing button ${label}`);
    return found.props.onClick as () => unknown;
  }
  function change(label: string, value: string) {
    const nodes = elements(tree);
    const direct = nodes.find(
      (node) => node.type === "select" && node.props["aria-label"] === label,
    );
    const parent = nodes.find(
      (node) =>
        node.type === "label" && text(node.props.children).startsWith(label),
    );
    const found =
      direct ??
      elements(parent?.props.children).find((node) => node.type === "select");
    if (!found) throw Error(`Missing select ${label}`);
    (found.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value },
    });
    render();
  }
  function config() {
    return elements(tree).find(
      (node) => node.type === stub && node.props.onStart,
    )?.props as ConfigurationProps;
  }
  function toggleCase(displayId: string) {
    const label = elements(tree).find(
      (node) =>
        node.type === "label" && text(node.props.children).includes(displayId),
    );
    const checkbox = elements(label?.props.children).find(
      (node) => node.type === "input" && node.props.type === "checkbox",
    );
    if (!checkbox) throw Error("Missing actual case checkbox");
    (checkbox.props.onChange as () => void)();
  }
  function selectAll() {
    button("Start manual run")();
    render();
    change("Apply to approved scope", "all");
    button("Apply Set selection")();
    render();
  }
  render();
  return {
    render,
    button,
    change,
    config,
    toggleCase,
    selectAll,
    all,
    query,
    permissions,
    access,
    browser,
    send,
    navigate,
  };
}
function request(ids: string[]) {
  return freezeRunConfiguration(
    {
      projectId: "project",
      testCaseIds: ids,
      expectedProfileHash: "b".repeat(64),
      originalOrganizationId: "org",
      expectedClerkActorId: "clerk",
      executionContext: {
        configuration: "line one\nline two",
        platform: "",
        build: "0",
        hardwareRevision: "",
        firmwareVersion: "",
        rig: "",
        batchOrLot: "",
        environment: "",
        calibrationReference: "",
        protocolReference: "",
      },
    },
    "00000000-0000-4000-8000-000000000001",
  );
}
function ack(input: ReviewedRunConfiguration) {
  return {
    testRunId: `manual_${"a".repeat(64)}`,
    originalOrganizationId: input.originalOrganizationId,
    expectedClerkActorId: input.expectedClerkActorId,
    idempotencyKey: input.idempotencyKey,
  };
}
// Execute the actual modal's applyBulk closure with its real completion
// controller; surrounding hook/native-access inputs remain synthetic boundaries.
function modalBulk(
  props: ConfigurationProps,
  controller: RunConfigCompletionController,
  mode: "SET" | "ADD" | "REMOVE",
  candidates: string[],
) {
  const modalSource = readFileSync(
      new URL("../components/RunConfigurationModal.tsx", import.meta.url),
      "utf8",
    ),
    modalAst = ts.createSourceFile(
      "modal.tsx",
      modalSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
  let apply: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "applyBulk")
      apply = node;
    ts.forEachChild(node, visit);
  };
  visit(modalAst);
  if (!apply) throw Error("Actual modal bulk handler missing");
  const callback = vi.fn(props.onSelectionChange),
    context = vm.createContext({
      bulkScope: {
        key: "all",
        label: "Approved scope",
        testCaseIds: candidates,
      },
      onSelectionChange: callback,
      bulkScopesReady: props.bulkScopesReady,
      access: { canWrite: true },
      busy: false,
      refreshingNow: { current: false },
      controller,
      liveSession: () => ({ userId: "clerk", sessionId: "A" }),
      completion: controller.snapshot(),
      testCaseIds: props.testCaseIds,
      bulkMode: mode,
      applyRunBulkSelection,
      setError: vi.fn(),
      setReviewedCount: vi.fn(),
      setReviewedIds: vi.fn(),
      setBulkNotice: vi.fn(),
    });
  vm.runInContext(
    ts.transpileModule(
      ts.createPrinter().printNode(ts.EmitHint.Unspecified, apply, modalAst) +
        "\nthis.apply = applyBulk;",
      {
        compilerOptions: {
          module: ts.ModuleKind.None,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    context,
  );
  return { apply: context.apply as () => void, callback };
}
function reviewedController() {
  const controller = new RunConfigCompletionController("project", () => {}),
    session = { userId: "clerk", sessionId: "A" };
  controller.attach();
  controller.bindFrame({
    open: true,
    canWrite: true,
    scope: {
      projectId: "project",
      organizationId: "org",
      clerkActorId: "clerk",
      sessionId: "A",
    },
  });
  controller.review(session, controller.snapshot().activationEpoch);
  return { controller, session };
}
it("851 approved cases reach configuration review without a start call; archived/pending are excluded", () => {
  const h = harness();
  h.selectAll();
  h.button("Continue to configuration")();
  h.render();
  expect(h.config().testCaseIds).toEqual(h.all.map((item) => item.id));
  expect(h.config().caseCount).toBe(851);
  expect(Object.isFrozen(h.config().testCaseIds)).toBe(true);
  expect(h.config().open).toBe(true);
  expect(h.send).not.toHaveBeenCalled();
});
it("filter and suite scopes are explicit and browsing does not alter the already selected cohort", () => {
  const h = harness();
  h.button("Start manual run")();
  h.render();
  h.change("Run case priority", "HIGH");
  h.button("Apply Set selection")();
  h.render();
  h.change("Run case priority", "");
  h.change("Run case suite", "Suite A");
  h.button("Continue to configuration")();
  h.render();
  expect(h.config().testCaseIds).toEqual(
    h.all.slice(0, 10).map((item) => item.id),
  );
  const suite = harness();
  suite.button("Start manual run")();
  suite.render();
  suite.change("Run case suite", "Suite A");
  suite.change("Apply to approved scope", "suite");
  suite.button("Apply Set selection")();
  suite.render();
  suite.button("Continue to configuration")();
  suite.render();
  expect(suite.config().testCaseIds).toEqual(
    suite.all
      .filter((item) => item.suitePath === "Suite A")
      .map((item) => item.id),
  );
});
it.each(["fetching", "paused", "cached", "role", "actor", "retired"])(
  "first Continue refuses %s source/scope without starting",
  (mode) => {
    const h = harness();
    h.selectAll();
    if (mode === "fetching") h.query.isFetching = true;
    if (mode === "paused") h.query.isPaused = true;
    if (mode === "cached") h.query.isFetchedAfterMount = false;
    if (mode === "role") h.access.canWrite = false;
    if (mode === "actor") h.browser.Clerk.session.user.id = "other";
    if (mode === "retired")
      h.query.data = h.query.data.map((item) => ({
        ...item,
        reviewStatus: "PENDING_REVIEW",
      }));
    h.render();
    h.button("Continue to configuration")();
    h.render();
    expect(h.config().open).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  },
);
it("the mounted host retains original IDs across close, background metadata changes and reopening", () => {
  const h = harness();
  h.selectAll();
  h.button("Continue to configuration")();
  h.render();
  const first = h.config();
  first.onClose();
  h.query.data = [];
  h.render();
  expect(h.config().testCaseIds).toBe(first.testCaseIds);
  h.button("Reopen run configuration")();
  h.render();
  expect(h.config().open).toBe(true);
  expect(h.config().testCaseIds).toBe(first.testCaseIds);
  expect(h.send).not.toHaveBeenCalled();
});
it("a captured first Continue cannot replace the admitted cohort after background selection handlers run", () => {
  const h = harness();
  h.selectAll();
  const capturedContinue = h.button("Continue to configuration"),
    capturedClear = h.button("Clear selection");
  capturedContinue();
  const first = h.render();
  const admitted = h.config().testCaseIds;
  capturedClear();
  capturedContinue();
  h.render();
  expect(h.config().testCaseIds).toBe(admitted);
  expect(h.config().caseCount).toBe(851);
  expect(h.send).not.toHaveBeenCalled();
  expect(first).toBeTruthy();
});
it.each(["SET", "ADD", "REMOVE", "toggle", "clear"])(
  "captured pre-Continue is refused after an explicit %s event, before React publishes the new cohort",
  (operation) => {
    const h = harness();
    h.selectAll();
    const captured = h.button("Continue to configuration");
    if (operation === "clear") h.button("Clear selection")();
    else if (operation === "toggle") h.toggleCase("TC-0");
    else {
      h.change("Run case suite", "Suite A");
      h.change("Apply to approved scope", "suite");
      h.change("Selection operation", operation);
      h.button(
        `Apply ${operation === "SET" ? "Set" : operation === "ADD" ? "Add" : "Remove"} selection`,
      )();
    }
    captured();
    h.render();
    expect(h.config().open).toBe(false);
    expect(h.config().caseCount).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
    // A newly rendered explicit Continue can admit the revised cohort (except
    // clear); no old 851-case selection was silently substituted.
    if (operation !== "clear") {
      h.button("Continue to configuration")();
      h.render();
      expect(h.config().open).toBe(true);
    }
  },
);
it("host mutation forwards the complete frozen body but never navigates itself or accepts replacement IDs", async () => {
  const h = harness();
  h.selectAll();
  h.button("Continue to configuration")();
  h.render();
  const props = h.config(),
    input = request(props.testCaseIds);
  h.send.mockResolvedValue(ack(input));
  expect(await props.onStart(input)).toEqual(ack(input));
  expect(h.send).toHaveBeenCalledWith(input);
  expect(h.navigate).not.toHaveBeenCalled();
  expect(h.send.mock.calls[0]![0]).toBe(input);
  expect(input.executionContext).toMatchObject({
    configuration: "line one\nline two",
    platform: "",
    build: "0",
  });
  await expect(
    props.onStart({ ...input, testCaseIds: ["replacement"] }),
  ).rejects.toThrow("originally reviewed selection");
  expect(h.send).toHaveBeenCalledOnce();
});
it.each(["SET", "ADD", "REMOVE"] as const)(
  "actual Stage2 %s explicitly changes only the approved pre-send cohort",
  (mode) => {
    const h = harness();
    h.selectAll();
    h.button("Continue to configuration")();
    h.render();
    const props = h.config(),
      { controller } = reviewedController();
    const bulk = modalBulk(
      props,
      controller,
      mode,
      h.all.slice(0, 10).map((item) => item.id),
    );
    bulk.apply();
    h.render();
    const expected = applyRunBulkSelection(
      props.testCaseIds,
      h.all.slice(0, 10).map((item) => item.id),
      mode,
    );
    if (!expected.ok) throw Error("Synthetic expected selection refused");
    expect(bulk.callback).toHaveBeenCalledOnce();
    expect(h.config().testCaseIds).toEqual(expected.ids);
    expect(Object.isFrozen(h.config().testCaseIds)).toBe(true);
    expect(h.send).not.toHaveBeenCalled();
  },
);
it("old Stage2 callback cannot overwrite a later explicit cohort before React publishes the new revision", () => {
  const h = harness();
  h.selectAll();
  h.button("Continue to configuration")();
  h.render();
  const old = h.config().onSelectionChange!;
  old(["case-0"]);
  old(["case-1"]);
  h.render();
  expect(h.config().testCaseIds).toEqual(["case-0"]);
  h.config().onSelectionChange!(["case-2"]);
  h.render();
  expect(h.config().testCaseIds).toEqual(["case-2"]);
});
it.each(["unapproved", "duplicate", "overflow", "role", "actor", "source"])(
  "Stage2 callback refuses %s cohort without replacing the retained selection",
  (mode) => {
    const h = harness();
    h.selectAll();
    h.button("Continue to configuration")();
    h.render();
    const initial = h.config().testCaseIds,
      callback = h.config().onSelectionChange!;
    let ids = ["case-0"];
    if (mode === "unapproved") ids = ["pending"];
    if (mode === "duplicate") ids = ["case-0", "case-0"];
    if (mode === "overflow")
      ids = Array.from({ length: 1001 }, (_, index) => `case-${index}`);
    if (mode === "role") h.access.canWrite = false;
    if (mode === "actor") h.browser.Clerk.session.user.id = "other";
    if (mode === "source") h.query.isFetching = true;
    if (mode === "role" || mode === "source") h.render();
    (mode === "role" || mode === "source"
      ? h.config().onSelectionChange!
      : callback)(ids);
    h.render();
    expect(h.config().testCaseIds).toBe(initial);
    expect(h.send).not.toHaveBeenCalled();
  },
);
it.each(["pending", "unknown", "confirmed"])(
  "actual modal/controller and parent latch refuse a captured %s reselection",
  async (mode) => {
    const h = harness();
    h.selectAll();
    h.button("Continue to configuration")();
    h.render();
    const props = h.config(),
      input = request(props.testCaseIds),
      { controller, session } = reviewedController(),
      bulk = modalBulk(props, controller, "SET", ["case-0"]);
    let resolve!: (value: unknown) => void;
    if (mode === "pending")
      h.send.mockImplementation(
        () =>
          new Promise((yes) => {
            resolve = yes;
          }),
      );
    else if (mode === "unknown")
      h.send.mockRejectedValue(Error("Synthetic lost response"));
    else h.send.mockResolvedValue(ack(input));
    const submission = controller.submit(
      controller.snapshot().activationEpoch,
      () => input,
      props.onStart,
      () => session,
      props.onConfirmedStart,
    );
    if (mode !== "pending") await submission;
    bulk.apply();
    expect(bulk.callback).not.toHaveBeenCalled();
    // Even a directly captured host callback is not allowed to destroy recovery.
    props.onSelectionChange!(["case-0"]);
    h.render();
    expect(h.config().testCaseIds).toBe(props.testCaseIds);
    expect(h.config().bulkScopesReady).toBe(false);
    if (mode === "pending") {
      resolve(ack(input));
      await submission;
    }
    expect(h.send).toHaveBeenCalledOnce();
  },
);
it("unknown ACK retries through actual controller with identical request/UUID, no body regeneration", async () => {
  const h = harness();
  h.selectAll();
  h.button("Continue to configuration")();
  h.render();
  const props = h.config();
  const c = new RunConfigCompletionController("project", () => {}),
    scope = {
      projectId: "project",
      organizationId: "org",
      clerkActorId: "clerk",
      sessionId: "A",
    },
    session = { userId: "clerk", sessionId: "A" };
  c.attach();
  c.bindFrame({ scope, open: true, canWrite: true });
  c.review(session, c.snapshot().activationEpoch);
  let generated = 0;
  const factory = () => {
    generated++;
    return request(props.testCaseIds);
  };
  h.send.mockRejectedValueOnce(Error("synthetic lost response"));
  await c.submit(
    c.snapshot().activationEpoch,
    factory,
    props.onStart,
    () => session,
    props.onConfirmedStart,
  );
  const retained = c.snapshot().pendingRequest!;
  h.send.mockResolvedValueOnce(ack(retained));
  await c.submit(
    c.snapshot().activationEpoch,
    factory,
    props.onStart,
    () => session,
    props.onConfirmedStart,
  );
  expect(generated).toBe(1);
  expect(h.send.mock.calls[0]![0]).toBe(retained);
  expect(h.send.mock.calls[1]![0]).toBe(retained);
  expect(h.navigate).toHaveBeenCalledOnce();
});
it.each(["close", "role", "session"])(
  "posted %s frame holds exact late ACK privately until explicit restored Open",
  async (mode) => {
    const h = harness();
    h.selectAll();
    h.button("Continue to configuration")();
    h.render();
    const props = h.config();
    const c = new RunConfigCompletionController("project", () => {}),
      scope = {
        projectId: "project",
        organizationId: "org",
        clerkActorId: "clerk",
        sessionId: "A",
      },
      session = { userId: "clerk", sessionId: "A" };
    c.attach();
    const frame = { scope, open: true, canWrite: true };
    c.bindFrame(frame);
    c.review(session, c.snapshot().activationEpoch);
    let resolve!: (value: unknown) => void;
    h.send.mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const input = request(props.testCaseIds),
      pending = c.submit(
        c.snapshot().activationEpoch,
        () => input,
        props.onStart,
        () => session,
        props.onConfirmedStart,
      );
    c.bindFrame(
      mode === "close"
        ? { ...frame, open: false }
        : mode === "role"
          ? { ...frame, canWrite: false }
          : { ...frame, scope: { ...scope, sessionId: "B" } },
    );
    c.bindFrame(frame);
    resolve(ack(input));
    await pending;
    expect(h.navigate).not.toHaveBeenCalled();
    expect(c.snapshot().confirmed?.request).toBe(input);
    expect(c.snapshot().pendingRequest).toBeNull();
    expect(
      c.openConfirmed(
        session,
        props.onConfirmedStart,
        c.snapshot().activationEpoch,
      ),
    ).toBe(true);
    expect(h.navigate).toHaveBeenCalledOnce();
    expect(h.send).toHaveBeenCalledOnce();
  },
);
it("generic source error is rendered without leaking private query text; host alone does not claim an SDK ABA latch", () => {
  const h = harness();
  h.query.error = Error("private SQL fixture diagnostic");
  const tree = h.render();
  expect(text(tree)).toContain("approved case scope could not be loaded");
  expect(text(tree)).not.toContain("private SQL fixture diagnostic");
  expect(source).not.toMatch(
    /manualStartRequest|sameAuthScope|crypto\.randomUUID/,
  );
  expect(source).toContain("onConfirmedStart");
});
