import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as proofs from "./case-version-draft";
import { retainedTraceabilityReceipt } from "./traceability-receipt";
import type { useCaseVersionRestore } from "./use-case-version-restore";
import type { VersionAccess } from "./use-case-version-access";
type Config = Parameters<typeof useCaseVersionRestore>[0];
type Editor = ReturnType<typeof useCaseVersionRestore>;
const source = readFileSync(
    new URL("./use-case-version-restore.ts", import.meta.url),
    "utf8",
  ),
  ast = ts.createSourceFile(
    "controller.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  ),
  fn = ast.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "useCaseVersionRestore",
  )!;
const compiled = ts.transpileModule(
  `${ts
    .createPrinter()
    .printNode(ts.EmitHint.Unspecified, fn, ast)
    .replace(/^export /, "")}\nthis.controller=useCaseVersionRestore;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
const origin = {
    projectId: "project",
    caseId: "case",
    organizationId: "org",
    clerkActorId: "clerk",
    nativeActorId: "native",
  },
  readScope = {
    projectId: "project",
    organizationId: "org",
    actorId: "native",
    actorClerkUserId: "clerk",
  };
function preview(): NonNullable<Config["preview"]> {
  return {
    caseId: "case",
    displayId: "TC-1",
    versionNumber: 1,
    versionId: "saved-version",
    createdAt: "2026-10-05T12:00:00Z",
    warnings: [],
    expectedCaseRevision: "a".repeat(64),
    expectedVersionRevision: "b".repeat(64),
    canRestore: true,
    fields: [
      {
        key: "title",
        changed: true,
        restorable: true,
        label: "Title",
        reason: null,
        current: '"new"',
        saved: '"old"',
      },
      {
        key: "tags",
        changed: true,
        restorable: true,
        label: "Tags",
        reason: null,
        current: "[]",
        saved: '["old"]',
      },
    ],
    readContext: {
      readRequestId: "preview-nonce",
      readScope,
      caseId: "case",
      canRecover: true,
      projection: { kind: "CURRENT", versionNumber: 1 },
    },
  };
}
function harness() {
  const hooks: unknown[] = [],
    effects: Array<() => void> = [],
    cleanups = new Map<number, () => void>();
  let cursor = 0,
    dirty = false,
    uuid = 0,
    editor: Editor;
  const reads: VersionAccess = {
      origin,
      fresh: {
        readScope,
        canRecover: true,
        caseId: "case",
        readRequestId: "access-nonce",
        projection: { kind: "ACCESS" },
      },
      readable: true,
      activation: "activation-A",
      query: {} as VersionAccess["query"],
      refresh: () => {},
    },
    sent: proofs.VersionEnvelope[] = [],
    state = {
      error: null as unknown,
      onHash: null as null | (() => void),
      onSend: null as null | (() => void),
      wrongNative: false,
      wrongHash: false,
      callbacks: 0,
      callbackFail: false,
    };
  const config: Config = {
    projectId: "project",
    testCaseId: "case",
    active: true,
    open: true,
    version: 1,
    fromVersion: null,
    readOnly: false,
    reads,
    preview: preview(),
    mutation: {
      isPending: false,
      mutateAsync: async (input: proofs.VersionEnvelope) => {
        sent.push(input);
        state.onSend?.();
        if (state.error) throw state.error;
        return {
          restoredVersionNumber: 1,
          createdVersionNumber: 3,
          displayId: "TC-1",
          replayed: sent.length > 1,
          requestId: input.request.requestId,
          requestHash: state.wrongHash
            ? "f".repeat(64)
            : await proofs.versionRestoreRequestHash(input.request),
          caseId: "case",
          readScope: state.wrongNative
            ? { ...readScope, actorId: "replacement" }
            : readScope,
          scopeProof: "CURRENT_LOCKED_AUTHORIZATION",
        };
      },
    },
    afterConfirmed: () => {
      state.callbacks++;
      if (state.callbackFail) throw Error("Synthetic parent refresh failure");
    },
  };
  const context = vm.createContext({
    ...proofs,
    retainedTraceabilityReceipt,
    versionRestoreRequestHash: async (input: proofs.VersionRestore) => {
      state.onHash?.();
      return proofs.versionRestoreRequestHash(input);
    },
    crypto: {
      randomUUID: () =>
        `6ee2ec04-4d34-40bf-b0e9-${String(++uuid).padStart(12, "0")}`,
    },
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!Object.hasOwn(hooks, index))
        hooks[index] = typeof initial === "function" ? initial() : initial;
      return [
        hooks[index],
        (value: unknown) => {
          const next =
            typeof value === "function" ? value(hooks[index]) : value;
          if (!Object.is(next, hooks[index])) {
            hooks[index] = next;
            dirty = true;
          }
        },
      ];
    },
    useRef: (initial: unknown) => {
      const index = cursor++;
      if (!Object.hasOwn(hooks, index)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useLayoutEffect: (effect: () => (() => void) | void, deps: unknown[]) =>
      schedule(effect, deps),
    useEffect: (effect: () => (() => void) | void, deps: unknown[]) =>
      schedule(effect, deps),
  });
  function schedule(effect: () => (() => void) | void, deps: unknown[]) {
    const index = cursor++,
      previous = hooks[index] as unknown[] | undefined;
    if (!previous || deps.some((value, n) => !Object.is(value, previous[n]))) {
      hooks[index] = deps;
      effects.push(() => {
        cleanups.get(index)?.();
        const cleanup = effect();
        if (cleanup) cleanups.set(index, cleanup);
      });
    }
  }
  vm.runInContext(compiled, context);
  const control = (
    context as unknown as { controller: (config: Config) => Editor }
  ).controller;
  function render() {
    for (let step = 0; step < 30; step++) {
      cursor = 0;
      dirty = false;
      editor = control(config);
      effects.splice(0).forEach((effect) => effect());
      if (!dirty) return editor;
    }
    throw Error("Controller did not settle");
  }
  function ready() {
    render().change({ reason: "  Retained reason\n  " });
    render().change({ confirmed: true });
    return render();
  }
  return {
    config,
    reads,
    state,
    sent,
    render,
    ready,
    unmount: () => cleanups.forEach((cleanup) => cleanup()),
    get editor() {
      return editor;
    },
  };
}
describe("actual restore controller with synthetic hooks NOT native/rendered acceptance", () => {
  it("pins complete immutable comparison prose/fields rather than aliasing a later cache edit", () => {
    const h = harness();
    h.ready();
    const captured = h.editor.draft!.baseline;
    h.config.preview!.fields[0]!.saved = '"cache changed later"';
    h.config.preview!.fields.push({
      ...h.config.preview!.fields[0]!,
      key: "background",
    });
    expect(captured.fields[0]!.saved).toBe('"old"');
    expect(captured.fields).toHaveLength(2);
    expect(Object.isFrozen(captured.fields)).toBe(true);
    expect(Object.isFrozen(captured.readContext!.readScope)).toBe(true);
  });
  it("sends the frozen old request through a native envelope exactly once, validates ACK and settles", async () => {
    const h = harness();
    expect(h.ready().canCommit).toBe(true);
    await h.editor.commit();
    h.render();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({
      originalOrganizationId: "org",
      expectedClerkActorId: "clerk",
      expectedNativeActorId: "native",
      request: {
        projectId: "project",
        testCaseId: "case",
        reason: "Retained reason",
        fields: ["title", "tags"],
      },
    });
    expect(h.sent[0]!.request).not.toHaveProperty("readRequestId");
    expect(Object.isFrozen(h.sent[0]!.request.fields)).toBe(true);
    expect(h.editor.pending).toBeNull();
    expect(h.state.callbacks).toBe(1);
  });
  it("busy refs prevent double dispatch and same-event stale confirmation cannot send older reason/fields", async () => {
    const h = harness();
    h.ready();
    const save = h.editor.commit;
    h.editor.change({ reason: "New unconfirmed reason" });
    await save();
    expect(h.sent).toHaveLength(0);
    h.render().change({ confirmed: true });
    h.render();
    await Promise.all([h.editor.commit(), h.editor.commit()]);
    expect(h.sent).toHaveLength(1);
  });
  it("hash completion after close/role/session/native frame loss sends nothing and keeps the original draft", async () => {
    for (const loss of ["close", "role", "session", "native"]) {
      const h = harness();
      h.ready();
      const draft = h.editor.draft;
      h.state.onHash = () => {
        if (loss === "close") {
          h.editor.closeFrame();
          h.config.open = false;
        } else if (loss === "role") h.config.readOnly = true;
        else if (loss === "session") h.reads.activation = "activation-B";
        else
          h.reads.fresh = {
            ...h.reads.fresh!,
            readScope: { ...readScope, actorId: "replacement" },
          };
        h.render();
      };
      await h.editor.commit();
      h.render();
      expect(h.sent).toHaveLength(0);
      expect(h.editor.draft).toBe(draft);
      expect(h.editor.pending).toBeNull();
    }
  });
  it.each([
    "close",
    "inactive",
    "unmount",
    "session-A-B-A",
    "readOnly-A-B-A",
    "case-reuse",
  ])(
    "known exact ACK after %s privately settles only its pending request",
    async (loss) => {
      const h = harness();
      h.ready();
      const draft = h.editor.draft,
        notice = h.editor.notice;
      h.state.onSend = () => {
        if (loss === "close") {
          h.editor.closeFrame();
          h.config.open = false;
          h.render();
        } else if (loss === "inactive") {
          h.config.active = false;
          h.render();
        } else if (loss === "unmount") h.unmount();
        else if (loss === "session-A-B-A") {
          h.reads.activation = "B";
          h.render();
          h.reads.activation = "A-return";
          h.render();
        } else if (loss === "readOnly-A-B-A") {
          h.config.readOnly = true;
          h.render();
          h.config.readOnly = false;
          h.render();
        } else {
          h.config.testCaseId = "other-case";
          h.render();
        }
      };
      await h.editor.commit();
      h.render();
      expect(h.editor.pending).toBeNull();
      expect(h.editor.draft).toBe(draft);
      expect(h.editor.notice).toBe(notice);
      expect(h.state.callbacks).toBe(0);
      expect(h.editor.canCommit).toBe(false);
    },
  );
  it("unknown ACK retains exact input/hash across close and later typed refusal without using a new UUID", async () => {
    const h = harness();
    h.ready();
    h.state.error = Error("Lost response");
    await h.editor.commit();
    h.render();
    const pending = h.editor.pending!;
    h.config.open = false;
    h.render();
    h.config.open = true;
    h.render();
    h.state.error = { data: { code: "CONFLICT" } };
    await h.editor.commit();
    h.render();
    expect(h.sent[1]).toBe(h.sent[0]);
    expect(h.editor.pending!.input).toBe(pending.input);
    expect(h.editor.pending!.requestHash).toBe(pending.requestHash);
    expect(h.editor.pending!.uncertain).toBe(true);
  });
  it("accepted receipt recovery needs current native full reader, not a newly valid comparison/custom-field schema", async () => {
    const h = harness();
    h.ready();
    h.state.error = Error("Lost response");
    await h.editor.commit();
    h.render();
    const input = h.editor.pending!.input;
    h.config.preview = null;
    h.state.error = null;
    h.render();
    await h.editor.commit();
    h.render();
    expect(h.sent[1]).toBe(input);
    expect(h.editor.pending).toBeNull();
    const denied = harness();
    denied.ready();
    denied.state.error = Error("Lost response");
    await denied.editor.commit();
    denied.render();
    denied.reads.fresh!.canRecover = false;
    denied.render();
    await denied.editor.commit();
    expect(denied.sent).toHaveLength(1);
  });
  it("first definite refusal retains draft; wrong hash/native ACK remains UNKNOWN; stale callbacks cannot clear newer pending", async () => {
    const rejected = harness();
    rejected.ready();
    const draft = rejected.editor.draft;
    rejected.state.error = { data: { code: "BAD_REQUEST" } };
    await rejected.editor.commit();
    rejected.render();
    expect(rejected.editor.pending).toBeNull();
    expect(rejected.editor.draft).toBe(draft);
    for (const patch of [{ wrongHash: true }, { wrongNative: true }]) {
      const h = harness();
      h.ready();
      Object.assign(h.state, patch);
      await h.editor.commit();
      h.render();
      expect(h.editor.pending?.uncertain).toBe(true);
      expect(h.state.callbacks).toBe(0);
    }
    const h = harness();
    h.ready();
    let replacement: proofs.VersionPending | null = null;
    h.state.onSend = () => {
      replacement = Object.freeze({
        ...h.editor.pendingRef.current!,
        draftIdentity: "replacement",
      });
      h.editor.pendingRef.current = replacement;
    };
    await h.editor.commit();
    expect(h.editor.pendingRef.current).toBe(replacement);
    expect(h.state.callbacks).toBe(0);
  });
  it("fresh comparison mismatch blocks a new restore while historical mode cannot create a write baseline", async () => {
    const h = harness();
    h.ready();
    h.config.preview = { ...preview(), expectedCaseRevision: "c".repeat(64) };
    h.render();
    await h.editor.commit();
    expect(h.sent).toHaveLength(0);
    expect(h.editor.canCommit).toBe(false);
    h.config.fromVersion = 2;
    h.render();
    await h.editor.commit();
    expect(h.sent).toHaveLength(0);
  });
  it("stale edit/reset callbacks cannot overwrite a new draft after access epoch loss/return", () => {
    const h = harness();
    h.ready();
    const old = h.editor,
      draft = old.draft;
    h.reads.activation = "B";
    h.render();
    h.reads.activation = "A-return";
    h.render();
    old.change({ reason: "Stale" });
    expect(old.clearComparison()).toBe(false);
    h.render();
    expect(h.editor.draft).toBe(draft);
  });
  it("parent refresh failure never reconstructs an already acknowledged write", async () => {
    const h = harness();
    h.ready();
    h.state.callbackFail = true;
    await h.editor.commit();
    h.render();
    await h.editor.commit();
    expect(h.sent).toHaveLength(1);
    expect(h.editor.pending).toBeNull();
  });
});
