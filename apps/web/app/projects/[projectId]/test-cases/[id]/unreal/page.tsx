"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import { useProjectPermissions } from "@/lib/use-project-permissions";

type Objective = {
  name: string; actorTag: string; actorLabel: string; optional: boolean;
  acceptanceRadiusCm: number; timeBudgetSeconds: number;
  interactOnArrival: boolean; interactionVerb: string;
};
type Binding = {
  projectKey: string; map: string; persona: string; walkSeconds: number;
  drivePlayer: boolean; knowsObjectives: boolean; objectives: Objective[];
};
const newObjective = (): Objective => ({
  name: "", actorTag: "", actorLabel: "", optional: false,
  acceptanceRadiusCm: 100, timeBudgetSeconds: 90,
  interactOnArrival: false, interactionVerb: "",
});
const initialBinding: Binding = {
  projectKey: "", map: "", persona: "careful-first-timer", walkSeconds: 120,
  drivePlayer: true, knowsObjectives: false, objectives: [newObjective()],
};
function candidateScore(intent: string, candidate: string) {
  const terms = new Set(intent.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 3));
  return candidate.toLowerCase().split(/[^a-z0-9]+/).filter((term) => terms.has(term)).length;
}

function RunEvidence({ serialized }: { serialized: string }) {
  let value: {
    error?: string | null;
    objectives?: Array<{ name: string; reached: boolean; resolvedTo: string; seconds: number; wrongTurns: number }>;
    report?: { findingCount?: number; findings?: Array<{ kind: string; detail: string }> };
  };
  try { value = JSON.parse(serialized); } catch { return <p>Result details could not be displayed.</p>; }
  return <div style={{ marginTop: 8, padding: 12, border: "1px solid var(--line)", borderRadius: 8 }}>
    {value.error && <p role="status"><strong>Result:</strong> {value.error}</p>}
    <strong>Objectives</strong>
    <ul>{value.objectives?.map((objective, index) => <li key={`${objective.name}-${index}`}>
      {objective.reached ? "Reached" : "Not reached"}: {objective.name} ({objective.resolvedTo || "unresolved"}; {Math.round(objective.seconds)} s; {objective.wrongTurns} wrong turns)
    </li>)}</ul>
    {value.report && <p>{value.report.findingCount ?? 0} playtester finding(s) in the local report.</p>}
    {value.report?.findings?.length ? <details><summary>Finding summary</summary><ul>{value.report.findings.map((finding, index) => <li key={index}>{finding.kind}: {finding.detail}</li>)}</ul></details> : null}
  </div>;
}

export default function UnrealPlaytestPage() {
  const { projectId, id } = useParams<{ projectId: string; id: string }>();
  const { canEdit } = useProjectPermissions(projectId);
  const [draft, setDraft] = useState<Binding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const saved = trpcReact.unrealPlaytests.binding.useQuery({ testCaseId: id });
  const catalogs = trpcReact.unrealPlaytests.catalogs.useQuery({ projectId });
  const testCase = trpcReact.testCases.byId.useQuery({ id });
  const runs = trpcReact.unrealPlaytests.runsForCase.useQuery({ testCaseId: id });
  const save = trpcReact.unrealPlaytests.saveBinding.useMutation();
  const queue = trpcReact.unrealPlaytests.queue.useMutation();
  const binding = draft ?? saved.data ?? initialBinding;
  function setBinding(next: Binding | ((current: Binding) => Binding)) {
    setDraft((current) => typeof next === "function" ? next(current ?? saved.data ?? initialBinding) : next);
  }
  const catalog = catalogs.data?.find((item) => item.projectKey === binding.projectKey);
  const selectedMap = catalog?.maps.find((item) => item.path === binding.map);
  const caseIntent = [testCase.data?.title, ...(testCase.data?.when ?? []), ...(testCase.data?.then ?? [])].filter(Boolean).join(" ");
  const mapChoices = [...(catalog?.maps ?? [])].sort((a, b) => candidateScore(caseIntent, b.path) - candidateScore(caseIntent, a.path));

  function suggestObjectives() {
    const steps = testCase.data?.when ?? [];
    if (!steps.length) { setMessage("Write When steps on the Vaettir test case first, then review the proposed goals here."); return; }
    setBinding((current) => ({ ...current, objectives: steps.slice(0, 30).map((step) => ({ ...newObjective(), name: step.slice(0, 120) })) }));
    setMessage("Draft goals copied from this case's When steps. Confirm the ordered goals and choose each real Unreal actor before saving.");
  }

  function updateObjective(index: number, change: Partial<Objective>) {
    setBinding((current) => ({ ...current, objectives: current.objectives.map((item, i) => i === index ? { ...item, ...change } : item) }));
  }
  async function saveBinding() {
    setError(null); setMessage(null);
    try {
      await save.mutateAsync({ testCaseId: id, config: binding });
      setMessage("Binding saved. The local Unreal worker must be configured for this project key before running.");
      await saved.refetch();
      setDraft(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  async function queueRun() {
    setError(null); setMessage(null);
    try {
      const job = await queue.mutateAsync({ testCaseId: id });
      setMessage(`Queued ${job.id}. A local Unreal worker must claim it; queued does not mean passed.`);
      await runs.refetch();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <p><a href={`/projects/${projectId}/test-cases/${id}`}>← Test case</a></p>
      <h1>Unreal playtest</h1>
      <p style={{ color: "var(--muted)" }}>Technical preview: bind this Vaettir test to one level and ordered objectives from a local Unreal worker&apos;s catalog. Candidate matches need your confirmation. A live game round trip remains a release gate.</p>
      {error && <p role="alert" style={{ color: "var(--ember)" }}>{error}</p>}
      {message && <p role="status">{message}</p>}
      {saved.isLoading ? <p>Loading binding…</p> : (
        <fieldset disabled={!canEdit || save.isPending || queue.isPending} style={{ border: "1px solid var(--line)", padding: 16 }}>
          <legend>Execution binding</legend>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <label>Local game project<select value={binding.projectKey} onChange={(e) => setBinding({ ...binding, projectKey: e.target.value, map: "" })}><option value="">Choose a discovered project</option>{catalogs.data?.map((item) => <option key={item.projectKey} value={item.projectKey}>{item.projectKey}</option>)}</select></label>
            <label>Unreal level<select value={binding.map} onChange={(e) => setBinding({ ...binding, map: e.target.value })}><option value="">Choose a discovered level</option>{mapChoices.map((item) => <option key={item.path} value={item.path}>{item.path}{candidateScore(caseIntent, item.path) ? " (text match)" : ""}</option>)}</select></label>
            <label>Persona<input value={binding.persona} onChange={(e) => setBinding({ ...binding, persona: e.target.value })} /></label>
            <label>Duration, seconds<input type="number" min={10} max={900} value={binding.walkSeconds} onChange={(e) => setBinding({ ...binding, walkSeconds: Number(e.target.value) })} /></label>
          </div>
          <p><label><input type="checkbox" checked={binding.drivePlayer} onChange={(e) => setBinding({ ...binding, drivePlayer: e.target.checked })} /> Drive the project player pawn</label></p>
          <p><label><input type="checkbox" checked={binding.knowsObjectives} onChange={(e) => setBinding({ ...binding, knowsObjectives: e.target.checked })} /> Tell the playtester the objectives up front</label></p>
          <h2>Ordered objectives</h2>
          <p><button type="button" onClick={suggestObjectives}>Draft goals from this case&apos;s When steps</button> Review each goal and target before saving.</p>
          {binding.objectives.map((objective, index) => (
            <div key={index} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <strong>{index + 1}.</strong>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                <label>Goal name<input value={objective.name} onChange={(e) => updateObjective(index, { name: e.target.value })} /></label>
                <label>Actor tag<input value={objective.actorTag} onChange={(e) => updateObjective(index, { actorTag: e.target.value })} /></label>
                <label>Actor label<input value={objective.actorLabel} onChange={(e) => updateObjective(index, { actorLabel: e.target.value })} /></label>
                <label>Choose discovered actor<select value={objective.actorLabel} onChange={(e) => updateObjective(index, { actorLabel: e.target.value, actorTag: "" })}><option value="">Choose a map actor</option>{[...(selectedMap?.actors ?? [])].sort((a, b) => candidateScore(objective.name, b.label + " " + b.tags.join(" ")) - candidateScore(objective.name, a.label + " " + a.tags.join(" "))).map((actor, actorIndex) => <option key={`${actor.label}-${actorIndex}`} value={actor.label}>{actor.label}{actor.tags.length ? ` [${actor.tags.join(", ")}]` : ""}{candidateScore(objective.name, actor.label + " " + actor.tags.join(" ")) ? " (text match)" : ""}</option>)}</select></label>
                <label>Acceptance radius, cm<input type="number" min={10} max={1000} value={objective.acceptanceRadiusCm} onChange={(e) => updateObjective(index, { acceptanceRadiusCm: Number(e.target.value) })} /></label>
                <label>Time budget, seconds<input type="number" min={1} max={900} value={objective.timeBudgetSeconds} onChange={(e) => updateObjective(index, { timeBudgetSeconds: Number(e.target.value) })} /></label>
                <label>Interaction verb<input value={objective.interactionVerb} onChange={(e) => updateObjective(index, { interactionVerb: e.target.value })} /></label>
              </div>
              <p><label><input type="checkbox" checked={objective.optional} onChange={(e) => updateObjective(index, { optional: e.target.checked })} /> Optional</label> {" "}
              <label><input type="checkbox" checked={objective.interactOnArrival} onChange={(e) => updateObjective(index, { interactOnArrival: e.target.checked })} /> Interact on arrival</label></p>
              <button type="button" onClick={() => setBinding({ ...binding, objectives: binding.objectives.filter((_, i) => i !== index) })} disabled={binding.objectives.length <= 1}>Remove objective</button>
            </div>
          ))}
          <button type="button" onClick={() => setBinding({ ...binding, objectives: [...binding.objectives, newObjective()] })}>Add objective</button>
          {!catalogs.data?.length && <p>No local worker catalog has been published for this Vaettir project.</p>}
          <p><button type="button" onClick={saveBinding} disabled={!selectedMap}>Save binding</button> {" "}<button type="button" onClick={queueRun} disabled={!saved.data || JSON.stringify(saved.data) !== JSON.stringify(binding)}>Queue saved playtest</button></p>
        </fieldset>
      )}
      <h2>Runs</h2>
      {runs.isLoading ? <p>Loading runs…</p> : runs.data?.length ? (
        <ul>{runs.data.map((run) => <li key={run.id}>
          {new Date(run.createdAt).toLocaleString()}: {run.status}
          {run.testRunId && <> · <a href={`/projects/${projectId}/test-runs/${run.testRunId}`}>Vaettir test run</a></>}
          {run.result && <RunEvidence serialized={run.result} />}
        </li>)}</ul>
      ) : <p>No playtests queued for this case.</p>}
    </main>
  );
}
