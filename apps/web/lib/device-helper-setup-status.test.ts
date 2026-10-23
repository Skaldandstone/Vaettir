import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { DeviceHelperSetupWorkflow, HelperSetupView } from "./use-device-helper-setup";
const source = readFileSync(new URL("../components/DeviceHelperSetupStatus.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("status.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ast.statements.filter(ts.isFunctionDeclaration).map(node => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport\s+/, "")).join("\n");
const executable = ts.transpileModule(functions + "\nthis.component=DeviceHelperSetupStatus;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
function fixture(patch: Partial<HelperSetupView> = {}, metadata = false, onReportedBlocked?: () => void) {
  const workflow: DeviceHelperSetupWorkflow = { view: { status: "REVIEW_REQUIRED", busy: false, canReview: true, canCheck: false, paired: false, currentScope: null, description: "Public setup metadata only", deviceOperationPerformed: false, processingPermissionGranted: false, spendingApprovalGranted: false, ...patch }, review: vi.fn(async () => undefined), checkPaired: vi.fn(async () => undefined), reportBlocked: vi.fn(), healthAvailable: false };
  const context = vm.createContext({ React, useDeviceHelperSetup: () => workflow, DeviceHelperBlockedLaunchGuidance: () => React.createElement("p", null, "Reported refusal public guidance") });
  vm.runInContext(executable, context);
  const component = (context as unknown as { component(props: unknown): React.ReactElement }).component;
  return { workflow, render: () => component({ intent: metadata ? { kind: "CURRENT_METADATA_ONLY", projectId: "p", originalOrganizationId: "o", active: true, connectionEpoch: 1, reportedBlocked: false } : { platform: "windows" }, onReportedBlocked }) };
}
function buttons(node: React.ReactNode): React.ReactElement<{ onClick?: () => void; disabled?: boolean; children?: React.ReactNode }>[] {
  if (!React.isValidElement<{ children?: React.ReactNode; onClick?: () => void; disabled?: boolean }>(node)) return [];
  const own = node.type === "button" ? [node] : [];
  return [...own, ...React.Children.toArray(node.props.children).flatMap(buttons)];
}
it("actual source surface exposes only explicit metadata controls and no private details, download or capture action", () => {
  const h = fixture(), html = renderToStaticMarkup(h.render());
  for (const text of ["Review current setup access", "Check paired response only", "Windows refused launch", "No local health transport", "not attributed to this current identity"]) expect(html).toContain(text);
  expect(html).not.toMatch(/href=|download=|<input|<textarea|<form|pairingCode|nativeActorId/);
  expect(h.workflow.review).not.toHaveBeenCalled(); expect(h.workflow.checkPaired).not.toHaveBeenCalled(); expect(h.workflow.reportBlocked).not.toHaveBeenCalled();
});
it("private and paired-liveness-only views never imply device/capture readiness", () => {
  const privateHtml = renderToStaticMarkup(fixture({ status: "PRIVATE", canReview: false }).render());
  expect(privateHtml).toContain("Private setup retained"); expect((privateHtml.match(/disabled=""/g) ?? []).length).toBe(3);
  const pairedHtml = renderToStaticMarkup(fixture({ paired: true }).render()); expect(pairedHtml).toContain("Paired response reported v2 liveness only");
  expect(pairedHtml).toContain("Setup does not approve downloads"); expect(pairedHtml).not.toContain("Computer connected");
});
it("reported blocked view renders public guidance without pairing commands or an OS operation", () => {
  const html = renderToStaticMarkup(fixture({ status: "BLOCKED" }).render()); expect(html).toContain("Reported refusal public guidance");
  expect(source).not.toMatch(/\b(?:fetch|window|navigator|downloadFile|captureCurrentScreen|discoverAndroidDevices|generateMutation)\b/);
});
it("actual metadata-only card has no health control or fabricated credential and forwards only the explicit cancellation callback", () => {
  const cancel = vi.fn(), h = fixture({ status: "CURRENT_METADATA_REVIEWED" }, true, cancel), element = h.render(), html = renderToStaticMarkup(element);
  expect(html).toContain("Current workspace metadata reviewed only"); expect(html).toContain("creates no pairing credential");
  expect(html).not.toContain("Check paired response only"); expect(html).not.toMatch(/download=|href=|<input|pairingCode|nativeActorId/);
  const report = buttons(element).find(button => button.props.children === "Windows refused launch"); expect(report?.props.disabled).toBe(false);
  report?.props.onClick?.(); expect(h.workflow.reportBlocked).toHaveBeenCalledWith(cancel); expect(h.workflow.checkPaired).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
});
it("public reported refusal remains discoverable with native metadata private, without enabling reads or claiming capture stopped", () => {
  const h = fixture({ status: "PRIVATE", canReview: false, reportedBlocked: true }, true), element = h.render(), html = renderToStaticMarkup(element);
  expect(html).toContain("Reported refusal public guidance"); expect(html).toContain("does not identify the Windows policy or prove a capture/helper stopped");
  const controls = buttons(element); expect(controls.find(button => button.props.children === "Review current setup access")?.props.disabled).toBe(true);
  expect(controls.find(button => button.props.children === "Windows refused launch")?.props.disabled).toBe(false);
  expect(h.workflow.review).not.toHaveBeenCalled(); expect(h.workflow.checkPaired).not.toHaveBeenCalled();
});
