// ACTUAL access hook with synthetic fresh-read/SDK adapters, not native auth.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { describe, it, expect } from "vitest";
import { currentSessionScope } from "./auth-query-cache";
import {
  manualCaseReviewedReadKey,
  type ManualCaseReviewedAccess,
} from "@vaettir/api/src/services/manualCaseResultSchema";
const source = readFileSync(
    new URL("./use-whole-case-reviewed-access.ts", import.meta.url),
    "utf8",
  ),
  ast = ts.createSourceFile(
    "hook.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
const code = ts.transpileModule(
  ast.statements
    .filter((node) => ts.isFunctionDeclaration(node))
    .map((node) =>
      ts
        .createPrinter()
        .printNode(ts.EmitHint.Unspecified, node, ast)
        .replace(/\bexport function /g, "function "),
    )
    .join("\n") + "\nthis.hook=useWholeCaseReviewedAccess;",
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  },
).outputText;
function harness() {
  const slots: unknown[] = [],
    requests: ManualCaseReviewedAccess[] = [];
  const effects: Array<() => void> = [],
    setters = new Map<number, (value: unknown) => void>(),
    cleanups = new Map<number, () => void>(),
    listeners = new Set<() => void>();
  let cursor = 0,
    dirty = false,
    result: ReturnType<
      typeof import("./use-whole-case-reviewed-access").useWholeCaseReviewedAccess
    >;
  const state = {
      auth: { isLoaded: true, isSignedIn: true, userId: "cl", sessionId: "A" },
      organization: "o",
      fetched: true,
      paused: false,
      error: null as unknown,
      native: "n",
      wrongNonce: false,
      canRecover: true,
    },
    browser = {
      Clerk: {
        loaded: true,
        session: { id: "A", user: { id: "cl" } },
        addListener: (callback: () => void) => {
          listeners.add(callback);
          callback();
          return () => listeners.delete(callback);
        },
      },
    };
  const ctx = vm.createContext({
    crypto: { randomUUID },
    currentSessionScope,
    manualCaseReviewedReadKey,
    window: browser,
    useAuth: () => state.auth,
    useRef: (initial: unknown) => {
      const at = cursor++;
      if (!(at in slots)) slots[at] = { current: initial };
      return slots[at];
    },
    useLayoutEffect: (work: () => void | (() => void), deps: unknown[]) => {
      const at = cursor++,
        prior = slots[at] as unknown[] | undefined;
      if (
        !prior ||
        deps.some((value, index) => !Object.is(value, prior[index]))
      ) {
        effects.push(() => {
          slots[at] = deps;
          cleanups.get(at)?.();
          const cleanup = work();
          if (cleanup) cleanups.set(at, cleanup);
        });
      }
    },
    useMemo: (factory: () => unknown, deps: unknown[]) => {
      const at = cursor++, prior = slots[at] as { deps: unknown[]; value: unknown } | undefined;
      if (!prior || deps.length !== prior.deps.length || deps.some((value, index) => !Object.is(value, prior.deps[index])))
        slots[at] = { deps, value: factory() };
      return (slots[at] as { value: unknown }).value;
    },
    useState: (initial: unknown) => {
      const at = cursor++;
      if (!(at in slots))
        slots[at] =
          typeof initial === "function"
            ? (initial as () => unknown)()
            : initial;
      if (!setters.has(at)) setters.set(at, (value: unknown) => {
          const next =
            typeof value === "function"
              ? (value as (v: unknown) => unknown)(slots[at])
              : value;
          if (!Object.is(slots[at], next)) { slots[at] = next; dirty = true; }
        });
      return [slots[at], setters.get(at)];
    },
    trpcReact: {
      project: {
        byId: {
          useQuery: () => ({
            isFetchedAfterMount: true,
            isFetching: false,
            isPaused: false,
            error: null,
            data: { id: "p", organizationId: state.organization },
            refetch: async () => {},
          }),
        },
      },
      manualCaseResults: {
        accessReviewed: {
          useQuery: (input: ManualCaseReviewedAccess) => {
            requests.push(input);
            return {
              isFetchedAfterMount: state.fetched,
              isFetching: false,
              isPaused: state.paused,
              error: state.error,
              data: {
                readContext: {
                  projection: "ACCESS",
                  requestId: state.wrongNonce
                    ? randomUUID()
                    : input.readRequestId,
                  requested: manualCaseReviewedReadKey(input),
                  scope: {
                    projectId: "p",
                    organizationId: input.expectedScope.organizationId,
                    actorId: state.native,
                    clerkActorId: input.expectedScope.clerkActorId,
                  },
                  canRecover: state.canRecover,
                },
              },
            };
          },
        },
      },
    },
  });
  vm.runInContext(code, ctx);
  function render() {
    for (let n = 0; n < 30; n++) {
      dirty = false;
      cursor = 0;
      effects.length = 0;
      result = (ctx.hook as (...args: unknown[]) => typeof result)(
        "p",
        "r",
        "c",
        true,
      );
      // React discards adjustment renders before committing layout effects.
      if (dirty) continue;
      while (effects.length) effects.shift()!();
      if (!dirty) return result;
    }
    throw Error("actual reader failed to settle");
  }
  return {
    state,
    browser,
    render,
    requests,
    emit: () => listeners.forEach((callback) => callback()),
  };
}
describe("ACTUAL whole-case native-reader admission hook", () => {
  it("installed SDK A-B-A without hook commit permanently blocks that nonce until explicit fresh native activation", () => {
    const h = harness(),
      initial = h.render();
    h.browser.Clerk.session = { id: "B", user: { id: "other" } };
    h.emit();
    h.browser.Clerk.session = { id: "A", user: { id: "cl" } };
    h.emit();
    const blocked = h.render();
    expect(initial.current()).toBe(false);
    expect(blocked.readable).toBe(false);
    expect(blocked.current()).toBe(false);
    blocked.refresh();
    const fresh = h.render();
    expect(fresh.activation).not.toBe(initial.activation);
    expect(fresh.readable).toBe(true);
  });
  it("unauthorized private server error is not echoed into access DOM data", () => {
    const h = harness();
    h.state.error = { message: "PRIVATE scoped server body <secret>" };
    expect(h.render().error).not.toContain("PRIVATE");
  });
  it.each(["cache", "paused", "error", "nonce"])(
    "%s cannot admit private read or pin original native author",
    (kind) => {
      const h = harness();
      if (kind === "cache") h.state.fetched = false;
      if (kind === "paused") h.state.paused = true;
      if (kind === "error") h.state.error = { message: "denied" };
      if (kind === "nonce") h.state.wrongNonce = true;
      const result = h.render();
      expect(result.readable).toBe(false);
      expect(result.origin).toBeNull();
    },
  );
  it("native read-only reader can inspect but cannot recover or write; returned native pin never silently rebinds", () => {
    const h = harness();
    h.state.canRecover = false;
    expect(h.render()).toMatchObject({
      readable: true,
      canRecover: false,
      origin: { nativeActorId: "n" },
    });
    h.state.native = "other";
    expect(h.render().readable).toBe(false);
    expect(h.render().origin?.nativeActorId).toBe("n");
  });
  it("SDK-before-React session mismatch withholds even freshly echoed old observer response", () => {
    const h = harness();
    expect(h.render().readable).toBe(true);
    h.browser.Clerk.session = { id: "B", user: { id: "other" } };
    expect(h.render().readable).toBe(false);
  });
  it("A-B-A auth/access epochs generate distinct read UUIDs and never accept an old nonce", () => {
    const h = harness(),
      a = h.render();
    h.state.auth.sessionId = "B";
    h.state.auth.userId = "other";
    h.browser.Clerk.session = { id: "B", user: { id: "other" } };
    h.emit();
    const b = h.render();
    h.state.auth.sessionId = "A";
    h.state.auth.userId = "cl";
    h.browser.Clerk.session = { id: "A", user: { id: "cl" } };
    h.emit();
    const next = h.render();
    expect(a.activation).not.toBe(b.activation);
    expect(next.activation).not.toBe(a.activation);
    expect(next.readable).toBe(false);
    expect(a.current()).toBe(false);
    next.refresh();
    const fresh = h.render();
    expect(fresh.readable).toBe(true);
    expect(fresh.origin).toBe(a.origin);
    expect(fresh.activation).not.toBe(a.activation);
    h.state.wrongNonce = true;
    expect(h.render().readable).toBe(false);
  });
  it("current project discovery moving organizations never rebinds retained workflow", () => {
    const h = harness();
    expect(h.render().origin?.organizationId).toBe("o");
    h.state.organization = "other";
    expect(h.render().readable).toBe(false);
    expect(h.render().origin?.organizationId).toBe("o");
  });
});
