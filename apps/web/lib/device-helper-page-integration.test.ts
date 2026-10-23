// Execute the actual page body with synthetic hooks and RPC boundaries. Effects
// are deliberately not run: no pairing generation, helper HTTP or paid mutation.
// This proves caller wiring/cancellation, not React lifecycle or device acceptance.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { expect, it, vi } from "vitest";
import { createDeviceConnectionGeneration, revokeDeviceConnection } from "./device-connector-connection";
import { currentSessionScope } from "./auth-query-cache";

const source = readFileSync(new URL("../app/projects/[projectId]/live-app-generation/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "LiveAppGenerationPage")!;
const printer = ts.createPrinter();
const ownershipClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "LiveCapturePageOwnership");
if (!ownershipClass) throw Error("Actual mounted ownership class is required");
const sdkSource = readFileSync(new URL("./use-device-helper-setup.ts", import.meta.url), "utf8"), sdkAst = ts.createSourceFile("sdk.ts", sdkSource, ts.ScriptTarget.Latest, true);
const sdkDeclarations = sdkAst.statements.filter(node => ts.isFunctionDeclaration(node) && !!node.name && ["helperResource", "currentHelperSetupSession", "createInstalledHelperSdk"].includes(node.name.text))
  .map(node => printer.printNode(ts.EmitHint.Unspecified, node, sdkAst).replace(/\bexport\s+/g, "")).join("\n");
// Execute the actual source dependencies without installing a synthetic ready
// SDK. Effects remain deliberately unrun, so private capture admission is absent.
const code = ts.transpileModule(sdkDeclarations + "\n" + printer.printNode(ts.EmitHint.Unspecified, ownershipClass, ast) + "\n" + printer.printNode(ts.EmitHint.Unspecified, declaration, ast).replace("export default ", "") + "\nthis.page = LiveAppGenerationPage;", {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
type Element = React.ReactElement<Record<string, unknown>>;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children)];
}
const Card = () => null;
const stateNames = declaration.body!.statements.flatMap(statement => {
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations.flatMap(variable =>
    ts.isArrayBindingPattern(variable.name) && variable.initializer && ts.isCallExpression(variable.initializer) && variable.initializer.expression.getText(ast) === "useState"
      ? [variable.name.elements[0]!.getText(ast)] : []);
});
function harness() {
  const slots: unknown[] = [], state: Array<{ name: string; initial: unknown; index: number }> = [];
  const refs: Array<{ current: unknown }> = [];
  let cursor = 0, readOnly = false;
  const actor = { isLoaded: true, isSignedIn: true, userId: "synthetic-clerk", sessionId: "synthetic-session" };
  const project = { data: { id: "synthetic-project", organizationId: "synthetic-org" }, error: null as Error | null, isFetching: false, isPaused: false, isFetchedAfterMount: true };
  const organizations = { ...project, data: [{ id: "synthetic-org", role: "ADMIN" }] };
  const mutate = vi.fn(), network = vi.fn(() => { throw new Error("No helper network in caller fixture"); });
  const makePairing = vi.fn(() => { throw new Error("No pairing generation in caller fixture"); });
  const context = vm.createContext({
    React, CONNECTOR_URL: "http://127.0.0.1:4774", currentSessionScope,
    useParams: () => ({ projectId: "synthetic-project" }), useReadOnlySeat: () => readOnly, useAuth: () => actor,
    canEditProject: () => !readOnly, createDeviceConnectionGeneration, revokeDeviceConnection,
    DeviceHelperSetupStatus: Card, DeviceHelperBlockedLaunchGuidance: () => null,
    useEffect: () => undefined, useLayoutEffect: () => undefined,
    createDeviceConnectorPairingCode: makePairing, fetch: network,
    useState: (initial: unknown) => {
      const index = cursor++;
      if (index >= slots.length) { slots[index] = typeof initial === "function" ? initial() : initial; state.push({ name: stateNames[state.length]!, initial, index }); }
      return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef: (initial: unknown) => {
      const index = cursor++;
      if (index >= slots.length) { slots[index] = { current: initial }; refs.push(slots[index] as { current: unknown }); }
      return slots[index];
    },
    trpcReact: { project: { byId: { useQuery: () => project } }, organization: { mine: { useQuery: () => organizations } }, liveAppGeneration: {
      generateFromUrl: { useMutation: () => ({ mutateAsync: mutate }) }, generateFromDeviceCapture: { useMutation: () => ({ mutateAsync: mutate }) }, commitDraft: { useMutation: () => ({ mutateAsync: mutate }) },
    } },
  });
  vm.runInContext(code, context);
  const page = (context as unknown as { page: () => unknown }).page;
  function render() { cursor = 0; return elements(page()); }
  function card() { return render().find(node => node.type === Card)!; }
  return { slots, state, refs, actor, project, organizations, mutate, network, makePairing, render, card, setReadOnly(value: boolean) { readOnly = value; } };
}

it("actual caller mounts exactly metadata-only intent with no helper transport or private legacy inputs", () => {
  const h = harness(), node = h.card();
  expect(node.props.intent).toEqual({ kind: "CURRENT_METADATA_ONLY", projectId: "synthetic-project", originalOrganizationId: "synthetic-org", active: true, connectionEpoch: 0, reportedBlocked: false });
  expect(Object.keys(node.props).sort()).toEqual(["intent", "onReportedBlocked"]);
  expect(h.mutate).not.toHaveBeenCalled(); expect(h.network).not.toHaveBeenCalled(); expect(h.makePairing).not.toHaveBeenCalled();
});

it("read-only members retain the metadata card, never gain generation authority", () => {
  const h = harness(); h.setReadOnly(true);
  const nodes = h.render();
  expect(nodes.some(node => node.type === Card)).toBe(true);
  expect(nodes.some(node => node.type === "input" && node.props.placeholder === "https://your-staging-app.example.com")).toBe(false);
  expect(h.mutate).not.toHaveBeenCalled();
});

it.each(["fetching", "paused", "error", "missing native organization", "signed out"])("caller does not admit metadata while %s", reason => {
  const h = harness();
  if (reason === "fetching") h.project.isFetching = true;
  if (reason === "paused") h.organizations.isPaused = true;
  if (reason === "error") h.project.error = new Error("Synthetic refusal");
  if (reason === "missing native organization") h.project.data.organizationId = "";
  if (reason === "signed out") h.actor.isSignedIn = false;
  expect((h.card().props.intent as { active: boolean }).active).toBe(false);
  expect(h.network).not.toHaveBeenCalled(); expect(h.mutate).not.toHaveBeenCalled();
});

it("public cancellation aborts existing page checks synchronously and retains all unrelated local state", () => {
  const h = harness(); h.card(); h.setReadOnly(true);
  const retained: Record<string, unknown> = {
    pairingCode: "SYNTHETIC_ONLY", pairingOrigin: { projectId: "old-project" },
    deviceCapture: { synthetic: "retained capture" }, drafts: [{ synthetic: "retained paid draft" }],
    capturing: true, generating: true, androidDevices: [{ synthetic: "retained target" }],
    startUrl: "synthetic text", appiumSessionId: "synthetic retained buffer",
  };
  for (const slot of h.state) if (Object.hasOwn(retained, slot.name)) h.slots[slot.index] = retained[slot.name];
  const node = h.card();
  const connection = h.refs.find(ref => typeof ref.current === "object" && ref.current !== null && "controllers" in ref.current)!.current as ReturnType<typeof createDeviceConnectionGeneration>;
  const discovery = h.refs.find(ref => ref.current === 0)!;
  connection.active = true;
  const controller = new AbortController(); connection.controllers.add(controller);
  const before = h.slots.slice();
  // Even when no current metadata actor is admitted, cancellation is public.
  h.actor.isSignedIn = false;
  (node.props.onReportedBlocked as () => void)();
  expect(controller.signal.aborted).toBe(true); expect(connection.controllers.size).toBe(0);
  expect(connection.blocked).toBe(true); expect(connection.epoch).toBe(1); expect(discovery.current).toBe(1);
  const permitted = new Set(h.state.filter(slot => ["connectorStatus", "discoveringDevices", "error", "manualSetupOpen", "manualSetupRevealed", "helperMetadataCancellationEpoch"].includes(slot.name)).map(slot => slot.index));
  h.slots.forEach((value, index) => { if (!permitted.has(index)) expect(value).toBe(before[index]); });
  const next = h.card().props.intent as { active: boolean; connectionEpoch: number; reportedBlocked: boolean };
  expect(next).toMatchObject({ active: false, connectionEpoch: 1, reportedBlocked: true });
  expect(h.network).not.toHaveBeenCalled(); expect(h.mutate).not.toHaveBeenCalled(); expect(h.makePairing).not.toHaveBeenCalled();
});
