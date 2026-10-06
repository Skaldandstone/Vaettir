// ACTUAL component function/controller with synthetic hook + RPC + Clerk boundaries.
// No authenticated browser/native database evidence.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import {
  WholeCaseReviewedController,
  emptyWholeCaseCompletion,
} from "./whole-case-reviewed-controller";
import {
  wholeCaseDraft,
  wholeCaseRequest,
  wholeCaseReadMatches,
  wholeCaseRequestHash,
} from "./whole-case-reviewed-draft";
import { currentSessionScope } from "./auth-query-cache";
import { technicalBehaviorLabel } from "./case-authoring-fields";
import {
  manualCaseReviewedReadKey,
  type ManualCaseReviewedRead,
  type ManualCaseReviewedWrite,
  type ManualCaseReviewedPreview,
} from "@vaettir/api/src/services/manualCaseResultSchema";
vi.stubGlobal("crypto", webcrypto);
const source = readFileSync(
    new URL("../components/ManualCaseResultHistory.tsx", import.meta.url),
    "utf8",
  ),
  ast = ts.createSourceFile(
    "editor.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
const compiled = ts.transpileModule(
  ast.statements
    .filter(
      (node) => ts.isVariableStatement(node) || ts.isFunctionDeclaration(node),
    )
    .map((node) =>
      ts
        .createPrinter()
        .printNode(ts.EmitHint.Unspecified, node, ast)
        .replace(/\bexport function /g, "function "),
    )
    .join("\n") + "\nthis.component=ManualCaseResultHistory;",
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      jsx: ts.JsxEmit.React,
    },
  },
).outputText;
const sharedSource = readFileSync(
    new URL("../components/CaseProcedureColumns.tsx", import.meta.url),
    "utf8",
  ),
  sharedAst = ts.createSourceFile(
    "shared.tsx",
    sharedSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
const sharedCompiled = ts.transpileModule(
  sharedAst.statements
    .filter((node) => ts.isFunctionDeclaration(node))
    .map((node) =>
      ts
        .createPrinter()
        .printNode(ts.EmitHint.Unspecified, node, sharedAst)
        .replace(/\bexport function /g, "function "),
    )
    .join("\n"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      jsx: ts.JsxEmit.React,
    },
  },
).outputText;
type Element = {
  type: unknown;
  props: {
    children?: unknown;
    value?: unknown;
    disabled?: boolean;
    onClick?: () => unknown;
    onChange?: (event: { target: { value: string } }) => unknown;
    open?: boolean;
  };
};
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Element;
  return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (Array.isArray(value)) return value.map(text).join("");
  return value && typeof value === "object" && "props" in value
    ? text((value as Element).props.children)
    : "";
}
function deferred() {
  let resolve!: (v: unknown) => void, reject!: (v: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function harness() {
  const slots: unknown[] = [],
    effects: Array<() => void> = [],
    cleanups = new Map<number, () => void>();
  const listeners = new Set<() => void>();
  let cursor = 0,
    dirty = false,
    tree: unknown;
  const origin = {
      projectId: "p",
      testRunId: "r",
      testCaseId: "c",
      organizationId: "o",
      clerkActorId: "cl",
      nativeActorId: "n",
      sessionId: "sessionA",
    },
    access = {
      origin,
      readable: true,
      canRecover: true,
      activation: "nativeA",
      error: null,
      refresh: () => {
        access.activation += "next";
        dirty = true;
      },
    };
  const browser = {
      Clerk: {
        loaded: true,
        session: { id: "sessionA", user: { id: "cl" } },
        addListener: (callback: () => void) => {
          listeners.add(callback);
          callback();
          return () => listeners.delete(callback);
        },
      },
    },
    sent: ManualCaseReviewedWrite[] = [],
    changed = vi.fn(async () => {}),
    unconfirmed = vi.fn();
  const state = {
    fetched: true,
    previewError: null as null | { message: string },
    writable: true,
    current: null as ManualCaseReviewedPreview["current"],
    waiting: null as ReturnType<typeof deferred> | null,
  };
  const props: {
    projectId: string;
    testRunId: string;
    testCaseId: string;
    active: boolean;
    disabled: boolean;
    onChanged: () => Promise<void>;
    onUnconfirmedChange: (v: boolean) => void;
    reviewIntent?: {
      seedId: string;
      status: "FAIL";
      note: string | null;
      context: { environment: string };
      readings: [];
    };
  } = {
    projectId: "p",
    testRunId: "r",
    testCaseId: "c",
    active: true,
    disabled: false,
    onChanged: changed,
    onUnconfirmedChange: unconfirmed,
  };
  function useState(initial: unknown) {
    const at = cursor++;
    if (!(at in slots))
      slots[at] =
        typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [
      slots[at],
      (value: unknown) => {
        const next =
          typeof value === "function"
            ? (value as (v: unknown) => unknown)(slots[at])
            : value;
        if (!Object.is(next, slots[at])) {
          slots[at] = next;
          dirty = true;
        }
      },
    ];
  }
  function effect(work: () => void | (() => void), deps: unknown[]) {
    const at = cursor++,
      prior = slots[at] as unknown[] | undefined;
    if (
      !prior ||
      deps.some((value, index) => !Object.is(value, prior[index]))
    ) {
      slots[at] = deps;
      effects.push(() => {
        cleanups.get(at)?.();
        const cleanup = work();
        if (cleanup) cleanups.set(at, cleanup);
      });
    }
  }
  function query(
    input: ManualCaseReviewedRead,
    projection: "PREVIEW" | "HISTORY",
  ) {
    const readContext = {
      requestId: input.readRequestId,
      requested: manualCaseReviewedReadKey(input),
      projection,
      scope: {
        projectId: "p",
        organizationId: "o",
        actorId: "n",
        clerkActorId: "cl",
      },
      canRecover: true,
    };
    return {
      isFetchedAfterMount: state.fetched,
      isFetching: false,
      isPaused: false,
      error: projection === "PREVIEW" ? state.previewError : null,
      data:
        projection === "HISTORY"
          ? { readContext, revisions: [], nextCursor: null }
          : {
              readContext,
              displayId: "TC-1",
              current: state.current,
              currentRevisionId: null,
              revisionNumber: 0,
              currentFingerprint: "a".repeat(64),
              frozenEvidenceHash: "b".repeat(64),
              frozenEvidence: {
                procedure: { title: " Raw\n procedure " },
                prerequisites: { c: [] },
                context: {},
              },
              canWrite: state.writable,
              tracked: false,
              runStatus: "RUNNING",
              limitations: [],
            },
    };
  }
  const context = vm.createContext({
    React,
    technicalBehaviorLabel,
    Error,
    Modal: "synthetic-modal",
    WholeCaseReviewedController,
    emptyWholeCaseCompletion,
    wholeCaseDraft,
    wholeCaseRequest,
    wholeCaseReadMatches,
    currentSessionScope,
    structuredClone,
    window: browser,
    crypto: webcrypto,
    useState,
    useRef: (initial: unknown) => {
      const at = cursor++;
      if (!(at in slots)) slots[at] = { current: initial };
      return slots[at];
    },
    useEffect: effect,
    useLayoutEffect: effect,
    useWholeCaseReviewedAccess: () => access,
    useWholeCaseReadNonce: (binding: string) => {
      const [cycle, set] = useState(() => ({
        binding,
        id: webcrypto.randomUUID(),
      })) as [{ binding: string; id: string }, (v: unknown) => void];
      if (cycle.binding !== binding)
        set({ binding, id: webcrypto.randomUUID() });
      return { requestId: cycle.id, ready: cycle.binding === binding };
    },
    trpcReact: {
      manualCaseResults: {
        previewReviewed: {
          useQuery: (input: ManualCaseReviewedRead) => query(input, "PREVIEW"),
        },
        historyReviewed: {
          useQuery: (input: ManualCaseReviewedRead) => query(input, "HISTORY"),
        },
        recordReviewed: {
          useMutation: () => ({
            mutateAsync: async (input: ManualCaseReviewedWrite) => {
              sent.push(input);
              return state.waiting ? state.waiting.promise : ack(input);
            },
          }),
        },
      },
    },
  });
  vm.runInContext(sharedCompiled, context);
  vm.runInContext(compiled, context);
  function render() {
    for (let n = 0; n < 40; n++) {
      dirty = false;
      cursor = 0;
      tree = (context.component as (props: unknown) => unknown)(props);
      while (effects.length) effects.shift()!();
      if (!dirty) return tree;
    }
    throw Error("actual editor failed to settle synthetic hooks");
  }
  function button(label: string) {
    const found = nodes(tree).find(
      (node) => node.type === "button" && text(node.props.children) === label,
    );
    if (!found)
      throw Error("Missing actual button " + label + " tree:" + text(tree));
    return found;
  }
  function field(label: string) {
    const match = nodes(tree).find(
      (node) =>
        node.type === "label" && text(node.props.children).startsWith(label),
    );
    const found =
      match &&
      nodes(match.props.children).find((node) =>
        ["input", "textarea", "select"].includes(node.type as string),
      );
    if (!found) throw Error("Missing actual field " + label);
    return found;
  }
  const click = (label: string) => {
    const node = button(label);
    if (node.props.disabled) throw Error("Disabled actual button " + label);
    const result = node.props.onClick?.();
    render();
    return result;
  };
  const change = (label: string, value: string) => {
    field(label).props.onChange?.({ target: { value } });
    render();
  };
  async function ack(input: ManualCaseReviewedWrite) {
    const body = input.mode === "EXACT" ? input : input.request;
    return {
      mode: input.mode,
      scope: {
        projectId: "p",
        organizationId: "o",
        actorId: "n",
        clerkActorId: "cl",
      },
      testRunId: "r",
      testCaseId: "c",
      resultId: "result",
      revisionId: "revision",
      revisionNumber: 1,
      idempotencyKey: body.idempotencyKey,
      requestHash: await wholeCaseRequestHash(input),
      recovered: false,
    };
  }
  render();
  return {
    render,
    click,
    change,
    field,
    button,
    props,
    state,
    access,
    browser,
    sent,
    changed,
    unconfirmed,
    ack,
    tree: () => tree,
    emit: () => listeners.forEach((callback) => callback()),
    settle: async () => {
      for (let n = 0; n < 100; n++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        const controller = slots.find(
          (value) => value instanceof WholeCaseReviewedController,
        ) as WholeCaseReviewedController | undefined;
        if (controller && !controller.snapshot().busy) {
          render();
          return;
        }
      }
      throw Error(
        "actual editor response did not settle within bounded synthetic fixture wait",
      );
    },
    context: (value: unknown) =>
      renderToStaticMarkup(
        (
          context.ObservationContext as (props: {
            value: unknown;
          }) => React.ReactElement
        )({ value }),
      ),
    procedure: (value: unknown) =>
      renderToStaticMarkup(
        (
          context.FrozenObservationProcedure as (props: {
            value: unknown;
          }) => React.ReactElement
        )({ value }),
      ),
    close: () => {
      const modal = nodes(tree).find(
        (node) => node.type === "synthetic-modal",
      ) as Element & { props: { onClose: () => void } };
      modal.props.onClose();
      render();
    },
  };
}
describe("ACTUAL whole-case reviewed editor synthetic controller/render proof", () => {
  it("actual shared procedure columns render saved BDD/action/technical/response text without live substitution", () => {
    const h = harness(),
      saved = {
        title: " Saved <title> ",
        background: " Background\n raw ",
        given: [" Precondition\n raw "],
        when: [" Click ", ""],
        then: [" Result "],
        steps: [
          {
            order: 0,
            action: " Click\n button ",
            expectedActionOrData: " GET /api <script> ",
            expectedResult: null,
            expectedResponse: " 200 JSON ",
            mediaAttachmentIds: ["retained"],
          },
        ],
      },
      before = JSON.stringify(saved),
      html = h.procedure(saved);
    expect(html).toContain("Preconditions");
    expect(html).toContain(" Precondition\n raw ");
    expect(html).toContain(" GET /api &lt;script&gt; ");
    expect(html).toContain(" 200 JSON ");
    expect(html).toContain("Generic procedure labels");
    expect(JSON.stringify(saved)).toBe(before);
    expect(h.procedure({ title: "unsupported", steps: [null] })).toContain(
      "no current procedure or defaults",
    );
  });
  it("measurement text fields remain multiline textarea buffers and preserve raw instrument newline into reviewed request", async () => {
    const h = harness();
    h.click("Review whole-case observation");
    h.change("Observed status", "FAIL");
    h.click("Add reading");
    h.change("Name", " Voltage\n authored ");
    h.change("Unit", " V ");
    h.change("Value", "2.00");
    expect(h.field("Instrument").type).toBe("textarea");
    h.change("Instrument", "Meter | serial\nretained");
    expect(h.field("Instrument").props.value).toBe("Meter | serial\nretained");
    h.click("Review exact observation");
    h.click("Confirm reviewed observation");
    await h.settle();
    expect(h.sent[0]).toMatchObject({
      observations: {
        measurements: [
          {
            name: " Voltage\n authored ",
            instrument: "Meter | serial\nretained",
            value: 2,
          },
        ],
      },
    });
  });
  it("friendly exact context labels preserve raw whitespace/escaping and unknown root stays read-only", () => {
    const h = harness(),
      html = h.context({
        specimen: " Synthetic <script> ",
        hardwareRevision: " H1 ",
        firmwareVersion: "",
        environment: " First\nSecond ",
        retired: [null, false, 0],
      });
    expect(html).toContain("<dt>Specimen</dt>");
    expect(html).toContain("<dt>Environment</dt>");
    expect(html).toContain(" First\nSecond ");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Empty text");
    expect(h.context(null)).toContain("exact read-only disclosure");
  });
  it("SDK listener A-B-A without React commit privately settles exact ACK but old read remains blocked until new native access", async () => {
    const h = harness();
    h.click("Review whole-case observation");
    h.change("Observed status", "FAIL");
    h.click("Review exact observation");
    h.state.waiting = deferred();
    h.click("Confirm reviewed observation");
    h.browser.Clerk.session = { id: "B", user: { id: "other" } };
    h.emit();
    h.browser.Clerk.session = { id: "sessionA", user: { id: "cl" } };
    h.emit();
    h.state.waiting.resolve(await h.ack(h.sent[0]!));
    await h.settle();
    expect(h.changed).not.toHaveBeenCalled();
    expect(nodes(h.tree()).filter((n) => n.type === "textarea")).toHaveLength(
      0,
    );
    h.access.activation = "nativeFresh";
    h.render();
    h.click("Refresh confirmed observation");
    expect(h.changed).toHaveBeenCalledTimes(1);
    expect(h.sent).toHaveLength(1);
  });
  it("quick status seeds review/raw note/context only, never conversion or automatic RPC", () => {
    const h = harness();
    h.props.reviewIntent = {
      seedId: "intent",
      status: "FAIL",
      note: " Raw\n quick note ",
      context: { environment: " Raw\n quick bench " },
      readings: [],
    };
    h.render();
    expect(h.sent).toHaveLength(0);
    expect(h.field("What actually happened").props.value).toBe(
      " Raw\n quick note ",
    );
    expect(h.field("Environment").props.value).toBe(" Raw\n quick bench ");
    expect(h.button("Confirm reviewed observation").props.disabled).toBe(true);
    h.click("Review exact observation");
    expect(h.sent).toHaveLength(0);
    expect(h.button("Confirm reviewed observation").props.disabled).toBe(false);
  });
  it("NULL/text toggle preserves raw multiline buffer and exact empty note is not NULL", () => {
    const h = harness();
    h.click("Review whole-case observation");
    h.change("Note representation", "TEXT");
    h.change("What actually happened", " Raw\n prose ");
    h.change("Note representation", "NULL");
    expect(h.field("What actually happened").props.disabled).toBe(true);
    expect(h.field("What actually happened").props.value).toBe(" Raw\n prose ");
    h.change("Note representation", "TEXT");
    expect(h.field("What actually happened").props.value).toBe(" Raw\n prose ");
    h.change("What actually happened", "");
    h.change("Observed status", "FAIL");
    h.click("Review exact observation");
    expect(h.field("What actually happened").props.value).toBe("");
  });
  it("invalid numeric buffer never falls back to older number or zero; valid spelling stays literal until explicit review", async () => {
    const h = harness();
    h.click("Review whole-case observation");
    h.change("Observed status", "FAIL");
    h.click("Add reading");
    h.change("Name", " Voltage ");
    h.change("Unit", " V ");
    h.change("Value", "9007199254740993");
    h.click("Review exact observation");
    expect(text(h.tree())).toContain("silently rounded");
    expect(h.field("Value").props.value).toBe("9007199254740993");
    expect(h.sent).toHaveLength(0);
    h.change("Value", "2.00");
    h.click("Review exact observation");
    h.click("Confirm reviewed observation");
    await h.settle();
    expect(h.sent[0]).toMatchObject({
      observations: {
        measurements: [{ value: 2, name: " Voltage ", unit: " V " }],
      },
    });
  });
  it("late matching ACK after close privately settles and explicit receipt refresh never sends another UUID", async () => {
    const h = harness();
    h.click("Review whole-case observation");
    h.change("Observed status", "FAIL");
    h.click("Review exact observation");
    h.state.waiting = deferred();
    h.click("Confirm reviewed observation");
    h.close();
    h.state.waiting.resolve(await h.ack(h.sent[0]!));
    await h.settle();
    expect(h.changed).not.toHaveBeenCalled();
    expect(h.sent).toHaveLength(1);
    h.click("Inspect confirmed observation");
    h.click("Refresh confirmed observation");
    expect(h.changed).toHaveBeenCalledTimes(1);
    expect(h.sent).toHaveLength(1);
  });
  it("SDK-before-React late rejection hides private draft and retains exact UUID for original access", async () => {
    const h = harness();
    h.click("Review whole-case observation");
    h.change("Observed status", "FAIL");
    h.click("Review exact observation");
    h.state.waiting = deferred();
    h.click("Confirm reviewed observation");
    h.browser.Clerk.session = { id: "sessionB", user: { id: "other" } };
    h.state.waiting.reject(Error("unknown response"));
    await h.settle();
    expect(text(h.tree())).toContain("Private evidence and actions are hidden");
    expect(nodes(h.tree()).filter((n) => n.type === "textarea")).toHaveLength(
      0,
    );
    expect(h.changed).not.toHaveBeenCalled();
    h.browser.Clerk.session = { id: "sessionA", user: { id: "cl" } };
    h.access.activation = "nativeB";
    h.render();
    expect(h.button("Retry identical UUID").props.disabled).toBe(false);
    expect(h.sent).toHaveLength(1);
  });
  it("cache-only or unsupported current preview never admits default empty observations", () => {
    for (const kind of ["cache", "unsupported"]) {
      const h = harness();
      if (kind === "cache") h.state.fetched = false;
      else {
        h.state.writable = false;
        h.state.current = {
          resultId: "retained",
          status: "FAIL",
          note: null,
          observations: null,
        };
      }
      h.click("Review whole-case observation");
      expect(nodes(h.tree()).filter((n) => n.type === "textarea")).toHaveLength(
        0,
      );
      expect(h.sent).toHaveLength(0);
    }
  });
  it("inactive/readonly toggles retain mounted draft and suppress new writes", () => {
    const h = harness();
    h.click("Review whole-case observation");
    h.change("Note representation", "TEXT");
    h.change("What actually happened", " retained draft ");
    h.props.active = false;
    h.render();
    h.props.active = true;
    h.props.disabled = true;
    h.render();
    expect(nodes(h.tree()).filter((n) => n.type === "textarea")).toHaveLength(
      0,
    );
    h.props.disabled = false;
    h.render();
    expect(h.field("What actually happened").props.value).toBe(
      " retained draft ",
    );
    expect(h.sent).toHaveLength(0);
  });
});
