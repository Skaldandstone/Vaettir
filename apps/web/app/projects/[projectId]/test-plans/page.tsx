"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Drawer } from "@/components/Drawer";
import { Modal } from "@/components/Modal";
import { TestPlanDetailContent } from "@/components/TestPlanDetailContent";

const STATUSES = ["DRAFT", "ACTIVE", "IN_REVIEW", "APPROVED"];

// P4-02: review-before-save panel for an AI-drafted QA strategy. Shows the
// four generated lists as plain text (one item per line, editable) so the
// user can tweak the draft before it becomes a real TestPlan -- generation
// never silently creates data on its own.
function GenerateStrategyModal({
  open,
  onClose,
  projectId,
  qaStrategyTypeId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  qaStrategyTypeId: string | undefined;
  onCreated: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<RouterOutputs["testPlans"]["generateStrategyDraft"] | null>(null);
  const [planName, setPlanName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function linesToArray(text: string): string[] {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async function generate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await trpc.testPlans.generateStrategyDraft.mutate({ projectId, prompt: prompt.trim() });
      setDraft(result);
      setPlanName(prompt.trim().length > 60 ? `${prompt.trim().slice(0, 57)}…` : prompt.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function createFromDraft() {
    if (!draft || !qaStrategyTypeId || !planName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await trpc.testPlans.create.mutate({
        projectId,
        testPlanTypeId: qaStrategyTypeId,
        name: planName.trim(),
        customFields: draft,
      });
      setPrompt("");
      setDraft(null);
      setPlanName("");
      onClose();
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Generate a QA strategy draft">
      <div style={{ display: "grid", gap: 10, minWidth: 420 }}>
        {!qaStrategyTypeId && (
          <p style={{ color: "var(--ember)" }}>No "QA Strategy" plan type exists in this org - nothing to generate into.</p>
        )}
        <label>
          What's changing or shipping?
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            placeholder="e.g. We're shipping a new payments checkout flow in Q3"
            style={{ width: "100%" }}
          />
        </label>
        <button className="btn-secondary" onClick={generate} disabled={generating || !prompt.trim() || !qaStrategyTypeId}>
          {generating ? "Generating…" : "Generate draft"}
        </button>

        {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

        {draft && (
          <>
            <label>
              Plan name
              <input value={planName} onChange={(e) => setPlanName(e.target.value)} style={{ width: "100%" }} />
            </label>
            {(
              [
                ["riskAreas", "Risk areas"],
                ["environments", "Environments"],
                ["entryCriteria", "Entry criteria"],
                ["exitCriteria", "Exit criteria"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label} <span className="text-muted" style={{ fontSize: 12 }}>(one per line, edit freely)</span>
                <textarea
                  value={draft[key].join("\n")}
                  onChange={(e) => setDraft({ ...draft, [key]: linesToArray(e.target.value) })}
                  rows={3}
                  style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
                />
              </label>
            ))}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button className="btn-secondary" onClick={onClose}>
                Discard
              </button>
              <button className="btn-primary" onClick={createFromDraft} disabled={creating || !planName.trim()}>
                {creating ? "Creating…" : "Create QA strategy plan"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function TestPlansPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [plans, setPlans] = useState<RouterOutputs["testPlans"]["list"]>([]);
  const [types, setTypes] = useState<RouterOutputs["testPlans"]["types"]>([]);
  const [name, setName] = useState("");
  const [testPlanTypeId, setTestPlanTypeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);

  useEffect(() => {
    trpc.testPlans.types.query().then((t) => {
      setTypes(t);
      if (t[0]) setTestPlanTypeId(t[0].id);
    });
  }, []);

  function loadPlans() {
    setLoading(true);
    setError(null);
    trpc.testPlans.list
      .query({ projectId })
      .then(setPlans)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(loadPlans, [projectId]);

  const visiblePlans = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plans.filter(
      (p) => (!q || p.name.toLowerCase().includes(q)) && (!statusFilter || p.status === statusFilter),
    );
  }, [plans, search, statusFilter]);

  async function submit() {
    if (!testPlanTypeId || !name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await trpc.testPlans.create.mutate({ projectId, testPlanTypeId, name: name.trim() });
      setName("");
      loadPlans();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h1>Test Plans</h1>

      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "16px 0" }}>
        <select value={testPlanTypeId} onChange={(e) => setTestPlanTypeId(e.target.value)}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Plan name, press Enter…"
        />
        <button onClick={submit} disabled={creating || !name.trim()}>
          {creating ? "Creating…" : "+ New test plan"}
        </button>
        <button className="btn-secondary" onClick={() => setGenerateOpen(true)}>
          Generate strategy with AI
        </button>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

      {plans.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search plans…" style={{ flex: 1, maxWidth: 300 }} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}

      <ul>
        {visiblePlans.map((p) => (
          <li key={p.id}>
            <a
              href={`/projects/${projectId}/test-plans/${p.id}`}
              onClick={(e) => {
                e.preventDefault();
                setOpenPlanId(p.id);
              }}
            >
              {p.name}
            </a>{" "}
            <small>
              [{p.testPlanType.name}] {p.status} — {p.acceptanceCriteria.length} acceptance criteria
            </small>
          </li>
        ))}
        {!loading && plans.length === 0 && <p style={{ color: "var(--muted)" }}>No test plans yet.</p>}
        {!loading && plans.length > 0 && visiblePlans.length === 0 && <p style={{ color: "var(--muted)" }}>No test plans match.</p>}
      </ul>

      <Drawer open={openPlanId !== null} onClose={() => setOpenPlanId(null)}>
        {openPlanId && <TestPlanDetailContent id={openPlanId} onChanged={loadPlans} />}
      </Drawer>

      <GenerateStrategyModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        projectId={projectId}
        qaStrategyTypeId={types.find((t) => t.key === "qa-strategy")?.id}
        onCreated={loadPlans}
      />
    </div>
  );
}
