"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import { collectKnownSuitePaths } from "@/components/TestCaseTree";

const TEST_TYPES = [
  "UNIT",
  "FUNCTIONAL",
  "CONTRACT",
  "INSTRUMENTATION",
  "SMOKE",
  "SANITY",
  "REGRESSION",
  "E2E",
  "PERFORMANCE",
  "SECURITY",
  "ACCESSIBILITY",
  "EXPLORATORY",
  "COMPLIANCE",
  "OTHER",
];

const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

interface StepRow {
  action: string;
  expectedActionOrData: string;
  expectedResult: string;
  expectedResponse: string;
}

interface TestCaseFormValue {
  testPlanId: string;
  title: string;
  background: string;
  testType: string;
  priority: string;
  tags: string;
  suitePath: string;
  given: string[];
  when: string[];
  then: string[];
  steps: StepRow[];
  sharedStepGroupId: string;
}

const EMPTY_STEP: StepRow = { action: "", expectedActionOrData: "", expectedResult: "", expectedResponse: "" };

function defaultValue(): TestCaseFormValue {
  return {
    testPlanId: "",
    title: "",
    background: "",
    testType: "FUNCTIONAL",
    priority: "MEDIUM",
    tags: "",
    suitePath: "",
    given: [],
    when: [],
    then: [],
    steps: [],
    sharedStepGroupId: "",
  };
}

interface TestCaseFormProps {
  mode: "create" | "edit";
  projectId: string;
  testCaseId?: string;
  initial?: Partial<TestCaseFormValue>;
  stepFieldLabels?: { action: string; expectedActionOrData: string; expectedResult: string; expectedResponse: string };
}

function StringListEditor({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
          <input
            value={item}
            onChange={(e) => onChange(items.map((v, j) => (j === i ? e.target.value : v)))}
            style={{ flex: 1 }}
          />
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, ""])}>
        + Add {label.slice(0, -1) || label}
      </button>
    </div>
  );
}

export default function TestCaseForm({ mode, projectId, testCaseId, initial, stepFieldLabels }: TestCaseFormProps) {
  const router = useRouter();
  const [value, setValue] = useState<TestCaseFormValue>({ ...defaultValue(), ...initial });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // P1-15: both reads share the cache with the test-cases list page and the
  // shared-steps page, so opening the form right after either is free.
  const utils = trpcReact.useUtils();
  const casesQuery = trpcReact.testCases.list.useQuery({ projectId });
  const knownSuitePaths = useMemo(() => (casesQuery.data ? collectKnownSuitePaths(casesQuery.data) : []), [casesQuery.data]);
  const sharedGroupsQuery = trpcReact.sharedStepGroups.list.useQuery({ projectId });
  const sharedGroups = sharedGroupsQuery.data ?? [];
  const createMutation = trpcReact.testCases.create.useMutation();
  const updateMutation = trpcReact.testCases.update.useMutation();

  const selectedGroup = sharedGroups.find((g) => g.id === value.sharedStepGroupId);

  const labels = stepFieldLabels ?? {
    action: "Test Step",
    expectedActionOrData: "Expected Action / Data",
    expectedResult: "Expected Result",
    expectedResponse: "Expected Response",
  };

  function updateStep(i: number, patch: Partial<StepRow>) {
    setValue((v) => ({ ...v, steps: v.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        testPlanId: value.testPlanId || undefined,
        title: value.title,
        background: value.background || undefined,
        given: value.given.filter((s) => s.trim()),
        when: value.when.filter((s) => s.trim()),
        then: value.then.filter((s) => s.trim()),
        steps: value.sharedStepGroupId
          ? []
          : value.steps
              .filter((s) => s.action.trim())
              .map((s) => ({
                action: s.action,
                expectedActionOrData: s.expectedActionOrData || null,
                expectedResult: s.expectedResult || null,
                expectedResponse: s.expectedResponse || null,
              })),
        sharedStepGroupId: value.sharedStepGroupId || null,
        tags: value.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        testType: value.testType,
        priority: value.priority as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
        suitePath: value.suitePath || undefined,
      };

      const result =
        mode === "create"
          ? await createMutation.mutateAsync({ ...payload, projectId })
          : await updateMutation.mutateAsync({ ...payload, id: testCaseId! });

      // The detail page + list read from the cache; make sure they see the
      // saved row rather than the pre-edit copy.
      void utils.testCases.list.invalidate({ projectId });
      if (mode === "edit") void utils.testCases.byId.invalidate({ id: testCaseId! });
      router.push(`/projects/${projectId}/test-cases/${result.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
        <label>
          Title
          <input
            value={value.title}
            onChange={(e) => setValue((v) => ({ ...v, title: e.target.value }))}
            style={{ width: "100%" }}
          />
        </label>
        <label>
          Background <span style={{ color: "var(--muted-dim)" }}>(optional, shared context)</span>
          <textarea
            value={value.background}
            onChange={(e) => setValue((v) => ({ ...v, background: e.target.value }))}
            rows={2}
            style={{ width: "100%" }}
          />
        </label>
        <div style={{ display: "flex", gap: 16 }}>
          <label>
            Type
            <select value={value.testType} onChange={(e) => setValue((v) => ({ ...v, testType: e.target.value }))}>
              {TEST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select value={value.priority} onChange={(e) => setValue((v) => ({ ...v, priority: e.target.value }))}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Tags <span style={{ color: "var(--muted-dim)" }}>(comma-separated)</span>
          <input
            value={value.tags}
            onChange={(e) => setValue((v) => ({ ...v, tags: e.target.value }))}
            style={{ width: "100%" }}
          />
        </label>
        <label>
          Suite <span style={{ color: "var(--muted-dim)" }}>(optional, e.g. "auth/password-reset" — leave blank to stay unassigned)</span>
          <input
            list="known-suite-paths"
            value={value.suitePath}
            onChange={(e) => setValue((v) => ({ ...v, suitePath: e.target.value }))}
            style={{ width: "100%" }}
          />
          <datalist id="known-suite-paths">
            {knownSuitePaths.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
      </div>

      <h2>Given / When / Then</h2>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Fill this in, or the structured step table below, or both — at least one is required.
      </p>
      <StringListEditor label="Given" items={value.given} onChange={(given) => setValue((v) => ({ ...v, given }))} />
      <StringListEditor label="When" items={value.when} onChange={(when) => setValue((v) => ({ ...v, when }))} />
      <StringListEditor label="Then" items={value.then} onChange={(then) => setValue((v) => ({ ...v, then }))} />

      <h2>Structured steps</h2>
      {sharedGroups.length > 0 && (
        <label style={{ display: "block", marginBottom: 10 }}>
          Use a shared step library <span style={{ color: "var(--muted-dim)" }}>(optional - edited in one place, reused by any case)</span>
          <select
            value={value.sharedStepGroupId}
            onChange={(e) => setValue((v) => ({ ...v, sharedStepGroupId: e.target.value }))}
            style={{ display: "block", width: "100%" }}
          >
            <option value="">None - author steps for this case</option>
            {sharedGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.steps.length} steps)
              </option>
            ))}
          </select>
        </label>
      )}
      {selectedGroup && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, marginBottom: 10, background: "var(--panel-bg, transparent)" }}>
          <p className="text-muted" style={{ fontSize: 12, margin: "0 0 6px" }}>
            Steps come from &ldquo;{selectedGroup.name}&rdquo; - manage the content on the{" "}
            <a href={`/projects/${projectId}/shared-steps`}>Shared step libraries</a> page.
          </p>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {selectedGroup.steps.map((s, i) => (
              <li key={i}>{s.action}</li>
            ))}
          </ol>
        </div>
      )}
      {!value.sharedStepGroupId && value.steps.map((step, i) => (
        <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <strong>Step {i + 1}</strong>
            <button
              type="button"
              onClick={() => setValue((v) => ({ ...v, steps: v.steps.filter((_, j) => j !== i) }))}
            >
              Remove step
            </button>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label>
              {labels.action}
              <input value={step.action} onChange={(e) => updateStep(i, { action: e.target.value })} style={{ width: "100%" }} />
            </label>
            <label>
              {labels.expectedActionOrData}
              <input
                value={step.expectedActionOrData}
                onChange={(e) => updateStep(i, { expectedActionOrData: e.target.value })}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              {labels.expectedResult}
              <input
                value={step.expectedResult}
                onChange={(e) => updateStep(i, { expectedResult: e.target.value })}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              {labels.expectedResponse}
              <input
                value={step.expectedResponse}
                onChange={(e) => updateStep(i, { expectedResponse: e.target.value })}
                style={{ width: "100%" }}
              />
            </label>
          </div>
        </div>
      ))}
      {!value.sharedStepGroupId && (
        <button type="button" onClick={() => setValue((v) => ({ ...v, steps: [...v.steps, { ...EMPTY_STEP }] }))}>
          + Add step
        </button>
      )}

      <div style={{ marginTop: 24 }}>
        <button onClick={submit} disabled={saving || !value.title}>
          {saving ? "Saving…" : mode === "create" ? "Create test case" : "Save changes"}
        </button>
        {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      </div>
    </div>
  );
}
