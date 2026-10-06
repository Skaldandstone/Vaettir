import React, { createElement } from "react";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { connectionAccessState } from "./connection-access";
import { gitlabInstanceOrigin } from "./gitlab-instance-selection";
import type { RepositoryOAuthConnection as Component } from "../components/GitlabRepositoryConnection";
const mock = { begin: vi.fn(), connections: [] as Array<{ id: string; provider: string; origin: string }> };
const sdk = { trpcReact: {
  useUtils: () => ({}),
  repositoryConnections: {
    configurations: { useQuery: () => ({ isSuccess: true, data: { configurations: mock.connections, canConnect: true, canConfigure: true, storageReady: true } }) },
    mine: { useQuery: () => ({ isSuccess: true, data: [] }) },
    status: { useQuery: () => ({ isSuccess: false }) },
    begin: { useMutation: () => ({ mutateAsync: mock.begin, isPending: false }) },
    connectSelected: { useMutation: () => ({ isPending: false }) },
    disconnect: { useMutation: () => ({ isPending: false }) },
  },
} };
// Transpile the complete actual module, avoiding Vite's jsx:preserve limitation.
// Explicit stubs are synthetic SDK reads only, never runtime or OAuth proof.
const code = ts.transpileModule(readFileSync(new URL("../components/GitlabRepositoryConnection.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const imports: Record<string, unknown> = {
  react: React,
  "next/link": { __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => createElement("a", { href }, children) },
  "@/lib/trpcReact": sdk,
  "./SourceConnectionChips": { ProviderMark: () => null },
  "@/lib/connection-access": { connectionAccessState },
  "./ConnectionAccessGate": { ConnectionAccessGate: () => null },
  "./RepositoryProviderPicker": { cancelRepositoryAuthorization: vi.fn() },
  "@/lib/repository-authorization": { authorizeRepositoryAccount: vi.fn(() => { throw new Error("No authorization in SSR fixture"); }) },
  "@/lib/gitlab-instance-selection": { gitlabInstanceOrigin },
};
const context = vm.createContext({ React, URL, console, exports: {}, require: (name: string) => {
  if (!Object.hasOwn(imports, name)) throw new Error("Unexpected component dependency");
  return imports[name];
} });
vm.runInContext(code, context);
const RepositoryOAuthConnection = (context.exports as { RepositoryOAuthConnection: typeof Component }).RepositoryOAuthConnection;

describe("actual GitLab connection presentation with synthetic SDK reads", () => {
  it("renders an instance URL field and refuses to infer the sole configured GitLab.com host", () => {
    mock.connections = [{ id: "synthetic-cloud", provider: "gitlab", origin: "https://gitlab.com" }];
    const html = renderToStaticMarkup(createElement(RepositoryOAuthConnection, { projectId: "synthetic-project", providerId: "gitlab", onConnected: vi.fn(), onClose: vi.fn() }));
    expect(html).toContain("GitLab instance or project URL");
    expect(html).toContain("Choose your GitLab instance above.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Connect GitLab<\/button>/);
    expect(html).not.toContain("Connect to <strong>");
    expect(mock.begin).not.toHaveBeenCalled();
  });
  it("preserves GitHub's explicit cloud configuration rather than breaking its existing flow", () => {
    mock.connections = [{ id: "synthetic-github", provider: "github", origin: "https://github.com" }];
    const html = renderToStaticMarkup(createElement(RepositoryOAuthConnection, { projectId: "synthetic-project", providerId: "github", onConnected: vi.fn(), onClose: vi.fn() }));
    expect(html).toContain("Connect to <strong>github.com</strong>");
    expect(html).not.toContain("GitLab instance or project URL");
    expect(mock.begin).not.toHaveBeenCalled();
  });
});
