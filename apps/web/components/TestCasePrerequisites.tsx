"use client";

import { useMemo, useState } from "react";
import { trpcReact } from "@/lib/trpcReact";

export function TestCasePrerequisites({ projectId, caseId, canEdit }: {
  projectId: string;
  caseId: string;
  canEdit: boolean;
}) {
  const utils = trpcReact.useUtils();
  const structure = trpcReact.testCaseStructure.list.useQuery({ projectId });
  const cases = trpcReact.testCases.list.useQuery({ projectId });
  const save = trpcReact.testCaseStructure.setPrerequisites.useMutation();
  const [draft, setDraft] = useState<{ caseId: string; ids: string[]; baseline: string[] } | null>(null);
  const [nextId, setNextId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const baseline = useMemo(() => structure.data?.prerequisites
    .filter(link => link.dependentId === caseId)
    .map(link => link.prerequisiteId) ?? [], [structure.data, caseId]);
  const selected = draft?.caseId === caseId ? draft.ids : baseline;
  const baselineKey = [...baseline].sort().join("\u0000");
  const dirty = [...selected].sort().join("\u0000") !== baselineKey;
  function select(ids: string[]) {
    setDraft({ caseId, ids, baseline: draft?.caseId === caseId ? draft.baseline : baseline });
  }
  const known = new Map(cases.data?.map(testCase => [testCase.id, testCase.title]) ?? []);

  async function saveChanges() {
    setError(null);
    try {
      await save.mutateAsync({ projectId, dependentId: caseId, prerequisiteIds: selected, expectedPrerequisiteIds: draft?.caseId === caseId ? draft.baseline : baseline });
      await utils.testCaseStructure.list.invalidate({ projectId });
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save prerequisites.");
    }
  }

  return <section aria-label="Prerequisite test cases" style={{ marginTop: 16 }}>
    <h3 style={{ fontSize: 15, marginBottom: 4 }}>Prerequisite test cases</h3>
    <p className="text-muted" style={{ fontSize: 12, marginTop: 0 }}>
      Manual runs include these cases first and require a Pass before this case can be executed.
    </p>
    {structure.error && <p role="alert">Prerequisites could not be loaded: {structure.error.message}</p>}
    {selected.length === 0 && <p className="text-muted" style={{ fontSize: 12 }}>None set.</p>}
    {selected.length > 0 && <ul style={{ listStyle: "none", padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
      {selected.map(id => <li key={id} className="status-pill status-info" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {known.get(id) ?? "Unavailable case"}
        {canEdit && <button type="button" aria-label={`Remove ${known.get(id) ?? "prerequisite"}`} onClick={() => select(selected.filter(value => value !== id))} disabled={save.isPending}>×</button>}
      </li>)}
    </ul>}
    {canEdit && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <label htmlFor={`prerequisite-${caseId}`}>Add prerequisite</label>
      <select id={`prerequisite-${caseId}`} value={nextId} onChange={event => setNextId(event.target.value)} disabled={save.isPending || cases.isLoading}>
        <option value="">Choose a case…</option>
        {cases.data?.filter(testCase => !testCase.archived && testCase.id !== caseId && !selected.includes(testCase.id)).map(testCase => <option key={testCase.id} value={testCase.id}>{testCase.title}</option>)}
      </select>
      <button type="button" className="btn-secondary" disabled={!nextId || save.isPending || selected.length >= 50} onClick={() => { select([...selected, nextId]); setNextId(""); }}>Add</button>
      {selected.length >= 50 && <span className="text-muted" style={{ fontSize: 12 }}>Maximum 50 direct prerequisites.</span>}
      <button type="button" className="btn-primary" disabled={!dirty || save.isPending || !structure.data} onClick={() => void saveChanges()}>{save.isPending ? "Saving…" : "Save prerequisites"}</button>
    </div>}
    {error && <p role="alert" style={{ color: "var(--ember)" }}>{error}</p>}
  </section>;
}
