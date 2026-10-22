import React from "react";
import { createRoot } from "react-dom/client";
import { IdentityAccessEditor, type AccessDraftView } from "../../components/IdentityAccessEditor";
import { IdentityDirectoryPanel, type DirectoryView } from "../../components/IdentityDirectoryPanel";
import { IdentitySsoPanel } from "../../components/IdentitySsoPanel";

// Synthetic browser-only persistence, never provider or application API calls.
const seed: AccessDraftView = { revision: 1, publication: { available: true, revision: 0, sourceDraftRevision: null, publishedAt: null },
  configuration: { schemaVersion: 1, roles: [
    { id: "author", name: "Test author", permissions: ["project.read", "cases.read", "cases.write"] },
    { id: "reviewer", name: "Release reviewer", permissions: ["plans.read", "reports.read"] },
  ], groups: [{ id: "team", name: "Release engineering", roleIds: ["author"], userIds: ["one"], scope: { kind: "projects", projectIds: ["project"] } }] },
  members: [{ id: "one", name: "Synthetic reviewer", email: "reviewer@example.invalid" }, { id: "two", name: "Synthetic author", email: "author@example.invalid" }],
  projects: [{ id: "project", name: "Synthetic UI verification - long project name for access scope readability" }, { id: "second", name: "Synthetic mobile regression" }],
};
const load = (): AccessDraftView => JSON.parse(localStorage.getItem("identity-fixture") ?? JSON.stringify(seed));
const directorySeed: DirectoryView[] = [{ id: "synthetic-directory", providerConnectionId: "Synthetic Google Workspace connection", enabled: true, revision: 1,
  mappings: [], groups: ["synthetic-group-release-reviewers-with-a-long-stable-id"], observedMembers: 2, activeMembers: 2, staleMembers: 0, lastObservedAt: "2026-10-22T07:00:00Z" }];
const loadDirectory = () => ({ connections: JSON.parse(localStorage.getItem("directory-fixture") ?? JSON.stringify(directorySeed)) as DirectoryView[], roles: seed.configuration.roles });
createRoot(document.getElementById("root")!).render(<><a href="/other" style={{ display: "block", margin: "8px 24px" }}>Synthetic navigation</a><IdentityAccessEditor initial={load()} onReload={async () => load()}
  identitySetup={<><IdentitySsoPanel inspect={async () => {
    const mode = localStorage.getItem("sso-fixture") ?? "ready";
    if (mode === "error") throw new Error("Synthetic provider unavailable");
    if (mode === "unavailable" || mode === "provider-admin-required") return { status: mode, connections: [] };
    return { status: "ready", clerkOrganizationId: "org_synthetic", clerkSubject: "user_synthetic", revision: 1,
      connections: [{ id: "saml_synthetic", name: "Synthetic Google Workspace", provider: "saml_google", active: false }] };
  }} openSetup={async () => { localStorage.setItem("sso-open-count", String(Number(localStorage.getItem("sso-open-count") ?? 0) + 1)); }}/>
  <IdentityDirectoryPanel initial={loadDirectory()} projects={seed.projects} reload={async () => {
    if (localStorage.getItem("fail-directory-reload")) throw new Error("Synthetic reload failure"); return loadDirectory();
  }} update={async (id, revision, change) => {
    if (localStorage.getItem("fail-directory") === "before") throw new Error("Synthetic write failure");
    const rows = loadDirectory().connections, row = rows.find(item => item.id === id)!;
    if (row.revision !== revision) throw new Error("Synthetic revision conflict");
    row.revision++; row.activeMembers = 0; row.staleMembers = row.observedMembers;
    if (change.kind === "disable") row.enabled = false; else row.mappings = change.mappings;
    localStorage.setItem("directory-fixture", JSON.stringify(rows));
    if (localStorage.getItem("fail-directory") === "after") throw new Error("Synthetic lost response");
  }}/></>}
  onPublish={async (draftRevision, policyRevision) => {
    if (localStorage.getItem("fail-publish") === "before") throw new Error("Synthetic publication failure");
    const current = load();
    if (draftRevision !== current.revision || policyRevision !== current.publication?.revision) throw new Error("Synthetic publication conflict");
    const result = { revision: policyRevision + 1, sourceDraftRevision: draftRevision, publishedAt: new Date().toISOString() };
    localStorage.setItem("identity-fixture", JSON.stringify({ ...current, publication: { available: true, ...result } }));
    if (localStorage.getItem("fail-publish") === "after") throw new Error("Synthetic lost acknowledgement");
    return result;
  }}
  onSave={async (configuration, revision) => {
    if (localStorage.getItem("fail-save") === "true") throw new Error("Synthetic save failed. Your changes are still here.");
    const current = load();
    if (revision !== current.revision) throw new Error("Access settings changed in another session. Reload the saved version before saving again.");
    const next = { ...current, revision: revision + 1, configuration };
    localStorage.setItem("identity-fixture", JSON.stringify(next)); return { revision: next.revision };
  }} /></>);
