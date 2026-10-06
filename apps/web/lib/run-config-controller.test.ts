// Execute the ACTUAL modal function with synthetic hook/Clerk/RPC adapters.
// No browser authentication, network, database or production proof is implied.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { describe, expect, it } from "vitest";
import {
  RunConfigCompletionController,
  emptyRunStartCompletion,
} from "./run-config-completion";
import { currentSessionScope } from "./auth-query-cache";
import {
  freezeRunConfiguration,
  MAX_MANUAL_CASES,
  reviewedRunCasesMatch,
  type ReviewedRunConfiguration,
} from "./run-configuration-request";
import { applyRunBulkSelection } from "./run-bulk-selection";
const source = readFileSync(
  new URL("../components/RunConfigurationModal.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "modal.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const component = ast.statements.find(
  (node) =>
    ts.isFunctionDeclaration(node) &&
    node.name?.text === "RunConfigurationModal",
)!;
const constants = ast.statements.filter(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (declaration) =>
        ts.isIdentifier(declaration.name) &&
        ["labels", "emptyContext"].includes(declaration.name.text),
    ),
);
const screens = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "screensFor",
)!;
const compiled = ts.transpileModule(
  `${[...constants, screens, component]
    .map((node) =>
      ts
        .createPrinter()
        .printNode(ts.EmitHint.Unspecified, node, ast)
        .replace(/^export /, ""),
    )
    .join("\n")}\nthis.component = RunConfigurationModal;`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.None,
    },
  },
).outputText;
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type Element = {
  type: unknown;
  props: {
    children?: unknown;
    onClick?: () => unknown;
    onChange?: (event: unknown) => unknown;
    disabled?: boolean;
    id?: string;
    value?: string;
  };
};
function children(node: unknown): Element[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(children);
  const current = node as Element;
  return current.props ? [current, ...children(current.props.children)] : [];
}
function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node
    ? text((node as Element).props.children)
    : "";
}
function harness() {
  const hooks: unknown[] = [],
    effects: Array<() => void> = [],
    cleanups = new Map<number, () => void>();
  let cursor = 0,
    dirty = false,
    tree: unknown,
    uuid = 0;
  const auth = {
    isLoaded: true,
    isSignedIn: true,
    userId: "clerk",
    sessionId: "session-A",
  };
  const access = {
    ready: true,
    canWrite: true,
    origin: { organizationId: "org", clerkActorId: "clerk" },
    refresh: async () => {},
  };
  const permissions = {
    loaded: true,
    canEdit: true,
    accessError: null,
    retryAccess: () => {},
  };
  const query = {
    data: { experience: null, profileHash: "a".repeat(64) },
    error: null,
    isFetching: false,
    isPaused: false,
    isFetchedAfterMount: true,
    refetch: async () => ({ data: query.data, error: null }),
  };
  const browser = {
    Clerk: {
      loaded: true,
      session: { id: auth.sessionId, user: { id: auth.userId } },
    },
  };
  const sent: ReviewedRunConfiguration[] = [],
    opened: unknown[] = [];
  let waiting: ReturnType<typeof deferred> | null = null,
    badAck = false;
  const props = {
    open: true,
    projectId: "project",
    caseCount: 2,
    testCaseIds: ["one", "two"],
    onClose: () => {
      props.open = false;
    },
    onStart: async (request: ReviewedRunConfiguration) => {
      sent.push(request);
      if (waiting) return waiting.promise;
      return acknowledgement(request);
    },
    onConfirmedStart: (ack: unknown, request: ReviewedRunConfiguration) =>
      opened.push({ ack, request }),
  };
  function acknowledgement(request: ReviewedRunConfiguration) {
    return {
      testRunId: `manual_${"f".repeat(64)}`,
      originalOrganizationId: request.originalOrganizationId,
      expectedClerkActorId: request.expectedClerkActorId,
      idempotencyKey: badAck ? "wrong" : request.idempotencyKey,
    };
  }
  const effect = (work: () => void | (() => void), deps: unknown[]) => {
    const at = cursor++,
      prior = hooks[at] as unknown[] | undefined;
    if (
      !prior ||
      deps.some((value, index) => !Object.is(value, prior[index]))
    ) {
      hooks[at] = deps;
      effects.push(() => {
        cleanups.get(at)?.();
        const cleanup = work();
        if (cleanup) cleanups.set(at, cleanup);
      });
    }
  };
  const context = vm.createContext({
    React,
    Modal: "synthetic-modal",
    RunConfigCompletionController,
    emptyRunStartCompletion,
    currentSessionScope,
    freezeRunConfiguration,
    MAX_MANUAL_CASES,
    reviewedRunCasesMatch,
    applyRunBulkSelection,
    GAME_PLATFORMS: [],
    resolveQualityExperience: () => {
      throw Error("Null fixture profile only");
    },
    window: browser,
    crypto: {
      randomUUID: () =>
        `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
    },
    useAuth: () => auth,
    useManualExecutionAccess: () => access,
    useProjectPermissions: () => permissions,
    trpcReact: { project: { experience: { useQuery: () => query } } },
    useState: (initial: unknown) => {
      const at = cursor++;
      if (!Object.hasOwn(hooks, at))
        hooks[at] =
          typeof initial === "function"
            ? (initial as () => unknown)()
            : initial;
      return [
        hooks[at],
        (value: unknown) => {
          const next =
            typeof value === "function"
              ? (value as (before: unknown) => unknown)(hooks[at])
              : value;
          if (!Object.is(next, hooks[at])) {
            hooks[at] = next;
            dirty = true;
          }
        },
      ];
    },
    useRef: (initial: unknown) => {
      const at = cursor++;
      if (!Object.hasOwn(hooks, at)) hooks[at] = { current: initial };
      return hooks[at];
    },
    useId: () => {
      cursor++;
      return "synthetic-prefix";
    },
    useLayoutEffect: effect,
    useEffect: effect,
  });
  vm.runInContext(compiled, context);
  function render() {
    let loops = 0;
    do {
      dirty = false;
      cursor = 0;
      tree = (context.component as (p: typeof props) => unknown)(props);
      while (effects.length) effects.shift()!();
      if (++loops > 35) throw Error("Modal render did not settle");
    } while (dirty);
    return tree;
  }
  function button(label: string) {
    const node = children(tree).find(
      (node) => node.type === "button" && text(node.props.children) === label,
    );
    if (!node) throw Error(`Missing button ${label}: ${text(tree)}`);
    return node;
  }
  function click(label: string) {
    const node = button(label);
    if (node.props.disabled) throw Error(`Disabled ${label}`);
    const result = node.props.onClick?.();
    render();
    return result;
  }
  function edit(key: string, value: string) {
    const node = children(tree).find(
      (node) => node.props.id === `synthetic-prefix-${key}`,
    );
    if (!node) throw Error("Field unavailable");
    node.props.onChange?.({ target: { value } });
    render();
  }
  function session(id: string, commit = true) {
    auth.sessionId = id;
    browser.Clerk.session.id = id;
    if (commit) render();
  }
  render();
  return {
    props,
    access,
    permissions,
    sent,
    opened,
    render,
    click,
    edit,
    session,
    button,
    acknowledgement,
    get content() {
      return text(tree);
    },
    get ids() {
      return uuid;
    },
    wait() {
      waiting = deferred();
      return waiting;
    },
    malformed() {
      badAck = true;
    },
    async flush() {
      await Promise.resolve();
      await Promise.resolve();
      render();
    },
    review() {
      click("Continue");
      click("Continue");
    },
  };
}
describe("actual mounted run configuration synthetic controller", () => {
  it("current matching ACK invokes only guarded confirmation, with exact original payload and one UUID", async () => {
    const h = harness();
    h.edit("configuration", "  exact multi\nline configuration  ");
    h.review();
    h.click("Start execution record");
    await h.flush();
    expect(h.sent).toHaveLength(1);
    expect(h.opened).toHaveLength(1);
    expect(h.sent[0]?.executionContext.configuration).toBe(
      "exact multi\nline configuration",
    );
    expect(h.ids).toBe(1);
    expect(h.content).toContain("Run start confirmed");
    expect(h.button("Open confirmed run").props.disabled).toBe(true);
  });
  it.each(["authority", "closed", "ABA"])(
    "late ACK after %s retains form and privately confirms; restoration requires explicit Open",
    async (reason) => {
      const h = harness();
      h.edit("build", "reviewed build");
      h.review();
      const wait = h.wait();
      h.click("Start execution record");
      const input = h.sent[0]!;
      if (reason === "authority") {
        h.access.canWrite = false;
        h.permissions.canEdit = false;
        h.render();
      }
      if (reason === "closed") {
        h.props.open = false;
        h.render();
      }
      if (reason === "ABA") {
        h.session("session-B");
        h.session("session-A");
      }
      wait.resolve(h.acknowledgement(input));
      await h.flush();
      expect(h.opened).toHaveLength(0);
      expect(h.ids).toBe(1);
      h.access.canWrite = true;
      h.permissions.canEdit = true;
      h.props.open = true;
      h.render();
      expect(h.content).toContain("Run start confirmed");
      expect(h.content).toContain("reviewed build");
      h.click("Open confirmed run");
      expect(h.opened).toHaveLength(1);
      expect(h.sent).toHaveLength(1);
    },
  );
  it("malformed ACK survives close/reopen and background selection changes with exact object/body/UUID retry", async () => {
    const h = harness();
    h.review();
    h.malformed();
    h.click("Start execution record");
    await h.flush();
    const input = h.sent[0]!,
      body = JSON.stringify(input);
    h.props.open = false;
    h.render();
    h.props.testCaseIds = ["replacement"];
    h.props.caseCount = 1;
    h.props.open = true;
    h.render();
    h.click("Retry retained run start");
    await h.flush();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toBe(input);
    expect(JSON.stringify(h.sent[1])).toBe(body);
    expect(h.ids).toBe(1);
    expect(h.opened).toHaveLength(0);
  });
  it("same-event duplicate stale start handler is stopped by private controller before a second UUID/RPC", async () => {
    const h = harness();
    h.review();
    const wait = h.wait(),
      handler = h.button("Start execution record").props.onClick!;
    handler();
    handler();
    h.render();
    expect(h.sent).toHaveLength(1);
    expect(h.ids).toBe(1);
    wait.resolve(h.acknowledgement(h.sent[0]!));
    await h.flush();
  });
  it("SDK session loss without React commit prevents a stale action from generating a UUID", async () => {
    const h = harness();
    h.review();
    const handler = h.button("Start execution record").props.onClick!;
    // SDK changes before any hook commit: the action-time session guard alone
    // must stop this old handler from submitting a new request.
    h.session("session-B", false);
    handler();
    await h.flush();
    expect(h.sent).toHaveLength(0);
    expect(h.ids).toBe(0);
  });
  it("SDK loss before a late matching ACK cannot publish an actionable confirmation in the old modal frame", async () => {
    const h = harness();
    h.review();
    const wait = h.wait();
    h.click("Start execution record");
    const request = h.sent[0]!;
    h.session("session-B", false);
    wait.resolve(h.acknowledgement(request));
    await h.flush();
    expect(h.opened).toHaveLength(0);
    expect(h.content).not.toContain("Run start confirmed");
    expect(h.ids).toBe(1);
    h.session("session-A");
    expect(h.content).toContain("Run start confirmed");
    h.click("Open confirmed run");
    expect(h.opened).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
  });
  it("late rejection after SDK loss without a React commit keeps the original request private and retryable", async () => {
    const h = harness();
    h.edit("build", "retained rejection draft");
    h.review();
    const wait = h.wait();
    h.click("Start execution record");
    const request = h.sent[0]!;
    h.session("session-B", false);
    wait.reject({ data: { code: "FORBIDDEN" } });
    await h.flush();
    expect(h.opened).toHaveLength(0);
    expect(h.content).not.toContain("retained rejection draft");
    expect(h.content).not.toContain("Retry retained run start");
    h.session("session-A");
    expect(h.content).toContain("retained rejection draft");
    expect(h.button("Retry retained run start").props.disabled).toBe(false);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toBe(request);
    expect(h.ids).toBe(1);
  });
});
