// Actual queue controller and React markup, synthetic hooks/access/RPC only.
// No browser, customer import, database or provider is used by this regression.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it } from "vitest";
import { controllerTranspile } from "./controller-transpile.fixture";

type Node = React.ReactElement<Record<string, unknown>>;
function elements(root: React.ReactNode): Node[] {
  if (Array.isArray(root)) return root.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...elements(root.props.children as React.ReactNode)];
}
function text(root: React.ReactNode): string {
  if (Array.isArray(root)) return root.map(text).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(root)) return text(root.props.children);
  return typeof root === "string" || typeof root === "number" ? String(root) : "";
}
function harness(state = "DRAFT") {
  const source = readFileSync(new URL("../components/ImportMappingQueue.tsx", import.meta.url), "utf8");
  const code = controllerTranspile(source + "\nexport { QueueEditor };", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  const slots: unknown[] = [];
  let cursor = 0, fail = false, commits = 0, reads = 0;
  const hooks = {
    ...React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial: unknown) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useEffect() {},
  };
  const candidate = { title: "Synthetic case", externalId: "1", given: [], when: ["Open"], then: ["Shown"], suitePath: "Parent / Child", priority: "LOW", testType: "FUNCTIONAL", automationStatus: "MANUAL" };
  const row = { id: "row", sheet: "", originalRowNumber: 2, state: "MAPPING", candidate, reasons: [], original: { headers: ["Title"], cells: [candidate.title] } };
  const data = { state, digest: "original", readyCount: 8, pendingCount: state === "DRAFT" ? 0 : 1, contextCount: 0, historyCount: 0, rows: state === "DRAFT" ? [] : [row] };
  const query = { data, isFetching: false, isPaused: false, error: null, refetch: async () => {
    reads++; query.data = { ...data, state: "CONFIRMED", readyCount: 0, pendingCount: 0, rows: [] };
  } };
  const requests: unknown[] = [];
  const mutation = { useMutation: () => ({ isPending: false, mutateAsync: async (input: unknown) => {
    requests.push(structuredClone(input));
    if (fail) { fail = false; throw Error("Uncertain response"); }
    return { createdCount: state === "DRAFT" ? 8 : 1, updatedCount: 0, pendingCount: 0 };
  } }) };
  const access = { canEdit: true, origin: { organizationId: "org", clerkActorId: "actor" }, owns: () => access.canEdit };
  const modules: Record<string, unknown> = { react: hooks,
    "@/lib/trpcReact": { trpcReact: { importJobs: { mappingQueue: { useQuery: () => query }, resolveMapping: mutation, confirmMapping: mutation } } },
    "@/lib/use-case-field-access": {},
  };
  const exports: { QueueEditor?: (props: unknown) => React.ReactNode } = {};
  new Function("require", "exports", "React", code)((name: string) => {
    if (!(name in modules)) throw Error(`Unexpected boundary: ${name}`);
    return modules[name];
  }, exports, React);
  let tree: React.ReactNode;
  function render() { cursor = 0; tree = exports.QueueEditor!({ projectId: "project", batchId: "batch", access, onCommitted: () => { commits++; } }); }
  function button(label: string) { render(); return elements(tree).find(node => node.type === "button" && text(node.props.children as React.ReactNode).trim() === label); }
  async function click(label: string) {
    const node = button(label); expect(node).toBeDefined(); expect(node!.props.disabled).not.toBe(true);
    (node!.props.onClick as () => void)();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    render();
  }
  render();
  return { access, requests, button, click, failNext: () => { fail = true; },
    get commits() { return commits; }, get reads() { return reads; },
    html: () => { render(); return renderToStaticMarkup(tree); },
    select: () => { render(); const node = elements(tree).find(n => n.type === "input" && n.props.type === "checkbox")!;
      (node.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } }); },
  };
}

it("replaces a cached eight-ready draft with its success receipt without another import", async () => {
  const h = harness(); expect(h.html()).toContain("8 cases are ready");
  await h.click("Import");
  expect(h.html()).toContain("8 created"); expect(h.html()).not.toContain("cases are ready");
  expect(h.button("Import")).toBeUndefined(); expect(h.button("Retry")).toBeUndefined();
  expect(h.requests).toHaveLength(1); expect(h.commits).toBe(1);
  await h.click("Refresh saved mapping rows");
  expect(h.html()).toContain("No unresolved rows"); expect(h.html()).not.toContain("cases are ready");
  expect(h.requests).toHaveLength(1); expect(h.reads).toBe(1);
});
it("hides stale resolved rows until a deliberate refresh", async () => {
  const h = harness("CONFIRMED"); h.select(); await h.click("Import");
  expect(h.html()).toContain("1 created"); expect(h.html()).not.toContain("Synthetic case");
  expect(h.button("Import")).toBeUndefined(); expect(h.requests).toHaveLength(1);
});
it("retains the exact request after an uncertain result and hides all details when access is lost", async () => {
  const h = harness(); h.failNext(); await h.click("Import");
  expect(h.button("Refresh saved mapping rows")?.props.disabled).toBe(true);
  await h.click("Retry"); expect(h.requests).toHaveLength(2); expect(h.requests[1]).toEqual(h.requests[0]);
  expect(h.html()).not.toContain("cases are ready");
  h.access.canEdit = false;
  expect(h.html()).toContain("hidden until original access"); expect(h.html()).not.toContain("8 created");
});
