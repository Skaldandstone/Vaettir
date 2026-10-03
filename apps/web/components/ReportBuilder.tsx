"use client";
import { useState } from "react";
import Link from "next/link";
import { DialogFrame } from "./ui/DialogFrame";
import { FrozenReport } from "./FrozenReport";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";
import { canEditProject } from "@/lib/membership";
import { REPORT_SECTIONS, readableMetric } from "@/lib/frozen-report";

type Definition = RouterInputs["reportSnapshots"]["preview"]["definition"];
type PreviewRequest = RouterInputs["reportSnapshots"]["preview"];
type Preview = RouterOutputs["reportSnapshots"]["preview"];
const freshDefinition = (): Definition => ({
  audience: "stakeholders",
  windowDays: 30,
  sections: ["inventory", "execution", "traceability", "defects", "automation"],
  summary: "",
  risks: "",
  nextActions: "",
});
export function ReportBuilder({ projectId }: { projectId: string }) {
  return <ProjectReportBuilder key={projectId} projectId={projectId} />;
}
function ProjectReportBuilder({ projectId }: { projectId: string }) {
  const project = trpcReact.project.byId.useQuery({ id: projectId });
  const organizations = trpcReact.organization.mine.useQuery();
  const readOnly =
    project.isFetching ||
    organizations.isFetching ||
    project.isPaused ||
    organizations.isPaused ||
    !!project.error ||
    !!organizations.error ||
    !canEditProject(
      organizations.data?.find(
        (row) => row.id === project.data?.organizationId,
      ),
    );
  const definitions = trpcReact.reportSnapshots.definitions.useQuery({
    projectId,
  });
  const snapshots = trpcReact.reportSnapshots.list.useQuery({ projectId });
  const drafts = trpcReact.reportSnapshots.drafts.useQuery({ projectId });
  const [open, setOpen] = useState(false);
  const scopeOptions = trpcReact.reportSnapshots.scopeOptions.useQuery(
    { projectId },
    { enabled: open, staleTime: 0 },
  );
  const scopeChoices =
    open &&
    !scopeOptions.error &&
    !scopeOptions.isFetching &&
    !scopeOptions.isPaused
      ? scopeOptions.data
      : undefined;
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("Quality status review");
  const [definition, setDefinition] = useState<Definition>(freshDefinition);
  const [request, setRequest] = useState<PreviewRequest | null>(null);
  const [review, setReview] = useState<Preview | null>(null);
  const [saveRequest, setSaveRequest] = useState<
    RouterInputs["reportSnapshots"]["saveDefinition"] | null
  >(null);
  const [resumeId, setResumeId] = useState("");
  const [message, setMessage] = useState("");
  const preview = trpcReact.reportSnapshots.preview.useMutation();
  const approve = trpcReact.reportSnapshots.approve.useMutation();
  const save = trpcReact.reportSnapshots.saveDefinition.useMutation();
  const resume = trpcReact.reportSnapshots.get.useQuery(
    { projectId, id: resumeId },
    { enabled: open && !!resumeId, staleTime: 0 },
  );
  const busy = preview.isPending || approve.isPending || save.isPending;
  const current =
    review ??
    (open &&
    !resume.error &&
    !resume.isFetching &&
    !resume.isPaused &&
    resume.data?.id === resumeId &&
    resume.data.payload.state === "preview"
      ? resume.data
      : null);
  const frozen = !!request || !!current || !!saveRequest;
  const invalidInterval =
    !!definition.dateInterval &&
    (!definition.dateInterval.start ||
      !definition.dateInterval.end ||
      definition.dateInterval.start > definition.dateInterval.end ||
      definition.dateInterval.end > new Date().toISOString().slice(0, 10) ||
      Date.parse(definition.dateInterval.end) -
        Date.parse(definition.dateInterval.start) >=
        366 * 86400000);
  function setScope(
    key: "planId" | "runId" | "platform" | "environment" | "build",
    value: string,
  ) {
    const scope = { ...definition.executionScope };
    if (value.trim()) scope[key] = value;
    else delete scope[key];
    setDefinition({
      ...definition,
      executionScope: Object.keys(scope).length ? scope : undefined,
    });
  }
  function begin() {
    if (request || saveRequest) {
      setOpen(true);
      return;
    }
    setStep(0);
    setReview(null);
    setResumeId("");
    setMessage("");
    setDefinition(freshDefinition());
    setTitle("Quality status review");
    setOpen(true);
  }
  async function capture() {
    if (readOnly || busy || saveRequest) return;
    const input = request ?? {
      projectId,
      title: title.trim(),
      definition,
      requestId: crypto.randomUUID(),
    };
    setRequest(input);
    setMessage("");
    try {
      const result = await preview.mutateAsync(input);
      setReview(result);
      setStep(3);
      await drafts.refetch();
    } catch (error) {
      const code = (error as { data?: { code?: string } }).data?.code;
      if (
        !request &&
        (code === "BAD_REQUEST" ||
          code === "NOT_FOUND" ||
          code === "PRECONDITION_FAILED")
      ) {
        setRequest(null);
        setMessage(
          "The server rejected these report settings before capture. Review the dates and existing project scope, then try again.",
        );
        return;
      }
      setMessage(
        "Preview response unavailable. Retry uses the same request and scope. Do not start a different capture until this is recovered.",
      );
    }
  }
  async function publish() {
    if (!current || readOnly) return;
    setMessage("");
    try {
      const result = await approve.mutateAsync({
        projectId,
        previewId: current.id,
        approveSharing: true,
      });
      await snapshots.refetch();
      setRequest(null);
      setResumeId("");
      setMessage(
        "Frozen snapshot created. Workspace members can view it using its link.",
      );
      setOpen(false);
      setReview(result);
    } catch {
      setMessage(
        "Sharing was not confirmed. Your exact preview is retained; retry approval after access is restored.",
      );
    }
  }
  async function saveDefinition() {
    if (readOnly || busy || request || current) return;
    setMessage("");
    const input = saveRequest ?? {
      projectId,
      requestId: crypto.randomUUID(),
      name: title.trim(),
      definition,
    };
    setSaveRequest(input);
    try {
      await save.mutateAsync(input);
      await definitions.refetch();
      setSaveRequest(null);
      setMessage(
        "Report definition saved. Choose it below to resume or reuse these settings.",
      );
    } catch {
      setMessage(
        "Saving was not confirmed. Refresh saved definitions before saving another copy.",
      );
    }
  }
  return (
    <section
      className="panel"
      aria-label="Report generation"
      style={{ marginBottom: 20 }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ marginTop: 0 }}>Stakeholder reports</h2>
          <p className="text-muted">
            Build, review and freeze a report. Saved snapshots stay unchanged as
            the project evolves.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={readOnly}
          onClick={begin}
        >
          {request || saveRequest ? "Resume pending report" : "Create report"}
        </button>
      </div>
      {readOnly && (
        <p className="text-muted">
          A full editor seat is required to create and share snapshots. Existing
          reports remain viewable.
        </p>
      )}
      <button
        type="button"
        className="btn-secondary"
        disabled={busy || project.isFetching || organizations.isFetching}
        onClick={() =>
          void Promise.all([
            project.refetch(),
            organizations.refetch(),
            definitions.refetch(),
            snapshots.refetch(),
            drafts.refetch(),
            ...(resumeId ? [resume.refetch()] : []),
          ])
        }
      >
        Refresh report access
      </button>
      <label style={{ display: "grid", gap: 6, maxWidth: 420 }}>
        Saved report definition
        <select
          value=""
          disabled={
            readOnly || definitions.isLoading || !!request || !!saveRequest
          }
          onChange={(event) => {
            const saved = definitions.data?.find(
              (row) => row.id === event.target.value,
            );
            if (!saved) return;
            begin();
            setTitle(saved.name);
            setDefinition(saved.definition);
          }}
        >
          <option value="">Choose a reusable report</option>
          {definitions.data?.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </label>
      {drafts.data && drafts.data.length > 0 && !readOnly && (
        <details style={{ marginTop: 12 }}>
          <summary>Resume a saved preview ({drafts.data.length})</summary>
          <ul>
            {drafts.data.map((row) => (
              <li key={row.id}>
                <button
                  className="btn-secondary"
                  type="button"
                  disabled={!!request || !!saveRequest}
                  onClick={() => {
                    setReview(null);
                    setResumeId(row.id);
                    setStep(3);
                    setMessage("");
                    setOpen(true);
                  }}
                >
                  Review {row.title} · {new Date(row.asOf).toLocaleDateString()}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {snapshots.data && snapshots.data.length > 0 ? (
        <div className="table-scroll" style={{ marginTop: 16 }}>
          <table className="workspace-table">
            <thead>
              <tr>
                <th scope="col">Frozen snapshot</th>
                <th scope="col">Captured</th>
                <th scope="col">Review</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.data.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.title}</th>
                  <td>{new Date(row.asOf).toLocaleString()}</td>
                  <td>
                    <Link
                      href={`/projects/${encodeURIComponent(projectId)}/reports/snapshots/${row.id}`}
                    >
                      Open report
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted">No approved snapshots yet.</p>
      )}
      {(snapshots.error || definitions.error || drafts.error) && (
        <p role="alert">
          Reports could not be refreshed. Existing drafts are retained; retry
          after access is restored.
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <DialogFrame
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!busy}
        className="modal-panel"
        label="Create stakeholder report"
        style={{
          width: "min(900px, calc(100vw - 32px))",
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        <div className="modal-header">
          <h2 style={{ margin: 0 }}>Create stakeholder report</h2>
          <button
            className="btn-secondary modal-close"
            aria-label="Close report builder"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>
        <p className="eyebrow">
          Step {step + 1} of 4 ·{" "}
          {["Audience", "Metrics", "Commentary", "Review"][step]}
        </p>
        {step === 0 && (
          <div style={{ display: "grid", gap: 14 }}>
            <label>
              Report title
              <input
                data-dialog-initial-focus
                value={title}
                disabled={frozen}
                maxLength={80}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              Who is this for?
              <select
                disabled={frozen}
                value={definition.audience}
                onChange={(event) => {
                  const audience = event.target.value as Definition["audience"];
                  setDefinition({
                    ...definition,
                    audience,
                    sections:
                      audience === "engineering"
                        ? ["execution", "defects", "automation"]
                        : audience === "stakeholders"
                          ? ["inventory", "execution", "defects"]
                          : [...REPORT_SECTIONS],
                  });
                }}
              >
                <option value="stakeholders">Stakeholders</option>
                <option value="engineering">Engineering</option>
                <option value="quality">Quality team</option>
              </select>
            </label>
            <p className="text-muted">
              Project-wide scope by default. Choose report scope next. This
              builder does not apply the case-query filters on the page behind
              it. Audience presets suggest sections; you can adjust them next.
            </p>
          </div>
        )}
        {step === 1 && (
          <div>
            <label>
              Execution window
              <select
                disabled={frozen}
                value={
                  definition.dateInterval ? "custom" : definition.windowDays
                }
                onChange={(event) => {
                  if (event.target.value === "custom") {
                    setDefinition({
                      ...definition,
                      dateInterval: { start: "", end: "" },
                    });
                    return;
                  }
                  setDefinition({
                    ...definition,
                    dateInterval: undefined,
                    windowDays: Number(
                      event.target.value,
                    ) as Definition["windowDays"],
                  });
                }}
              >
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="custom">Custom UTC dates</option>
              </select>
            </label>
            {definition.dateInterval && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  marginBlock: 12,
                }}
              >
                {(["start", "end"] as const).map((key) => (
                  <label key={key}>
                    {key === "start"
                      ? "Start date (UTC)"
                      : "End date (UTC, inclusive)"}
                    <input
                      type="date"
                      max={new Date().toISOString().slice(0, 10)}
                      disabled={frozen}
                      value={definition.dateInterval![key]}
                      onChange={(event) =>
                        setDefinition({
                          ...definition,
                          dateInterval: {
                            ...definition.dateInterval!,
                            [key]: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                ))}
                {invalidInterval && (
                  <p role="status">
                    Choose both dates, with start on or before end, no future
                    dates and no more than 366 calendar days.
                  </p>
                )}
              </div>
            )}
            <details style={{ marginBlock: 16 }}>
              <summary>Limit to recorded execution scope (optional)</summary>
              <p className="text-muted">
                Filters combine with AND. Unrecorded platform/environment labels
                do not match. Inventory uses current active cases planned or
                linked in matching runs, plus the selected plan&apos;s saved
                case selection.
              </p>
              <div style={{ display: "grid", gap: 12 }}>
                <label>
                  Plan
                  <select
                    disabled={
                      frozen ||
                      scopeOptions.isFetching ||
                      scopeOptions.isPaused ||
                      !!scopeOptions.error
                    }
                    value={definition.executionScope?.planId ?? ""}
                    onChange={(event) => setScope("planId", event.target.value)}
                  >
                    <option value="">All plans</option>
                    {definition.executionScope?.planId &&
                      !scopeChoices?.plans.some(
                        (plan) => plan.id === definition.executionScope?.planId,
                      ) && (
                        <option value={definition.executionScope.planId}>
                          Stored plan · {definition.executionScope.planId}
                        </option>
                      )}
                    {scopeChoices?.plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Recorded run
                  <select
                    disabled={
                      frozen ||
                      scopeOptions.isFetching ||
                      scopeOptions.isPaused ||
                      !!scopeOptions.error
                    }
                    value={definition.executionScope?.runId ?? ""}
                    onChange={(event) => setScope("runId", event.target.value)}
                  >
                    <option value="">All matching runs</option>
                    {definition.executionScope?.runId &&
                      !scopeChoices?.runs.some(
                        (run) => run.id === definition.executionScope?.runId,
                      ) && (
                        <option value={definition.executionScope.runId}>
                          {definition.executionScope.runId}
                        </option>
                      )}
                    {scopeChoices?.runs.map((run) => (
                      <option key={run.id} value={run.id}>
                        {new Date(run.startedAt).toLocaleDateString()} ·{" "}
                        {run.ciProvider} · {run.id}
                      </option>
                    ))}
                  </select>
                </label>
                {(["platform", "environment", "build"] as const).map((key) => (
                  <label key={key}>
                    {readableMetric(key)} (exact recorded value)
                    <input
                      disabled={frozen}
                      maxLength={key === "environment" ? 2000 : 300}
                      list={`report-${projectId}-${key}`}
                      value={definition.executionScope?.[key] ?? ""}
                      onChange={(event) => setScope(key, event.target.value)}
                    />
                    <datalist id={`report-${projectId}-${key}`}>
                      {[
                        ...new Set(
                          scopeChoices?.runs
                            .map((run) => run[key])
                            .filter((value): value is string => !!value) ?? [],
                        ),
                      ].map((value) => (
                        <option key={value} value={value} />
                      ))}
                    </datalist>
                  </label>
                ))}
                <details>
                  <summary>Exact plan / older run identity</summary>
                  <p className="text-muted">
                    Choices show at most 100 plans and latest 100 runs. You can
                    use an existing project identity not shown here; the server
                    verifies it belongs to this project.
                  </p>
                  {(["planId", "runId"] as const).map((key) => (
                    <label key={key}>
                      {key === "planId" ? "Exact plan ID" : "Exact run ID"}
                      <input
                        disabled={frozen}
                        maxLength={200}
                        value={definition.executionScope?.[key] ?? ""}
                        onChange={(event) => setScope(key, event.target.value)}
                      />
                    </label>
                  ))}
                </details>
              </div>
              {scopeOptions.error && (
                <p role="alert">
                  Recorded choices could not load.{" "}
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void scopeOptions.refetch()}
                  >
                    Retry scope choices
                  </button>
                </p>
              )}
              {scopeOptions.isPaused && (
                <p role="status">
                  Waiting for a connection to refresh recorded scope choices.
                  Existing exact selections stay unchanged.
                </p>
              )}
              <p className="text-muted">
                Scoped defect counts are excluded without matching imported
                evidence. Scoped requirements include only explicit links to the
                selected case cohort, not all project requirements. Capture is
                private until approval.
              </p>
            </details>
            <fieldset disabled={frozen}>
              <legend>Include metrics</legend>
              {REPORT_SECTIONS.map((section) => (
                <label
                  key={section}
                  style={{ display: "flex", gap: 8, marginBlock: 10 }}
                >
                  <input
                    type="checkbox"
                    checked={definition.sections.includes(section)}
                    onChange={(event) =>
                      setDefinition({
                        ...definition,
                        sections: event.target.checked
                          ? [...definition.sections, section]
                          : definition.sections.filter(
                              (value) => value !== section,
                            ),
                      })
                    }
                  />
                  {readableMetric(section)}
                </label>
              ))}
            </fieldset>
            <p className="text-muted">
              Capture costs 0 AI credits. No source or external provider data is
              fetched.
            </p>
          </div>
        )}
        {step === 2 && (
          <div style={{ display: "grid", gap: 12 }}>
            {(["summary", "risks", "nextActions"] as const).map((key) => (
              <label key={key}>
                {
                  {
                    summary: "Summary (optional)",
                    risks: "Risks and impediments (optional)",
                    nextActions: "Next actions (optional)",
                  }[key]
                }
                <textarea
                  disabled={frozen}
                  rows={3}
                  maxLength={1500}
                  value={definition[key]}
                  onChange={(event) =>
                    setDefinition({ ...definition, [key]: event.target.value })
                  }
                />
              </label>
            ))}
            <p className="text-muted">
              Keep secrets and personal information out of stakeholder notes.
              Preview saves a private, resumable capture; sharing needs the next
              approval.
            </p>
          </div>
        )}
        {step === 3 &&
          (current ? (
            <FrozenReport report={current.payload} />
          ) : (
            <p role={resume.error ? "alert" : "status"}>
              {resume.error
                ? "Saved preview could not be loaded. Restore access and try again."
                : resume.isPaused
                  ? "Waiting for a connection to verify this saved preview. Approval is unavailable."
                  : "Loading saved preview…"}
            </p>
          ))}
        {message && <p role="status">{message}</p>}
        {(project.error || organizations.error || readOnly) && (
          <div role="status">
            <p>
              Creation and approval are locked until full editor access is
              verified. Pending requests stay unchanged.
            </p>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || project.isFetching || organizations.isFetching}
              onClick={() =>
                void Promise.all([
                  project.refetch(),
                  organizations.refetch(),
                  ...(resumeId ? [resume.refetch()] : []),
                ])
              }
            >
              Retry workspace access
            </button>
          </div>
        )}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            justifyContent: "space-between",
            marginTop: 20,
          }}
        >
          <button
            className="btn-secondary"
            type="button"
            disabled={busy}
            onClick={() =>
              step > 0 && !frozen ? setStep(step - 1) : setOpen(false)
            }
          >
            {step > 0 && !frozen ? "Back" : "Close / resume later"}
          </button>
          {(!frozen || saveRequest) && (
            <button
              className="btn-secondary"
              disabled={busy || readOnly || !title.trim() || invalidInterval}
              type="button"
              onClick={() => void saveDefinition()}
            >
              {saveRequest ? "Retry same definition save" : "Save definition"}
            </button>
          )}
          {step < 2 && (
            <button
              className="btn-primary"
              type="button"
              disabled={
                busy ||
                frozen ||
                !title.trim() ||
                !definition.sections.length ||
                invalidInterval
              }
              onClick={() => setStep(step + 1)}
            >
              Continue
            </button>
          )}
          {step === 2 && (
            <button
              className="btn-primary"
              type="button"
              disabled={
                busy ||
                readOnly ||
                !!saveRequest ||
                !title.trim() ||
                !definition.sections.length ||
                invalidInterval
              }
              onClick={() => void capture()}
            >
              {request ? "Retry same preview" : "Capture private preview"}
            </button>
          )}
          {step === 3 && (
            <button
              className="btn-primary"
              type="button"
              disabled={busy || readOnly || !current}
              onClick={() => void publish()}
            >
              Approve frozen sharing snapshot
            </button>
          )}
        </div>
      </DialogFrame>
    </section>
  );
}
