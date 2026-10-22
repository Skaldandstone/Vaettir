import React from "react";
import { createRoot } from "react-dom/client";
import { IdentityAccessEditor, type AccessDraftView } from "../../components/IdentityAccessEditor";

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
createRoot(document.getElementById("root")!).render(<><a href="/other" style={{ display: "block", margin: "8px 24px" }}>Synthetic navigation</a><IdentityAccessEditor initial={load()} onReload={async () => load()}
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
