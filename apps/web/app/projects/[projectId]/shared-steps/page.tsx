"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { Modal } from "@/components/Modal";
import { useProjectPermissions } from "@/lib/use-project-permissions";

interface StepRow {
  action: string;
  expectedActionOrData: string;
  expectedResult: string;
  expectedResponse: string;
}
const EMPTY_STEP: StepRow = { action: "", expectedActionOrData: "", expectedResult: "", expectedResponse: "" };

function StepEditor({ steps, onChange }: { steps: StepRow[]; onChange: (steps: StepRow[]) => void }) {
  return (
    <div>
      {steps.map((step, i) => (
        <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <strong style={{ fontSize: 13 }}>Step {i + 1}</strong>
            <button type="button" onClick={() => onChange(steps.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <input
              placeholder="Action"
              value={step.action}
              onChange={(e) => onChange(steps.map((s, j) => (j === i ? { ...s, action: e.target.value } : s)))}
            />
            <input
              placeholder="Expected action/data (optional)"
              value={step.expectedActionOrData}
              onChange={(e) => onChange(steps.map((s, j) => (j === i ? { ...s, expectedActionOrData: e.target.value } : s)))}
            />
            <input
              placeholder="Expected result (optional)"
              value={step.expectedResult}
              onChange={(e) => onChange(steps.map((s, j) => (j === i ? { ...s, expectedResult: e.target.value } : s)))}
            />
            <input
              placeholder="Expected response (optional)"
              value={step.expectedResponse}
              onChange={(e) => onChange(steps.map((s, j) => (j === i ? { ...s, expectedResponse: e.target.value } : s)))}
            />
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...steps, { ...EMPTY_STEP }])}>
        + Add step
      </button>
    </div>
  );
}

// P1-15
export default function SharedStepsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { canEdit } = useProjectPermissions(projectId);
  const utils = trpcReact.useUtils();
  const groupsQuery = trpcReact.sharedStepGroups.list.useQuery({ projectId });
  const groups = groupsQuery.data ?? [];
  const loading = groupsQuery.isLoading;
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<StepRow[]>([{ ...EMPTY_STEP }]);

  const invalidate = () => utils.sharedStepGroups.list.invalidate({ projectId });
  const onSaved = () => {
    setEditorOpen(false);
    void invalidate();
  };
  const createMutation = trpcReact.sharedStepGroups.create.useMutation({ onSuccess: onSaved, onError: (e) => setError(e.message) });
  const updateMutation = trpcReact.sharedStepGroups.update.useMutation({ onSuccess: onSaved, onError: (e) => setError(e.message) });
  const deleteMutation = trpcReact.sharedStepGroups.delete.useMutation({ onSuccess: () => void invalidate(), onError: (e) => setError(e.message) });
  const saving = createMutation.isPending || updateMutation.isPending;

  function openCreate() {
    setEditingId(null);
    setName("");
    setDescription("");
    setSteps([{ ...EMPTY_STEP }]);
    setEditorOpen(true);
  }

  function openEdit(g: RouterOutputs["sharedStepGroups"]["list"][number]) {
    setEditingId(g.id);
    setName(g.name);
    setDescription(g.description ?? "");
    setSteps(
      g.steps.map((s) => ({
        action: s.action,
        expectedActionOrData: s.expectedActionOrData ?? "",
        expectedResult: s.expectedResult ?? "",
        expectedResponse: s.expectedResponse ?? "",
      })),
    );
    setEditorOpen(true);
  }

  function save() {
    if (!canEdit || !name.trim()) return;
    const cleanSteps = steps.filter((s) => s.action.trim());
    if (cleanSteps.length === 0) return;
    setError(null);
    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      steps: cleanSteps.map((s) => ({
        action: s.action,
        expectedActionOrData: s.expectedActionOrData || undefined,
        expectedResult: s.expectedResult || undefined,
        expectedResponse: s.expectedResponse || undefined,
      })),
    };
    if (editingId) updateMutation.mutate({ id: editingId, ...payload });
    else createMutation.mutate({ projectId, ...payload });
  }

  function remove(id: string) {
    if (!canEdit) return;
    if (!confirm("Delete this shared step library?")) return;
    setError(null);
    deleteMutation.mutate({ id });
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Shared step libraries</h1>
        {canEdit && <button className="btn-primary" onClick={openCreate}>
          + New library
        </button>}
      </div>
      <p className="text-muted" style={{ fontSize: 13 }}>
        A step sequence authored once and reused across any number of test cases - edit it here and every case using
        it updates instantly.
      </p>

      {(error ?? groupsQuery.error?.message) && <p style={{ color: "var(--ember)" }}>{error ?? groupsQuery.error?.message}</p>}
      {loading && <p>Loading…</p>}

      {!loading &&
        groups.map((g) => (
          <div key={g.id} className="panel" style={{ marginBottom: 10, padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <strong>{g.name}</strong>{" "}
                <span className="text-muted" style={{ fontSize: 12 }}>
                  ({g.steps.length} steps · used by {g.usageCount} case{g.usageCount === 1 ? "" : "s"})
                </span>
                {g.description && <p style={{ margin: "4px 0 0", fontSize: 13 }}>{g.description}</p>}
              </div>
              {canEdit && <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => openEdit(g)}>Edit</button>
                <button onClick={() => remove(g.id)}>Delete</button>
              </div>}
            </div>
          </div>
        ))}
      {!loading && groups.length === 0 && <p className="text-muted">No shared step libraries yet.</p>}

      <Modal open={canEdit && editorOpen} onClose={() => setEditorOpen(false)} title={editingId ? "Edit step library" : "New step library"}>
        <div style={{ display: "grid", gap: 10 }}>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <StepEditor steps={steps} onChange={setSteps} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn-secondary" onClick={() => setEditorOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save} disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
