import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { currentVersionRead, sameVersionReader } from "./case-version-draft";
import { currentCaseVersionPreview } from "./case-version-baseline";
import type { VersionAccess } from "./use-case-version-access";
import type { RouterInputs } from "./trpcReact";
type AccessInput = RouterInputs["caseVersionReview"]["access"];
const scope = {
    projectId: "project",
    organizationId: "org",
    actorId: "native",
    actorClerkUserId: "clerk",
  },
  origin = {
    projectId: "project",
    caseId: "case",
    organizationId: "org",
    nativeActorId: "native",
    clerkActorId: "clerk",
  };
function compile(
  path: string,
  names: string[],
  exportName: string,
  jsx = false,
) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8"),
    ast = ts.createSourceFile(
      "fixture.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
  const declarations = ast.statements
    .filter(
      (node) =>
        ts.isFunctionDeclaration(node) && names.includes(node.name!.text),
    )
    .map((node) =>
      ts
        .createPrinter()
        .printNode(ts.EmitHint.Unspecified, node, ast)
        .replace(/\bexport\s+/, ""),
    );
  return ts.transpileModule(
    `${declarations.join("\n")}\nthis.control=${exportName};`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
      },
    },
  ).outputText;
}
describe("actual version reader/renderer synthetic fixtures, not authenticated rendering", () => {
  function accessHost() {
    const hooks: unknown[] = [],
      auth = {
        isLoaded: true,
        isSignedIn: true,
        userId: "clerk",
        sessionId: "session-A",
      },
      state = {
        fetched: true,
        fetching: false,
        paused: false,
        error: null as unknown,
        native: "native",
        autoEcho: true,
        cached: null as unknown,
        active: true,
      };
    let cursor = 0,
      dirty = false,
      output: VersionAccess;
    const calls: Array<{ input: AccessInput; options: { enabled: boolean } }> =
      [];
    const context = vm.createContext({
      crypto,
      sameVersionReader,
      useAuth: () => auth,
      useState: (initial: unknown) => {
        const at = cursor++;
        if (!Object.hasOwn(hooks, at))
          hooks[at] = typeof initial === "function" ? initial() : initial;
        return [
          hooks[at],
          (next: unknown) => {
            const value = typeof next === "function" ? next(hooks[at]) : next;
            if (!Object.is(value, hooks[at])) {
              hooks[at] = value;
              dirty = true;
            }
          },
        ];
      },
      trpcReact: {
        caseVersionReview: {
          access: {
            useQuery: (input: AccessInput, options: { enabled: boolean }) => {
              calls.push({ input, options });
              const data = state.autoEcho
                ? {
                    readRequestId: input.readRequestId,
                    caseId: input.testCaseId,
                    readScope: { ...scope, actorId: state.native },
                    projection: { kind: "ACCESS" },
                    canRecover: true,
                  }
                : state.cached;
              if (state.autoEcho) state.cached = data;
              return {
                data,
                isFetchedAfterMount: state.fetched,
                isFetching: state.fetching,
                isPaused: state.paused,
                error: state.error,
              };
            },
          },
        },
      },
    });
    vm.runInContext(
      compile(
        "./use-case-version-access.ts",
        ["useVersionReadNonce", "useCaseVersionAccess"],
        "useCaseVersionAccess",
      ),
      context,
    );
    function render() {
      for (let tries = 0; tries < 20; tries++) {
        cursor = 0;
        dirty = false;
        output = (
          context as unknown as {
            control: (
              projectId: string,
              caseId: string,
              active: boolean,
            ) => VersionAccess;
          }
        ).control("project", "case", state.active);
        if (!dirty) return output;
      }
      throw Error("Reader did not settle");
    }
    return {
      render,
      auth,
      state,
      calls,
      get output() {
        return output;
      },
    };
  }
  it("completed native bootstrap pins once; cache-only/errors/paused/refetch never grant current authority", () => {
    const h = accessHost();
    h.state.fetched = false;
    expect(h.render().origin).toBeNull();
    expect(h.output.readable).toBe(false);
    h.state.fetched = true;
    expect(h.render().origin).toEqual(origin);
    expect(h.output.readable).toBe(true);
    for (const patch of [
      { fetching: true },
      { paused: true },
      { error: Error("Current access refused") },
    ]) {
      Object.assign(
        h.state,
        { fetching: false, paused: false, error: null },
        patch,
      );
      expect(h.render().readable).toBe(false);
      expect(h.output.origin).toEqual(origin);
    }
  });
  it("session A-B-A/inactive refresh rotates nonce and cannot read an old successful observer payload", () => {
    const h = accessHost();
    h.render();
    const old = h.output.activation;
    h.state.autoEcho = false;
    h.auth.sessionId = "session-B";
    expect(h.render().readable).toBe(false);
    h.auth.sessionId = "session-A";
    expect(h.render().readable).toBe(false);
    expect(h.output.activation).not.toBe(old);
    h.state.autoEcho = true;
    expect(h.render().readable).toBe(true);
    h.state.active = false;
    const active = h.output.activation;
    expect(h.render().readable).toBe(false);
    h.state.autoEcho = false;
    h.state.active = true;
    expect(h.render().readable).toBe(false);
    expect(h.output.activation).not.toBe(active);
    h.state.autoEcho = true;
    h.render();
    expect(h.calls.at(-1)!.input).toMatchObject({
      originalOrganizationId: "org",
      expectedClerkActorId: "clerk",
    });
  });
  it("a native actor replacement or signed-in user switch never rebinds the original pending reader", () => {
    const h = accessHost();
    h.render();
    h.state.native = "replacement";
    expect(h.render().readable).toBe(false);
    expect(h.output.origin!.nativeActorId).toBe("native");
    h.auth.userId = "other-clerk";
    expect(h.render().readable).toBe(false);
    expect(h.calls.at(-1)!.options.enabled).toBe(false);
    expect(h.output.origin).toEqual(origin);
  });
  function renderHost() {
    let cursor = 0;
    const hooks = [[undefined], 1, 2, true, 0];
    const state = {
        readable: true,
        active: true,
        fetching: false,
        paused: false,
        fetched: true,
        wrongNonce: false,
      },
      scopeReads = {
        origin,
        readable: true,
        fresh: { canRecover: true, readScope: scope },
        activation: "activation",
        refresh: () => {},
      };
    const editor: Record<string, unknown> = {
      draft: null,
      pending: null,
      pendingRef: { current: null },
      draftRef: { current: null },
      busyRef: { current: false },
      busy: false,
      notice: null,
      clearComparison: () => true,
      change: () => {},
      commit: () => {},
      canCommit: false,
      canBrowse: () => true,
      closeFrame: () => {},
    };
    const query = (input: Record<string, unknown>, kind: string) => ({
      isFetching: state.fetching,
      isPaused: state.paused,
      isFetchedAfterMount: state.fetched,
      error: null,
      refetch: () => {},
      data:
        kind === "LIST"
          ? {
              items: [
                {
                  id: "version",
                  versionNumber: 1,
                  createdAt: "2026-10-05T12:00:00Z",
                  createdBy: { label: "PRIVATE AUTHOR" },
                  restoration: null,
                },
              ],
              restorationNotice: null,
              nextCursor: null,
              readContext: {
                readRequestId: state.wrongNonce
                  ? "old-nonce"
                  : input.readRequestId,
                readScope: scope,
                caseId: "case",
                canRecover: true,
                projection: { kind: "LIST", before: null, take: 10 },
              },
            }
          : kind === "HISTORICAL"
            ? {
                displayId: "PRIVATE HISTORICAL CASE",
                from: { versionNumber: 2 },
                to: { versionNumber: 1 },
                fields: [
                  {
                    key: "title",
                    label: "Title",
                    changed: true,
                    from: '"PRIVATE FROM"',
                    to: '"PRIVATE TO"',
                  },
                ],
                warnings: [],
                readContext: {
                  readRequestId: state.wrongNonce
                    ? "old-nonce"
                    : input.readRequestId,
                  readScope: scope,
                  caseId: "case",
                  canRecover: true,
                  projection: {
                    kind: "HISTORICAL",
                    fromVersionNumber: 2,
                    toVersionNumber: 1,
                  },
                },
              }
            : undefined,
    });
    const context = vm.createContext({
      React,
      currentVersionRead,
      currentCaseVersionPreview,
      inspectorLabel: (value: string) => value,
      useState: (initial: unknown) => {
        const at = cursor++;
        return [hooks[at] ?? initial, () => {}];
      },
      useCaseVersionAccess: () => ({ ...scopeReads, readable: state.readable }),
      useVersionReadNonce: () => ({ ready: true, requestId: "new-nonce" }),
      useCaseVersionRestore: () => editor,
      Modal: (props: { open: boolean; children: React.ReactNode }) =>
        props.open ? React.createElement("div", null, props.children) : null,
      trpcReact: {
        useUtils: () => ({}),
        caseVersionReview: {
          list: {
            useQuery: (input: Record<string, unknown>) => query(input, "LIST"),
          },
          preview: {
            useQuery: (input: Record<string, unknown>) =>
              query(input, "CURRENT"),
          },
          compareHistorical: {
            useQuery: (input: Record<string, unknown>) =>
              query(input, "HISTORICAL"),
          },
          restoreReviewed: { useMutation: () => ({}) },
        },
      },
    });
    vm.runInContext(
      compile(
        "../components/TestCaseVersionReview.tsx",
        ["ComparisonValue", "TestCaseVersionReview"],
        "TestCaseVersionReview",
        true,
      ),
      context,
    );
    const render = () => {
      cursor = 0;
      return renderToStaticMarkup(
        (
          context as unknown as { control: (props: unknown) => React.ReactNode }
        ).control({
          projectId: "project",
          testCaseId: "case",
          active: state.active,
          readOnly: true,
        }),
      );
    };
    return { state, render, editor };
  }
  it("actual rendered list/historical values are withheld during fetch/paused/cache-only/wrong-nonce/inactive access", () => {
    const h = renderHost();
    expect(h.render()).toContain("PRIVATE AUTHOR");
    expect(h.render()).toContain("PRIVATE HISTORICAL CASE");
    for (const patch of [
      { fetching: true },
      { paused: true },
      { fetched: false },
      { wrongNonce: true },
      { active: false },
      { readable: false },
    ]) {
      Object.assign(
        h.state,
        {
          fetching: false,
          paused: false,
          fetched: true,
          wrongNonce: false,
          active: true,
          readable: true,
        },
        patch,
      );
      expect(h.render()).not.toContain("PRIVATE");
    }
  });
  it("retained private comparison/draft notice does not render after native access loss", () => {
    const h = renderHost();
    h.editor.notice = "PRIVATE DRAFT NOTICE";
    h.state.readable = false;
    const html = h.render();
    expect(html).not.toContain("PRIVATE");
    expect(html).toContain("Any pending restore stays retained");
  });
});
