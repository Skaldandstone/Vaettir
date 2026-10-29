import { controllerTranspile } from "./controller-transpile.fixture";
import React from "react";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

// Complete actual admin JSX/callbacks; all reads/auth/dialogs are synthetic.
// No destructive service, native database or authenticated UI is exercised.
type Element = React.ReactElement<Record<string, unknown>>;
function elements(value: unknown, found: Element[] = []): Element[] {
  if (React.isValidElement(value)) { const element = value as Element; found.push(element); elements(element.props.children, found); }
  else if (Array.isArray(value)) value.forEach(child => elements(child, found));
  return found;
}
function label(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : React.isValidElement(value) ? label((value as Element).props.children) : Array.isArray(value) ? value.map(label).join("") : "";
}
const compiled = controllerTranspile(readFileSync(new URL("../app/admin/organizations/[id]/page.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
function harness() {
  const slots: unknown[] = [], sent: unknown[] = [];
  let cursor = 0, tree: React.ReactNode, confirmations = 0;
  const scope = { basis: "ORIGINAL_ORGANIZATION", originalOrganizationId: "synthetic-org", blocked: false };
  const keyScope = { ...scope, limits: { aliases: 100000, writes: 100000 }, limitations: ["Synthetic bounded original scope"],
    originalRecordsOnReparentedProjects: { ProjectCaseKeyAlias: 3, ProjectCaseKeyWrite: 2 },
    originalRecordsOnRemovedProjects: { ProjectCaseKeyAlias: 2, ProjectCaseKeyWrite: 1 },
    foreignOriginalRecordsOnCurrentProjects: { ProjectCaseKeyAlias: 0, ProjectCaseKeyWrite: 0 } };
  const preview: Record<string, unknown> = { organizationId: "synthetic-org", projectCount: 0,
    rowCounts: { ProjectCaseKeyAlias: 5, ProjectCaseKeyWrite: 4, ManualCaseResultHead: 0, ManualCaseResultRevision: 0 },
    reportScope: { ...scope, originalRecordsOnReparentedProjects: {}, unsupportedForeignOriginalRecordsOnCurrentProjects: {}, limitations: [] },
    manualCaseResultScope: { ...scope, limits: { heads: 100000, revisions: 100000 }, limitations: [] }, projectCaseKeyScope: keyScope };
  const org = { id: "synthetic-org", name: "Synthetic", slug: "synthetic-slug", createdAt: "2026-01-01", planTierId: "synthetic-tier", members: [], invitations: [] };
  const orgQuery = { data: org, isPending: false, isFetching: false, isPaused: false, error: null as unknown };
  const hooks = { ...React, useState: (initial: unknown) => {
    const index = cursor++; if (!(index in slots)) slots[index] = initial;
    return [slots[index], (value: unknown) => { slots[index] = value; }];
  } };
  const query = (data: unknown) => ({ useQuery: () => ({ data, isPending: false }) });
  const mutation = (name: string) => ({ useMutation: () => ({ mutateAsync: async (input: unknown) => {
    if (name !== "hardDeleteOrganization") throw Error("Unexpected synthetic mutation " + name);
    sent.push(input); return { deletionLogId: "synthetic-receipt", rowCounts: {} };
  } }) });
  const admin: Record<string, unknown> = { getOrganization: { useQuery: () => orgQuery }, listPlanTiers: query([]), staffActionLog: query([]) };
  for (const name of ["adjustPlanTier", "unlimitedPrivateBetaSeats", "resendInvite", "suspendOrganization", "reactivateOrganization", "transferOwnership", "hardDeleteOrganization", "deactivateMember"]) admin[name] = mutation(name);
  const modules: Record<string, unknown> = { react: hooks, "next/navigation": { useParams: () => ({ id: org.id }) },
    "@clerk/nextjs": { useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "synthetic-clerk" }) },
    "@/lib/membership": { roleLabel: (value: string) => value },
    "@/lib/trpcReact": { trpcReact: { admin, useUtils: () => ({ admin: { previewOrgHardDelete: { fetch: async () => preview } } }) } } };
  const exports: { default?: () => React.ReactNode } = {};
  new Function("require", "exports", "React", "confirm", compiled)((name: string) => {
    if (!Object.hasOwn(modules, name)) throw Error("Unexpected dependency " + name); return modules[name];
  }, exports, React, () => { confirmations++; return true; });
  function render() { cursor = 0; tree = exports.default!(); }
  function button(name: string) { const element = elements(tree).find(e => e.type === "button" && label(e.props.children) === name); if (!element) throw Error("Missing button " + name); return element; }
  async function click(name: string) { const element = button(name); expect(element.props.disabled).not.toBe(true); await (element.props.onClick as () => Promise<void>)(); render(); }
  function changeInput(index: number, value: string) {
    const element = elements(tree).filter(e => e.type === "input")[index]!;
    (element.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }); render();
  }
  render();
  return { preview, keyScope, orgQuery, sent, button, click, render, changeInput,
    get confirmations() { return confirmations; }, html: () => renderToStaticMarkup(tree) };
}
async function reviewed() {
  const h = harness(); await h.click("Preview what would be deleted");
  h.changeInput(0, "Synthetic erasure review"); h.changeInput(1, "synthetic-slug"); return h;
}
it("shows complete original key/receipt and moved-project counts before admitting reviewed deletion", async () => {
  const h = await reviewed(); expect(h.html()).toContain("Key aliases: 5");
  expect(h.html()).toContain("Immutable key-change receipts: 4"); expect(h.html()).toContain("ProjectCaseKeyAlias on moved projects: 3");
  expect(h.html()).toContain("ProjectCaseKeyWrite on moved projects: 2"); expect(h.html()).toContain("100000 aliases and 100000 key-change receipts");
  expect(h.html()).toContain("ProjectCaseKeyAlias on removed projects: 2");
  expect(h.html()).toContain("Counts are not truncated"); expect(h.sent).toEqual([]);
  await h.click("Permanently delete"); expect(h.sent).toEqual([{ organizationId: "synthetic-org", confirmSlug: "synthetic-slug", reason: "Synthetic erasure review" }]);
  expect(h.confirmations).toBe(1);
});
it.each(["absent", "foreign", "basis", "blocked", "report-blocked", "history-blocked", "fetching", "paused", "error"])("%s scope disables the button and refuses the actual handler before destructive transport/dialog", async mode => {
  const h = await reviewed();
  if (mode === "absent") delete h.preview.projectCaseKeyScope;
  if (mode === "foreign") h.keyScope.originalOrganizationId = "other-org";
  if (mode === "basis") h.keyScope.basis = "CURRENT_PROJECT";
  if (mode === "blocked") { h.keyScope.blocked = true; h.keyScope.foreignOriginalRecordsOnCurrentProjects.ProjectCaseKeyWrite = 7; }
  if (mode === "report-blocked") (h.preview.reportScope as { blocked: boolean }).blocked = true;
  if (mode === "history-blocked") (h.preview.manualCaseResultScope as { blocked: boolean }).blocked = true;
  if (mode === "fetching") h.orgQuery.isFetching = true;
  if (mode === "paused") h.orgQuery.isPaused = true;
  if (mode === "error") h.orgQuery.error = Error("Synthetic read refusal");
  h.render(); const button = h.button("Permanently delete"); expect(button.props.disabled).toBe(true);
  await (button.props.onClick as () => Promise<void>)(); h.render();
  expect(h.sent).toEqual([]); expect(h.confirmations).toBe(0);
  expect(h.html()).toContain("must be verified and reconciled before deletion");
  if (mode === "blocked") expect(h.html()).toContain("ProjectCaseKeyWrite owned elsewhere and retained: 7");
  if (["absent", "foreign", "basis"].includes(mode)) expect(h.html()).toContain("Project-key ownership is unavailable");
});
it("discloses foreign-original key metadata as retained, not erasure authority or an automatic foreign deletion", async () => {
  const h = await reviewed(); h.keyScope.foreignOriginalRecordsOnCurrentProjects.ProjectCaseKeyWrite = 7; h.render();
  expect(h.keyScope.blocked).toBe(false); expect(h.html()).toContain("ProjectCaseKeyWrite owned elsewhere and retained: 7");
  expect(h.html()).toContain("its original organization must erase it"); expect(h.button("Permanently delete").props.disabled).toBe(false);
  expect(h.sent).toEqual([]); await h.click("Permanently delete");
  expect(h.sent).toEqual([{ organizationId: "synthetic-org", confirmSlug: "synthetic-slug", reason: "Synthetic erasure review" }]);
});
