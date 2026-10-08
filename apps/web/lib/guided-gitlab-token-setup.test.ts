import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { gitlabInstanceOrigin } from "./gitlab-instance-selection";

type Node = React.ReactElement<{ children?: React.ReactNode; value?: string; href?: string; disabled?: boolean; initialInstanceUrl?: string; onClick?: () => void; onChange?: (e: { target: { value: string } }) => void }>;
function nodes(node: React.ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
  return [node as Node, ...nodes(node.props.children)];
}
function load(name: string, context: vm.Context) {
  const ast = ts.createSourceFile(name, readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const printer = ts.createPrinter();
  const source = ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => printer.printNode(ts.EmitHint.Unspecified, n, ast).replace(/^export\s+/gm, "")).join("\n");
  vm.runInContext(ts.transpileModule(`${source}\nthis.actual=${name};`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText, context);
}
function guide() {
  const slots: unknown[] = []; let cursor = 0;
  const boundary = vi.fn();
  const context = vm.createContext({ React, gitlabInstanceOrigin, TokenRepositoryConnection: boundary,
    useState: (initial: unknown) => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (v: unknown) => { slots[i] = v; }]; },
  });
  load("GuidedGitlabTokenSetup", context);
  const props = { projectId: "synthetic", active: true, onConnected: vi.fn(), onClose: vi.fn() };
  const render = () => { cursor = 0; return nodes(context.actual(props)); };
  return { render, props, boundary };
}
describe("actual guided GitLab setup JSX", () => {
  it("forwards the normalized same-host origin only after explicit continuation", () => {
    const h = guide();
    h.render().find(n => n.type === "input")!.props.onChange!({ target: { value: "https://GitLab.example.com/team/project" } });
    let tree = h.render();
    expect(tree.find(n => n.type === "a")!.props.href).toBe("https://gitlab.example.com/-/user_settings/personal_access_tokens");
    expect(h.boundary).not.toHaveBeenCalled();
    tree.find(n => n.type === "button" && n.props.disabled === false)!.props.onClick!();
    tree = h.render();
    expect(tree[0]!.type).toBe(h.boundary);
    expect(tree[0]!.props.initialInstanceUrl).toBe("https://gitlab.example.com");
    h.props.active = false;
    expect(h.render()[0]!.type).toBe(h.boundary);
  });
  it.each(["http://gitlab.example.com", "https://localhost", "https://127.0.0.1", "https://user:secret@gitlab.example.com", "https://gitlab.example.com:8443", "https://gitlab.example.com?token=secret"])("does not expose a token-page link or continuation for %s", value => {
    const h = guide(); h.render().find(n => n.type === "input")!.props.onChange!({ target: { value } });
    const tree = h.render(); expect(tree.some(n => n.type === "a")).toBe(false);
    expect(tree.find(n => n.type === "button")!.props.disabled).toBe(true);
  });
  it("refuses a retained continue handler when the guide is inactive at capture", () => {
    const h = guide(); h.props.active = false;
    h.render().find(n => n.type === "input")!.props.onChange!({ target: { value: "https://gitlab.example.com" } });
    expect(h.render().find(n => n.type === "input")!.props.value).toBe("");
  });
  it.each(["gitlab", "azure-devops", "bitbucket"])("actual token component initializes the host only for %s and never syncs later props", providerId => {
    const slots: unknown[] = []; let cursor = 0;
    const query = { isSuccess: false, isFetching: false, data: undefined };
    const mutation = { isPending: false };
    const context = vm.createContext({ React, gitlabInstanceOrigin, Object,
      useAuth: () => ({}), useLayoutEffect: () => {}, useMemo: (f: () => unknown) => f(), useRef: (v: unknown) => ({ current: v }),
      useState: (initial: unknown) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], vi.fn()]; },
      connectionAccessState: () => "loading", ConnectionAccessGate: () => null, ProviderMark: () => null,
      trpcReact: { useUtils: () => ({}), repositoryConnections: { configurations: { useQuery: () => query }, mine: { useQuery: () => query }, groups: { useQuery: () => query }, connectToken: { useMutation: () => mutation }, forgetToken: { useMutation: () => mutation }, connectSelected: { useMutation: () => mutation } } },
    });
    load("TokenRepositoryConnection", context);
    const props = { projectId: "synthetic", providerId, initialInstanceUrl: "https://GitLab.example.com/team", onClose: vi.fn(), onConnected: vi.fn() };
    context.actual(props);
    expect(slots[3]).toBe(providerId === "gitlab" ? "https://gitlab.example.com" : "");
    props.initialInstanceUrl = "https://different.example.com"; cursor = 0; context.actual(props);
    expect(slots[3]).toBe(providerId === "gitlab" ? "https://gitlab.example.com" : "");
  });
});
