"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact, useReadOnlySeat, type RouterOutputs } from "@/lib/trpcReact";
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
  projectRepo,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  qaStrategyTypeId: string | undefined;
  projectRepo: { repoUrl: string | null; defaultBranch: string } | null;
  onCreated: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [groundInBuild, setGroundInBuild] = useState(false);
  const [baseRef, setBaseRef] = useState("");
  const [headRef, setHeadRef] = useState("");
  const [draft, setDraft] = useState<RouterOutputs["testPlans"]["generateStrategyDraft"] | null>(null);
  const [planName, setPlanName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // P1-15: mutateAsync keeps the original sequential generate -> edit -> create
  // flow; these are one-shot AI/create actions, not cached data.
  const generateMutation = trpcReact.testPlans.generateStrategyDraft.useMutation();
  const createMutation = trpcReact.testPlans.create.useMutation();

  function linesToArray(text: string): string[] {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async function generate() {
    if (!prompt.trim()) return;
    setError(null);
    try {
      const result = await generateMutation.mutateAsync({
        projectId,
        prompt: prompt.trim(),
        ...(groundInBuild && headRef.trim()
          ? { baseRef: baseRef.trim() || undefined, headRef: headRef.trim() }
          : {}),
      });
      setDraft(result);
      setPlanName(prompt.trim().length > 60 ? `${prompt.trim().slice(0, 57)}…` : prompt.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function createFromDraft() {
    if (!draft || !qaStrategyTypeId || !planName.trim()) return;
    setError(null);
    try {
      const { groundedInCommits: _groundedInCommits, ...customFields } = draft;
      await createMutation.mutateAsync({
        projectId,
        testPlanTypeId: qaStrategyTypeId,
        name: planName.trim(),
        customFields,
      });
      setPrompt("");
      setDraft(null);
      setPlanName("");
      onClose();
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const generating = generateMutation.isPending;
  const creating = createMutation.isPending;

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
        {projectRepo?.repoUrl && (
          <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 8 }}>
            <label style={{ fontSize: 13 }}>
              <input type="checkbox" checked={groundInBuild} onChange={(e) => setGroundInBuild(e.target.checked)} /> Ground in a
              real build (the actual commits between two refs, e.g. "what's in this release")
            </label>
            {groundInBuild && (
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <input
                  value={baseRef}
                  onChange={(e) => setBaseRef(e.target.value)}
                  placeholder={`Base ref (default: ${projectRepo.defaultBranch})`}
                  style={{ flex: 1, fontSize: 13 }}
                />
                <input
                  value={headRef}
                  onChange={(e) => setHeadRef(e.target.value)}
                  placeholder="Head ref (tag, branch, or commit for this build)"
                  style={{ flex: 1, fontSize: 13 }}
                />
              </div>
            )}
          </div>
        )}
        <button
          className="btn-secondary"
          onClick={generate}
          disabled={generating || !prompt.trim() || !qaStrategyTypeId || (groundInBuild && !headRef.trim())}
        >
          {generating ? "Generating…" : "Generate draft"}
        </button>

        {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

        {draft?.groundedInCommits && (
          <details style={{ fontSize: 12 }}>
            <summary>Grounded in {draft.groundedInCommits.length} real commit(s)</summary>
            <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
              {draft.groundedInCommits.map((c) => (
                <li key={c.sha}>
                  <code>{c.sha}</code> {c.subject}
                </li>
              ))}
            </ul>
          </details>
        )}

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

// P1-15
export default function TestPlansPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const utils = trpcReact.useUtils();
  const readOnly = useReadOnlySeat(projectId);
  const projectQuery = trpcReact.project.byId.useQuery({ id: projectId });
  const typesQuery = trpcReact.testPlans.types.useQuery();
  const plansQuery = trpcReact.testPlans.list.useQuery({ projectId });
  const plans = plansQuery.data ?? [];
  const types = typesQuery.data ?? [];
  const projectRepo = projectQuery.data ? { repoUrl: projectQuery.data.repoUrl, defaultBranch: projectQuery.data.defaultBranch } : null;

  const [name, setName] = useState("");
  const [testPlanTypeId, setTestPlanTypeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);

  useEffect(() => {
    if (!testPlanTypeId && types[0]) setTestPlanTypeId(types[0].id);
  }, [types, testPlanTypeId]);

  const invalidatePlans = () => void utils.testPlans.list.invalidate({ projectId });

  const createMutation = trpcReact.testPlans.create.useMutation({
    onSuccess: () => {
      setName("");
      invalidatePlans();
    },
    onError: (e) => setError(e.message),
  });

  const visiblePlans = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plans.filter(
      (p) => (!q || p.name.toLowerCase().includes(q)) && (!statusFilter || p.status === statusFilter),
    );
  }, [plans, search, statusFilter]);

  function submit() {
    if (!testPlanTypeId || !name.trim()) return;
    setError(null);
    createMutation.mutate({ projectId, testPlanTypeId, name: name.trim() });
  }

  const loading = plansQuery.isLoading;
  const pageError = error ?? plansQuery.error?.message ?? null;

  return (
    <div>
      <h1>Test Plans</h1>
      {readOnly && (
        <p className="text-muted" style={{ fontSize: 13 }}>
          You have read-only access to this organization — creating and editing plans is hidden.
        </p>
      )}

      {!readOnly && (
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
        <button onClick={submit} disabled={createMutation.isPending || !name.trim()}>
          {createMutation.isPending ? "Creating…" : "+ New test plan"}
        </button>
        <button className="btn-secondary" onClick={() => setGenerateOpen(true)}>
          Generate strategy with AI
        </button>
      </div>
      )}

      {loading && <p>Loading…</p>}
      {pageError && <p style={{ color: "var(--ember)" }}>{pageError}</p>}

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
        {openPlanId && <TestPlanDetailContent id={openPlanId} onChanged={invalidatePlans} readOnly={readOnly} />}
      </Drawer>

      <GenerateStrategyModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        projectId={projectId}
        qaStrategyTypeId={types.find((t) => t.key === "qa-strategy")?.id}
        projectRepo={projectRepo}
        onCreated={invalidatePlans}
      />
    </div>
  );
}
