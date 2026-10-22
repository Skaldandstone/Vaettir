"use client";

import { useState } from "react";
import { trpcReact } from "@/lib/trpcReact";
import { canAdministerOrganization } from "@/lib/membership";
import { IdentityAccessEditor } from "@/components/IdentityAccessEditor";

export default function AccessSettingsPage() {
  const organizations = trpcReact.organization.mine.useQuery();
  const [selected, setSelected] = useState<string | null>(null);
  // Do not silently choose a different tenant when there is more than one.
  const available = organizations.data?.filter(canAdministerOrganization) ?? [];
  const id = selected ?? (available.length === 1 ? available[0]!.id : null);
  if (organizations.isPending) return <p role="status">Loading workspace access…</p>;
  if (organizations.isError) return <div role="alert">Could not load workspaces. <button onClick={() => organizations.refetch()}>Try again</button></div>;
  if (!available.length) return <p>Workspace administrator access is required.</p>;
  if (!id) return <section style={{ maxWidth: 640, margin: "24px auto" }}><h1>Workspace access</h1><p>Choose the workspace to configure.</p>{available.map(org => <button key={org.id} onClick={() => setSelected(org.id)} style={{ display: "block", margin: "12px 0" }}>{org.name}</button>)}</section>;
  return <AccessWorkspace key={id} organizationId={id} />;
}

function AccessWorkspace({ organizationId }: { organizationId: string }) {
  const query = trpcReact.identityAccess.configuration.useQuery({ organizationId }, { retry: false });
  const mutation = trpcReact.identityAccess.saveDraft.useMutation();
  const publish = trpcReact.identityAccess.publishDraft.useMutation();
  if (query.isPending) return <p role="status">Loading access settings…</p>;
  if (query.isError || !query.data) return <div role="alert">Could not load access settings. <button onClick={() => query.refetch()}>Try again</button></div>;
  return <IdentityAccessEditor initial={query.data} onSave={(configuration, expectedRevision) => mutation.mutateAsync({ organizationId, configuration, expectedRevision })}
    onPublish={(expectedDraftRevision, expectedPolicyRevision) => publish.mutateAsync({ organizationId, expectedDraftRevision, expectedPolicyRevision, approveLocalRules: true })}
    onReload={async () => { const result = await query.refetch(); if (result.error || !result.data) throw new Error("Reload failed"); return result.data; }} />;
}
