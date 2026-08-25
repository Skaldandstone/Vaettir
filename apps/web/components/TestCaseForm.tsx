"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
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
  const [knownSuitePaths, setKnownSuitePaths] = useState<string[]>([]);

  useEffect(() => {
    trpc.testCases.list.query({ projectId }).then((cases) => setKnownSuitePaths(collectKnownSuitePaths(cases)));
  }, [projectId]);

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
        steps: value.steps
          .filter((s) => s.action.trim())
          .map((s) => ({
            action: s.action,
            expectedActionOrData: s.expectedActionOrData || null,
            expectedResult: s.expectedResult || null,
            expectedResponse: s.expectedResponse || null,
          })),
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
          ? await trpc.testCases.create.mutate({ ...payload, projectId })
          : await trpc.testCases.update.mutate({ ...payload, id: testCaseId! });

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
      {value.steps.map((step, i) => (
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
      <button type="button" onClick={() => setValue((v) => ({ ...v, steps: [...v.steps, { ...EMPTY_STEP }] }))}>
        + Add step
      </button>

      <div style={{ marginTop: 24 }}>
        <button onClick={submit} disabled={saving || !value.title}>
          {saving ? "Saving…" : mode === "create" ? "Create test case" : "Save changes"}
        </button>
        {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      </div>
    </div>
  );
}
