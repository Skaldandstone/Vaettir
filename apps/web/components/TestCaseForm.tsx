"use client";

import { type ChangeEvent, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { collectKnownSuitePaths } from "@/components/TestCaseTree";
import { moveListItem } from "@/lib/move-list-item";

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
  editorKey?: string;
  action: string;
  expectedActionOrData: string;
  expectedResult: string;
  expectedResponse: string;
  mediaAttachmentIds: string[];
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
  stepRevision: string;
  sharedStepGroupId: string;
  validationDomain: RouterOutputs["testCases"]["byId"]["validationDomain"];
  verificationProfile: RouterOutputs["testCases"]["byId"]["verificationProfile"];
}

const EMPTY_STEP: StepRow = {
  action: "",
  expectedActionOrData: "",
  expectedResult: "",
  expectedResponse: "",
  mediaAttachmentIds: [],
};

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
    stepRevision: "",
    sharedStepGroupId: "",
    validationDomain: "SOFTWARE",
    verificationProfile: {
      setup: "",
      safety: "",
      instruments: "",
      acceptanceCriteria: "",
    },
  };
}

interface TestCaseFormProps {
  mode: "create" | "edit";
  projectId: string;
  testCaseId?: string;
  initial?: Partial<TestCaseFormValue>;
  stepFieldLabels?: {
    action: string;
    expectedActionOrData: string;
    expectedResult: string;
    expectedResponse: string;
  };
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
  const prefix = useId();
  const nextKey = useRef(items.length);
  const [keys, setKeys] = useState(() => items.map((_, i) => `${prefix}-${i}`));
  const [announcement, setAnnouncement] = useState("");
  function move(from: number, to: number) {
    onChange(moveListItem(items, from, to));
    setKeys(current => moveListItem(current, from, to));
    setAnnouncement(`${label} item ${from + 1} moved to position ${to + 1}.`);
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {items.map((item, i) => (
        <div key={keys[i]} style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
          <input
            aria-label={`${label} item ${i + 1}`}
            value={item}
            onChange={(e) =>
              onChange(items.map((v, j) => (j === i ? e.target.value : v)))
            }
            style={{ flex: "1 1 180px", minWidth: 0 }}
          />
          <button type="button" aria-label={`Move ${label} item ${i + 1} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>Move up</button>
          <button type="button" aria-label={`Move ${label} item ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, i + 1)}>Move down</button>
          <button
            type="button"
            aria-label={`Remove ${label} item ${i + 1}`}
            onClick={() => { onChange(items.filter((_, j) => j !== i)); setKeys(current => current.filter((_, j) => j !== i)); }}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => { const key = `${prefix}-${nextKey.current++}`; onChange([...items, ""]); setKeys(current => [...current, key]); }}>
        + Add {label} item
      </button>
      <span role="status" className="sr-only">{announcement}</span>
    </div>
  );
}

export default function TestCaseForm({
  mode,
  projectId,
  testCaseId,
  initial,
  stepFieldLabels,
}: TestCaseFormProps) {
  const router = useRouter();
  const stepKeyPrefix = useId();
  const nextStepKey = useRef(initial?.steps?.length ?? 0);
  const [stepAnnouncement, setStepAnnouncement] = useState("");
  const [value, setValue] = useState<TestCaseFormValue>(() => ({
    ...defaultValue(),
    ...initial,
    steps: (initial?.steps ?? []).map((step, i) => ({ ...step, mediaAttachmentIds: step.mediaAttachmentIds ?? [], editorKey: `${stepKeyPrefix}-${i}` })),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // P1-15: both reads share the cache with the test-cases list page and the
  // shared-steps page, so opening the form right after either is free.
  const utils = trpcReact.useUtils();
  const casesQuery = trpcReact.testCases.list.useQuery({ projectId });
  const knownSuitePaths = useMemo(
    () => (casesQuery.data ? collectKnownSuitePaths(casesQuery.data) : []),
    [casesQuery.data],
  );
  const sharedGroupsQuery = trpcReact.sharedStepGroups.list.useQuery({
    projectId,
  });
  const sharedGroups = sharedGroupsQuery.data ?? [];
  const createMutation = trpcReact.testCases.create.useMutation();
  const updateMutation = trpcReact.testCases.update.useMutation();
  const attachmentsQuery = trpcReact.testCaseAttachments.list.useQuery(
    { testCaseId: testCaseId ?? "" },
    { enabled: mode === "edit" && Boolean(testCaseId) },
  );
  const requestMediaUpload = trpcReact.testCaseAttachments.requestUpload.useMutation();
  const deleteAttachment = trpcReact.testCaseAttachments.delete.useMutation();
  const [uploadingStepKey, setUploadingStepKey] = useState<string | null>(null);
  const imageVideoAttachments = (attachmentsQuery.data ?? []).filter(a => /^(image|video)\//i.test(a.contentType));

  const selectedGroup = sharedGroups.find(
    (g) => g.id === value.sharedStepGroupId,
  );

  const labels = stepFieldLabels ?? {
    action: "Test Step",
    expectedActionOrData: "Expected Action / Data",
    expectedResult: "Expected Result",
    expectedResponse: "Expected Response",
  };

  function updateStep(i: number, patch: Partial<StepRow>) {
    setValue((v) => ({
      ...v,
      steps: v.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    }));
  }

  async function uploadStepMedia(editorKey: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !testCaseId) return;
    if (!/^(image|video)\//i.test(file.type)) {
      setError("Choose an image or video file for this step.");
      return;
    }
    setUploadingStepKey(editorKey);
    setError(null);
    let attachmentId: string | null = null;
    try {
      const upload = await requestMediaUpload.mutateAsync({ testCaseId, fileName: file.name, contentType: file.type, sizeBytes: file.size });
      attachmentId = upload.attachmentId;
      const response = await fetch(upload.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
      if (!response.ok) throw new Error(`Media upload failed (${response.status}).`);
      setValue(current => ({ ...current, steps: current.steps.map(step => step.editorKey === editorKey
        ? { ...step, mediaAttachmentIds: [...step.mediaAttachmentIds, upload.attachmentId] }
        : step) }));
      await utils.testCaseAttachments.list.invalidate({ testCaseId });
    } catch (cause) {
      if (attachmentId) await deleteAttachment.mutateAsync({ attachmentId }).catch(() => undefined);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploadingStepKey(null);
    }
  }

  async function viewStepMedia(attachmentId: string) {
    try {
      const { viewUrl } = await utils.testCaseAttachments.getViewUrl.fetch({ attachmentId });
      window.open(viewUrl, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
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
                mediaAttachmentIds: s.mediaAttachmentIds,
              })),
        sharedStepGroupId: value.sharedStepGroupId || null,
        tags: value.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        testType: value.testType,
        validationDomain: value.validationDomain,
        verificationProfile: value.verificationProfile,
        priority: value.priority as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
        suitePath: value.suitePath || undefined,
      };

      const result =
        mode === "create"
          ? await createMutation.mutateAsync({ ...payload, projectId })
          : await updateMutation.mutateAsync({ ...payload, id: testCaseId!, expectedSuitePath: initial?.suitePath || null,
              expectedPriority: initial?.priority as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | undefined,
              expectedStepRevision: initial?.stepRevision || undefined });

      // The detail page + list read from the cache; make sure they see the
      // saved row rather than the pre-edit copy.
      void utils.testCases.list.invalidate({ projectId });
      if (mode === "edit")
        void utils.testCases.byId.invalidate({ id: testCaseId! });
      router.push(`/projects/${projectId}/test-cases/${result.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, minWidth: 0, overflowWrap: "anywhere" }}>
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
          Background{" "}
          <span style={{ color: "var(--muted-dim)" }}>
            (optional, shared context)
          </span>
          <textarea
            value={value.background}
            onChange={(e) =>
              setValue((v) => ({ ...v, background: e.target.value }))
            }
            rows={2}
            style={{ width: "100%" }}
          />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <label>
            Validation domain
            <select
              value={value.validationDomain}
              onChange={(e) =>
                setValue((v) => ({
                  ...v,
                  validationDomain: e.target
                    .value as TestCaseFormValue["validationDomain"],
                }))
              }
            >
              {[
                "SOFTWARE",
                "HARDWARE",
                "SYSTEM_INTEGRATION",
                "HIL",
                "MANUFACTURING",
                "MEDICAL_DEVICE",
                "PHARMA_LAB",
                "OTHER",
              ].map((domain) => (
                <option key={domain} value={domain}>
                  {domain.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select
              value={value.testType}
              onChange={(e) =>
                setValue((v) => ({ ...v, testType: e.target.value }))
              }
            >
              {TEST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              value={value.priority}
              onChange={(e) =>
                setValue((v) => ({ ...v, priority: e.target.value }))
              }
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <details open={value.validationDomain !== "SOFTWARE"}>
          <summary>Fixture, safety and measurement criteria</summary>
          <p>
            Document approved procedures and acceptance limits. Attach diagrams
            or visual setup references to the saved case. This does not certify
            a regulated process.
          </p>
          {(
            [
              ["setup", "System under test and fixture setup"],
              ["safety", "Safety prerequisites and stop conditions"],
              [
                "instruments",
                "Instruments, calibration and sampling requirements",
              ],
              [
                "acceptanceCriteria",
                "Measurements, units, limits and pass criteria",
              ],
            ] as const
          ).map(([key, label]) => (
            <label key={key} style={{ display: "block", marginBottom: 10 }}>
              {label}
              <textarea
                style={{ width: "100%" }}
                rows={3}
                value={value.verificationProfile[key]}
                onChange={(e) =>
                  setValue((v) => ({
                    ...v,
                    verificationProfile: {
                      ...v.verificationProfile,
                      [key]: e.target.value,
                    },
                  }))
                }
              />
            </label>
          ))}
        </details>
        <label>
          Tags{" "}
          <span style={{ color: "var(--muted-dim)" }}>(comma-separated)</span>
          <input
            value={value.tags}
            onChange={(e) => setValue((v) => ({ ...v, tags: e.target.value }))}
            style={{ width: "100%" }}
          />
        </label>
        <label>
          Suite{" "}
          <span style={{ color: "var(--muted-dim)" }}>
            (optional, e.g. &ldquo;auth/password-reset&rdquo; — leave blank to stay
            unassigned)
          </span>
          <input
            list="known-suite-paths"
            value={value.suitePath}
            onChange={(e) =>
              setValue((v) => ({ ...v, suitePath: e.target.value }))
            }
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
        Fill this in, or the structured step table below, or both — at least one
        is required.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
        <StringListEditor label="Given" items={value.given} onChange={(given) => setValue((v) => ({ ...v, given }))} />
        <StringListEditor label="When" items={value.when} onChange={(when) => setValue((v) => ({ ...v, when }))} />
        <StringListEditor label="Then" items={value.then} onChange={(then) => setValue((v) => ({ ...v, then }))} />
      </div>

      <h2>Structured steps</h2>
      {sharedGroups.length > 0 && (
        <label style={{ display: "block", marginBottom: 10 }}>
          Use a shared step library{" "}
          <span style={{ color: "var(--muted-dim)" }}>
            (optional - edited in one place, reused by any case)
          </span>
          <select
            value={value.sharedStepGroupId}
            onChange={(e) =>
              setValue((v) => ({ ...v, sharedStepGroupId: e.target.value }))
            }
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
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: 10,
            marginBottom: 10,
            background: "var(--panel-bg, transparent)",
          }}
        >
          <p className="text-muted" style={{ fontSize: 12, margin: "0 0 6px" }}>
            Steps come from &ldquo;{selectedGroup.name}&rdquo; - manage the
            content on the{" "}
            <a href={`/projects/${projectId}/shared-steps`}>
              Shared step libraries
            </a>{" "}
            page.
          </p>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {selectedGroup.steps.map((s, i) => (
              <li key={i}>{s.action}</li>
            ))}
          </ol>
        </div>
      )}
      {!value.sharedStepGroupId && <div role="list" aria-label="Ordered test steps">
        {value.steps.map((step, i) => (
          <div
            key={step.editorKey}
            role="listitem"
            style={{
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: 12,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <strong>Step {i + 1}</strong>
              <button type="button" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => { setValue(v => ({ ...v, steps: moveListItem(v.steps, i, i - 1) })); setStepAnnouncement(`Step ${i + 1} moved to position ${i}.`); }}>Move up</button>
              <button type="button" aria-label={`Move step ${i + 1} down`} disabled={i === value.steps.length - 1} onClick={() => { setValue(v => ({ ...v, steps: moveListItem(v.steps, i, i + 1) })); setStepAnnouncement(`Step ${i + 1} moved to position ${i + 2}.`); }}>Move down</button>
              <button
                type="button"
                aria-label={`Remove step ${i + 1}`}
                onClick={() =>
                  setValue((v) => ({
                    ...v,
                    steps: v.steps.filter((_, j) => j !== i),
                  }))
                }
              >
                Remove step
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 8, alignItems: "start" }}>
              <label>
                {labels.action}
                <input
                  value={step.action}
                  onChange={(e) => updateStep(i, { action: e.target.value })}
                  style={{ width: "100%" }}
                />
              </label>
              <label>
                {labels.expectedActionOrData}
                <input
                  value={step.expectedActionOrData}
                  onChange={(e) =>
                    updateStep(i, { expectedActionOrData: e.target.value })
                  }
                  style={{ width: "100%" }}
                />
              </label>
              <label>
                {labels.expectedResult}
                <input
                  value={step.expectedResult}
                  onChange={(e) =>
                    updateStep(i, { expectedResult: e.target.value })
                  }
                  style={{ width: "100%" }}
                />
              </label>
              <label>
                {labels.expectedResponse}
                <input
                  value={step.expectedResponse}
                  onChange={(e) =>
                    updateStep(i, { expectedResponse: e.target.value })
                  }
                  style={{ width: "100%" }}
                />
              </label>
            </div>
            <details open={step.mediaAttachmentIds.length > 0} style={{ marginTop: 10 }}>
              <summary>Step images and video ({step.mediaAttachmentIds.length})</summary>
              {mode === "create" || !testCaseId ? (
                <p className="text-muted" style={{ fontSize: 12 }}>Save the case first, then return to attach media to individual steps.</p>
              ) : (
                <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>Choose case files or upload a short clip/image (25 MB max). References are saved with this step.</p>
                  <div style={{ maxHeight: 150, overflowY: "auto", display: "grid", gap: 4 }}>
                    {imageVideoAttachments.map(attachment => (
                      <div key={attachment.id} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", minWidth: 0 }}>
                        <label style={{ flex: "1 1 150px", minWidth: 0, overflowWrap: "anywhere" }}>
                          <input type="checkbox" checked={step.mediaAttachmentIds.includes(attachment.id)} onChange={event => updateStep(i, {
                            mediaAttachmentIds: event.target.checked
                              ? [...step.mediaAttachmentIds, attachment.id]
                              : step.mediaAttachmentIds.filter(id => id !== attachment.id),
                          })} />{" "}{attachment.fileName} <span className="text-muted">({attachment.contentType.startsWith("video/") ? "video" : "image"})</span>
                        </label>
                        <button type="button" style={{ flexShrink: 0 }} onClick={() => void viewStepMedia(attachment.id)}>View</button>
                      </div>
                    ))}
                    {imageVideoAttachments.length === 0 && <span className="text-muted" style={{ fontSize: 12 }}>No image or video files on this case yet.</span>}
                    {step.mediaAttachmentIds.filter(id => !imageVideoAttachments.some(a => a.id === id)).map(id => (
                      <div key={id} role="alert" style={{ color: "var(--ember)", fontSize: 12 }}>
                        A previously linked file is unavailable. <button type="button" onClick={() => updateStep(i, { mediaAttachmentIds: step.mediaAttachmentIds.filter(value => value !== id) })}>Remove reference</button>
                      </div>
                    ))}
                  </div>
                  <label style={{ fontSize: 12 }}>Upload image or video for this step
                    <input type="file" accept="image/*,video/*" style={{ display: "block", width: "100%", minWidth: 0 }} disabled={uploadingStepKey !== null} onChange={event => void uploadStepMedia(step.editorKey!, event)} />
                  </label>
                  {uploadingStepKey === step.editorKey && <span role="status">Uploading media…</span>}
                </div>
              )}
            </details>
          </div>
        ))}</div>}
      {!value.sharedStepGroupId && (
        <button
          type="button"
          onClick={() => {
            const editorKey = `${stepKeyPrefix}-${nextStepKey.current++}`;
            setValue((v) => ({ ...v, steps: [...v.steps, { ...EMPTY_STEP, editorKey }] }));
          }}
        >
          + Add step
        </button>
      )}
      <span role="status" className="sr-only">{stepAnnouncement}</span>

      <div style={{ marginTop: 24 }}>
        <button onClick={submit} disabled={saving || !value.title}>
          {saving
            ? "Saving…"
            : mode === "create"
              ? "Create test case"
              : "Save changes"}
        </button>
        {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      </div>
    </div>
  );
}
