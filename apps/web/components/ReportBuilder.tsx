"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { DialogFrame } from "./ui/DialogFrame";
import { ReadableSelect } from "./ui/ReadableSelect";
import { FrozenReport } from "./FrozenReport";
import { ReportSnapshotCatalog } from "./ReportSnapshotCatalog";
import { ReportDefinitionManager } from "./ReportDefinitionManager";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";
import { canEditProject } from "@/lib/membership";
import { REPORT_SECTIONS, readableMetric } from "@/lib/frozen-report";
import {
  REPORT_TEMPLATES,
  REPORT_TEMPLATE_IDS,
  applyReportTemplate,
  type ReportTemplateId,
} from "@/lib/report-templates";

type Definition = RouterInputs["reportSnapshots"]["preview"]["definition"];
type PreviewRequest = RouterInputs["reportSnapshots"]["preview"];
type Preview = RouterOutputs["reportSnapshots"]["preview"];
type DraftStart = { actor: string; organizationId: string } & (
  | { kind: "fresh" }
  | { kind: "definition"; source: RouterOutputs["reportSnapshots"]["definitions"][number] }
  | { kind: "preview"; source: RouterOutputs["reportSnapshots"]["drafts"][number] }
);
const freshDefinition = (): Definition => ({
  audience: "stakeholders",
  templateId: "quality-status",
  windowDays: 30,
  sections: [...REPORT_TEMPLATES["quality-status"].sections],
  summary: "",
  risks: "",
  nextActions: "",
});
export function ReportBuilder({ projectId }: { projectId: string }) {
  return <ProjectReportBuilder key={projectId} projectId={projectId} />;
}
function ProjectReportBuilder({ projectId }: { projectId: string }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [originalActor, setOriginalActor] = useState<string | null>(null);
  const actorReady = isLoaded && isSignedIn && !!userId;
  if (!originalActor && actorReady && userId) setOriginalActor(userId);
  const actorMatches = actorReady && originalActor === userId;
  const [workflowOrigin, setWorkflowOrigin] = useState<{ actor: string; organizationId: string } | null>(null);
  const utils = trpcReact.useUtils();
  const project = trpcReact.project.byId.useQuery({ id: projectId }, { enabled: actorMatches, retry: false, staleTime: 0 });
  const organizations = trpcReact.organization.mine.useQuery(undefined, { enabled: actorMatches, retry: false, staleTime: 0 });
  const workflowMatches = !workflowOrigin || (workflowOrigin.actor === userId && workflowOrigin.organizationId === project.data?.organizationId);
  const readOnly =
    !actorMatches || !workflowMatches || project.data?.id !== projectId ||
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
  }, { enabled: !readOnly, retry: false, staleTime: 0 });
  const drafts = trpcReact.reportSnapshots.drafts.useQuery({ projectId }, { enabled: !readOnly, retry: false, staleTime: 0 });
  const availableDefinitions =
    !readOnly && !definitions.error && !definitions.isFetching && !definitions.isPaused
      ? definitions.data
      : undefined;
  const availableDrafts =
    !readOnly && !drafts.error && !drafts.isFetching && !drafts.isPaused
      ? drafts.data
      : undefined;
  const [open, setOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState<"empty" | "draft" | "published">("empty");
  const [replacement, setReplacement] = useState<DraftStart | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const scopeOptions = trpcReact.reportSnapshots.scopeOptions.useQuery(
    { projectId },
    { enabled: open && !readOnly, staleTime: 0 },
  );
  const scopeChoices =
    open &&
    !readOnly &&
    project.data?.id === projectId &&
    scopeOptions.data?.projectId === projectId &&
    scopeOptions.data.organizationId === project.data.organizationId &&
    !scopeOptions.error &&
    !scopeOptions.isFetching &&
    !scopeOptions.isPaused
      ? scopeOptions.data
      : undefined;
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("Quality status review");
  const [definition, setDefinition] = useState<Definition>(freshDefinition);
  const [request, setRequest] = useState<PreviewRequest | null>(null);
  const [review, setReview] = useState<
    (Preview & { reviewOrgId: string; reviewActorId: string }) | null
  >(null);
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
    { enabled: open && !!resumeId && !readOnly, staleTime: 0, retry: false },
  );
  const liveScope = useRef({ actor: userId, organizationId: project.data?.organizationId, ready: !readOnly });
  useLayoutEffect(() => {
    liveScope.current = { actor: userId, organizationId: project.data?.organizationId, ready: !readOnly };
    return () => { liveScope.current = { ...liveScope.current, ready: false }; };
  }, [userId, project.data?.organizationId, readOnly]);
  const busy = preview.isPending || approve.isPending || save.isPending;
  const current = !readOnly
    ? ((review && review.reviewOrgId === project.data?.organizationId && review.reviewActorId === userId ? review : null) ??
      (open &&
      !resume.error &&
      !resume.isFetching &&
      !resume.isPaused &&
      resume.data?.id === resumeId &&
      resume.data.projectId === projectId &&
      resume.data.organizationId === project.data?.organizationId &&
      resume.data.payload.state === "preview"
        ? resume.data
        : null))
    : null;
  // Retain exact pending/reviewed context when permission or connection fails;
  // hiding a cached payload must not unlock or silently replace its request.
  const frozen = !!request || !!review || !!resumeId || !!saveRequest;
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
    key:
      "planId" | "runId" | "platform" | "environment" | "build" | "releaseId",
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
    if (readOnly || !userId || !project.data) return;
    if (!workflowOrigin) setWorkflowOrigin({ actor: userId, organizationId: project.data.organizationId });
    if (request || saveRequest) {
      setOpen(true);
      return;
    }
    if (draftStatus === "draft") {
      setOpen(true);
      return;
    }
    // Only an empty or acknowledged completed flow starts fresh. Closing an
    // unfinished local draft never resets its authored fields or current step.
    applyStart({ kind: "fresh", actor: userId, organizationId: project.data.organizationId });
  }
  function closeBuilder() {
    setOpen(false);
    setReplacement(null);
  }
  function keepCurrentReport() {
    if (!replacement || readOnly || busy || request || saveRequest || !userId || !project.data ||
      replacement.actor !== userId || replacement.organizationId !== project.data.organizationId) return;
    // Focus the persistent visible control before removing the focused review.
    closeButton.current?.focus();
    setReplacement(null);
  }
  function applyStart(target: DraftStart) {
    if (readOnly || busy || request || saveRequest || !userId || !project.data ||
      target.actor !== userId || target.organizationId !== project.data.organizationId) return;
    if (target.kind === "definition" && !availableDefinitions?.some(row => row === target.source)) return;
    if (target.kind === "preview" && !availableDrafts?.some(row => row === target.source)) return;
    closeButton.current?.focus();
    if (!workflowOrigin) setWorkflowOrigin({ actor: target.actor, organizationId: target.organizationId });
    setStep(0);
    setReview(null);
    setResumeId("");
    setMessage("");
    setDefinition(freshDefinition());
    setTitle("Quality status review");
    if (target.kind === "definition") {
      setTitle(target.source.name);
      setDefinition(target.source.definition);
    } else if (target.kind === "preview") {
      setResumeId(target.source.id);
      setStep(4);
    }
    setReplacement(null);
    setDraftStatus("draft");
    setOpen(true);
  }
  function requestStart(target: DraftStart) {
    if (readOnly || busy || request || saveRequest || !userId || !project.data ||
      target.actor !== userId || target.organizationId !== project.data.organizationId) return;
    if (draftStatus === "draft") {
      // Choosing another definition/preview does not consent to discarding
      // authored local commentary, scope or the current screen.
      setReplacement(target);
      setOpen(true);
      return;
    }
    applyStart(target);
  }
  const replacementReady = !!replacement && !readOnly && !busy && !request && !saveRequest &&
    replacement.actor === userId && replacement.organizationId === project.data?.organizationId &&
    (replacement.kind === "fresh" || (replacement.kind === "definition"
      ? !!availableDefinitions?.some(row => row === replacement.source)
      : !!availableDrafts?.some(row => row === replacement.source)));
  async function capture() {
    if (readOnly || busy || saveRequest) return;
    const originalOrganizationId = project.data?.organizationId;
    if (!originalOrganizationId || !userId || !actorMatches || !workflowMatches) return;
    const originalActorId = userId;
    if (!workflowOrigin) setWorkflowOrigin({ actor: originalActorId, organizationId: originalOrganizationId });
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
      setReview({ ...result, reviewOrgId: originalOrganizationId, reviewActorId: originalActorId });
      setStep(4);
      if (!liveScope.current.ready || liveScope.current.actor !== originalActorId || liveScope.current.organizationId !== originalOrganizationId) return;
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
    if (!current || readOnly || !userId || !actorMatches || !workflowMatches || current.payload.state !== "preview") return;
    const originalActorId = userId;
    const originalOrganizationId = "reviewOrgId" in current
      ? current.reviewOrgId
      : current.organizationId;
    setMessage("");
    try {
      const result = await approve.mutateAsync({
        projectId,
        previewId: current.id,
        approveSharing: true,
      });
      if (!liveScope.current.ready || liveScope.current.actor !== originalActorId || liveScope.current.organizationId !== originalOrganizationId) {
        setMessage("Sharing acknowledgement belongs to the original account and workspace. The original preview remains retained for exact recovery.");
        return;
      }
      setRequest(null);
      setResumeId("");
      setDraftStatus("published");
      setReplacement(null);
      setMessage(
        "Report shared. Workspace members can view the saved report using its link.",
      );
      setOpen(false);
      // Keep the original reviewed tenant binding, not a newly fetched tenant
      // that may have changed while this approval was in flight.
      setReview({ ...result, reviewOrgId: originalOrganizationId, reviewActorId: originalActorId });
      try { await utils.reportSnapshots.catalog.invalidate(); } catch { setMessage("Report sharing was confirmed. The report list could not refresh; no repeat approval is needed."); }
    } catch {
      setMessage(
        "Sharing was not confirmed. Your exact preview is retained; retry approval after access is restored.",
      );
    }
  }
  async function saveDefinition() {
    if (readOnly || busy || request || current || !userId || !project.data || !actorMatches || !workflowMatches) return;
    const originalActorId = userId, originalOrganizationId = project.data.organizationId;
    if (!workflowOrigin) setWorkflowOrigin({ actor: originalActorId, organizationId: originalOrganizationId });
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
      if (!liveScope.current.ready || liveScope.current.actor !== originalActorId || liveScope.current.organizationId !== originalOrganizationId) return;
      setSaveRequest(null);
      setMessage(
        "Report settings saved. Choose them below to reuse this setup.",
      );
      try { await definitions.refetch(); } catch { setMessage("Report settings were saved. Refresh failed; no repeat save is needed."); }
    } catch {
      setMessage(
        "Saving was not confirmed. Refresh saved settings before saving another copy.",
      );
    }
  }
  return (
    <>
      {(!actorMatches || !workflowMatches) && (
        <section className="panel" role="status">
          Report drafts and exact pending requests are retained but hidden.
          Return to the original signed-in account and workspace to recover
          them; no request is rebound to another account.
        </section>
      )}
      <div hidden={!actorMatches || !workflowMatches}>
        <section
          className="panel report-start"
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
              <h2 style={{ marginTop: 0 }}>Reports to share</h2>
              <p className="text-muted">
                Choose a report, review the results, then share it with your
                project. Saved reports keep the data you reviewed, even when the
                project changes.
              </p>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={readOnly}
              onClick={begin}
            >
              {request || saveRequest
                ? "Resume pending report"
                : draftStatus === "draft"
                  ? "Resume local report draft"
                  : "Create report"}
            </button>
          </div>
          {readOnly && (
            <p className="text-muted">
              A full editor seat is required to create and share reports.
              Existing reports remain viewable.
            </p>
          )}
          {draftStatus === "draft" && (
            <div>
              <p className="text-muted">
                Your unfinished report stays in this page. Closing preserves its
                title, notes, sections, test selection and current step.
                Reloading or leaving the project may lose an unsubmitted local
                draft.
              </p>
              <button
                type="button"
                className="btn-secondary"
                disabled={readOnly || busy || !!request || !!saveRequest}
                onClick={() => {
                  if (readOnly || !userId || !project.data) return;
                  requestStart({
                    kind: "fresh",
                    actor: userId,
                    organizationId: project.data.organizationId,
                  });
                }}
              >
                Start another report
              </button>
            </div>
          )}
          <button
            type="button"
            className="btn-secondary"
            disabled={
              !actorMatches ||
              busy ||
              project.isFetching ||
              organizations.isFetching
            }
            onClick={() => {
              if (!actorMatches) return;
              void Promise.all([
                project.refetch(),
                organizations.refetch(),
                definitions.refetch(),
                utils.reportSnapshots.catalog.invalidate(),
                drafts.refetch(),
                ...(resumeId ? [resume.refetch()] : []),
              ]);
            }}
          >
            Refresh report access
          </button>
          <label style={{ display: "grid", gap: 6, maxWidth: 420 }}>
            Saved report settings
            <ReadableSelect
              value=""
              disabled={
                readOnly || !availableDefinitions || !!request || !!saveRequest
              }
              onChange={(event) => {
                if (readOnly || !userId || !project.data) return;
                const saved = availableDefinitions?.find(
                  (row) => row.id === event.target.value,
                );
                if (!saved) return;
                requestStart({
                  kind: "definition",
                  source: saved,
                  actor: userId,
                  organizationId: project.data.organizationId,
                });
              }}
            >
              <option value="">Choose a reusable report</option>
              {availableDefinitions?.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.visibility === "project" ? "Project · " : "Private · "}
                  {row.name}
                </option>
              ))}
            </ReadableSelect>
          </label>
          {availableDrafts && availableDrafts.length > 0 && !readOnly && (
            <details style={{ marginTop: 12 }}>
              <summary>
                Resume a saved preview (latest {availableDrafts.length})
              </summary>
              <ul>
                {availableDrafts.map((row) => (
                  <li key={row.id}>
                    <button
                      className="btn-secondary"
                      type="button"
                      disabled={!!request || !!saveRequest}
                      onClick={() => {
                        if (readOnly || !userId || !project.data) return;
                        requestStart({
                          kind: "preview",
                          source: row,
                          actor: userId,
                          organizationId: project.data.organizationId,
                        });
                      }}
                    >
                      Review {row.title} ·{" "}
                      {new Date(row.asOf).toLocaleDateString()}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <ReportSnapshotCatalog projectId={projectId} />
          <ReportDefinitionManager projectId={projectId} />
          {(definitions.error || drafts.error) && (
            <p role="alert">
              Reports could not be refreshed. Existing drafts are retained;
              retry after access is restored.
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <DialogFrame
            open={open && !readOnly}
            onClose={closeBuilder}
            dismissible={!busy}
            className="modal-panel report-builder-dialog"
            label="Create a report"
            style={{
              width: "min(1040px, calc(100vw - 32px))",
              maxWidth: "calc(100vw - 32px)",
            }}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Project reports</p>
                <h2 style={{ margin: 0 }}>Create a report</h2>
              </div>
              <button
                ref={closeButton}
                className="btn-secondary modal-close"
                aria-label="Close report builder"
                disabled={busy}
                onClick={closeBuilder}
              >
                ✕
              </button>
            </div>
            {replacement && (
              <section aria-label="Review replacement of unfinished report">
                <h3>Replace the unfinished report?</h3>
                <p>
                  Your current local title, notes, metrics, scope and step will
                  be discarded only if you confirm. Saved previews and shared
                  snapshots are not deleted. This does not submit or share a
                  report.
                </p>
                <p>
                  Next:{" "}
                  {replacement.kind === "fresh"
                    ? "A fresh report"
                    : replacement.kind === "definition"
                      ? replacement.source.name
                      : replacement.source.title}
                </p>
                {!replacementReady && (
                  <p role="status">
                    Current access and the exact selected definition or preview
                    must be verified. Your unfinished report remains unchanged.
                  </p>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={keepCurrentReport}
                  >
                    Keep current report
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!replacementReady}
                    onClick={() => {
                      if (replacementReady) applyStart(replacement);
                    }}
                  >
                    Discard local draft and continue
                  </button>
                </div>
              </section>
            )}
            <div className="report-builder-content" hidden={!!replacement}>
              <ol className="report-builder-steps" aria-label="Report steps">
                {["Report type", "Audience", "Content", "Notes", "Review"].map(
                  (name, index) => (
                    <li
                      key={name}
                      aria-current={index === step ? "step" : undefined}
                      data-complete={index < step}
                    >
                      <span className="report-step-number" aria-hidden="true">
                        {index + 1}
                      </span>
                      <span>{name}</span>
                    </li>
                  ),
                )}
              </ol>
              <div className="report-step-heading">
                <p className="eyebrow">Step {step + 1} of 5</p>
                <h3>
                  {
                    [
                      "What do you want to review?",
                      "Who will read this report?",
                      "What should it include?",
                      "Add the context your readers need",
                      "Review before sharing",
                    ][step]
                  }
                </h3>
                <p className="text-muted">
                  {
                    [
                      "Start with a suggested report or choose your own sections.",
                      "Give the report a name and choose its audience.",
                      "Choose the dates, tests and sections. Only recorded Vaettir data is used.",
                      "Add your summary, risks and next steps. These notes are optional.",
                      "Check the saved preview. Sharing it requires your approval.",
                    ][step]
                  }
                </p>
              </div>
              {step === 0 && (
                <div style={{ display: "grid", gap: 14 }}>
                  <fieldset className="report-type-options" disabled={frozen}>
                    <legend className="sr-only">Report type</legend>
                    {([...REPORT_TEMPLATE_IDS, "custom"] as const).map(
                      (id) => (
                        <label
                          key={id}
                          className="report-type-option"
                          data-selected={
                            (definition.templateId ?? "custom") === id
                          }
                        >
                          <input
                            type="radio"
                            name={`report-type-${projectId}`}
                            value={id}
                            data-dialog-initial-focus={
                              (definition.templateId ?? "custom") === id ? true : undefined
                            }
                            checked={(definition.templateId ?? "custom") === id}
                            onChange={() => {
                              if (id === "custom") {
                                setDefinition({
                                  ...definition,
                                  templateId: undefined,
                                });
                                return;
                              }
                              const applied = applyReportTemplate(
                                definition,
                                title,
                                id as ReportTemplateId,
                              );
                              setDefinition(applied.definition);
                              setTitle(applied.title);
                            }}
                          />
                          <span>
                            <strong>
                              {id === "custom"
                                ? "Custom report"
                                : REPORT_TEMPLATES[id].title}
                            </strong>
                            <small>
                              {id === "custom"
                                ? "Choose your own sections, dates and test selection."
                                : REPORT_TEMPLATES[id].description}
                            </small>
                          </span>
                        </label>
                      ),
                    )}
                  </fieldset>
                  <p className="text-muted">
                    Suggested reports choose sections for you. Your notes, dates
                    and test selection stay unchanged. You can adjust the
                    sections next; nothing is shared until you approve it.
                  </p>
                </div>
              )}
              {step === 1 && (
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
                    <ReadableSelect
                      disabled={frozen}
                      value={definition.audience}
                      onChange={(event) => {
                        const audience = event.target
                          .value as Definition["audience"];
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
                    </ReadableSelect>
                  </label>
                  <p className="text-muted">
                    All project tests are included by default. Choose a plan,
                    release or run next to narrow the report. The case-query
                    filters on the page behind this builder do not apply here.
                  </p>
                </div>
              )}
              {step === 2 && (
                <div>
                  <label>
                    Execution window
                    <ReadableSelect
                      disabled={frozen}
                      value={
                        definition.dateInterval
                          ? "custom"
                          : definition.windowDays
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
                    </ReadableSelect>
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
                          Choose both dates, with start on or before end, no
                          future dates and no more than 366 calendar days.
                        </p>
                      )}
                    </div>
                  )}
                  <details style={{ marginBlock: 16 }}>
                    <summary>Choose specific tests or runs (optional)</summary>
                    <p className="text-muted">
                      Filters combine with AND. Unrecorded platform/environment
                      labels do not match. Inventory uses current active cases
                      planned or linked in matching runs, plus the selected
                      plan&apos;s saved case selection.
                    </p>
                    <div style={{ display: "grid", gap: 12 }}>
                      <label>
                        Release (current linked plans)
                        <ReadableSelect
                          disabled={frozen || !scopeChoices}
                          value={definition.executionScope?.releaseId ?? ""}
                          onChange={(event) =>
                            setScope("releaseId", event.target.value)
                          }
                        >
                          <option value="">
                            All releases / no release filter
                          </option>
                          {definition.executionScope?.releaseId &&
                            !scopeChoices?.releases.some(
                              (release) =>
                                release.id ===
                                definition.executionScope?.releaseId,
                            ) && (
                              <option
                                value={definition.executionScope.releaseId}
                              >
                                Stored release ·{" "}
                                {definition.executionScope.releaseId}
                              </option>
                            )}
                          {scopeChoices?.releases.map((release) => (
                            <option key={release.id} value={release.id}>
                              {release.name}
                              {release.nameExcerpt ? "… (excerpt)" : ""}
                            </option>
                          ))}
                        </ReadableSelect>
                      </label>
                      <p className="text-muted">
                        The report saves the tests currently linked to this
                        release, including tests without results. This does not
                        prove older runs belonged to this release. All selected
                        filters must match.
                      </p>
                      {scopeChoices?.releasesLimited && (
                        <p>
                          Showing the first 100 release suggestions. A stored
                          release outside this list is retained and checked at
                          capture.
                        </p>
                      )}
                      <label>
                        Plan
                        <ReadableSelect
                          disabled={
                            frozen ||
                            scopeOptions.isFetching ||
                            scopeOptions.isPaused ||
                            !!scopeOptions.error
                          }
                          value={definition.executionScope?.planId ?? ""}
                          onChange={(event) =>
                            setScope("planId", event.target.value)
                          }
                        >
                          <option value="">All plans</option>
                          {definition.executionScope?.planId &&
                            !scopeChoices?.plans.some(
                              (plan) =>
                                plan.id === definition.executionScope?.planId,
                            ) && (
                              <option value={definition.executionScope.planId}>
                                Stored plan · {definition.executionScope.planId}
                              </option>
                            )}
                          {scopeChoices?.plans.map((plan) => (
                            <option key={plan.id} value={plan.id}>
                              {plan.name}
                              {plan.nameExcerpt ? "… (excerpt)" : ""}
                            </option>
                          ))}
                        </ReadableSelect>
                      </label>
                      <label>
                        Recorded run
                        <ReadableSelect
                          disabled={
                            frozen ||
                            scopeOptions.isFetching ||
                            scopeOptions.isPaused ||
                            !!scopeOptions.error
                          }
                          value={definition.executionScope?.runId ?? ""}
                          onChange={(event) =>
                            setScope("runId", event.target.value)
                          }
                        >
                          <option value="">All matching runs</option>
                          {definition.executionScope?.runId &&
                            !scopeChoices?.runs.some(
                              (run) =>
                                run.id === definition.executionScope?.runId,
                            ) && (
                              <option value={definition.executionScope.runId}>
                                {definition.executionScope.runId}
                              </option>
                            )}
                          {scopeChoices?.runs.map((run) => (
                            <option key={run.id} value={run.id}>
                              {new Date(run.startedAt).toLocaleDateString()} ·{" "}
                              {run.ciProvider}
                              {run.providerExcerpt ? "… (excerpt)" : ""} ·{" "}
                              {run.id}
                            </option>
                          ))}
                        </ReadableSelect>
                      </label>
                      {(["platform", "environment", "build"] as const).map(
                        (key) => (
                          <label key={key}>
                            {readableMetric(key)} (exact recorded value)
                            <input
                              disabled={frozen}
                              maxLength={key === "environment" ? 2000 : 300}
                              list={`report-${projectId}-${key}`}
                              value={definition.executionScope?.[key] ?? ""}
                              onChange={(event) =>
                                setScope(key, event.target.value)
                              }
                            />
                            <datalist id={`report-${projectId}-${key}`}>
                              {[
                                ...new Set(
                                  scopeChoices?.runs
                                    .map((run) => run[key])
                                    .filter(
                                      (value): value is string => !!value,
                                    ) ?? [],
                                ),
                              ].map((value) => (
                                <option key={value} value={value} />
                              ))}
                            </datalist>
                          </label>
                        ),
                      )}
                      <details>
                        <summary>Exact plan / older run identity</summary>
                        <p className="text-muted">
                          Choices show at most 100 plans and latest 100 runs.
                          You can use an existing project identity not shown
                          here; the server verifies it belongs to this project.
                        </p>
                        {(["planId", "runId"] as const).map((key) => (
                          <label key={key}>
                            {key === "planId"
                              ? "Exact plan ID"
                              : "Exact run ID"}
                            <input
                              disabled={frozen}
                              maxLength={200}
                              value={definition.executionScope?.[key] ?? ""}
                              onChange={(event) =>
                                setScope(key, event.target.value)
                              }
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
                          Retry test and run choices
                        </button>
                      </p>
                    )}
                    {scopeOptions.isPaused && (
                      <p role="status">
                        Waiting for a connection to refresh test and run
                        choices. Existing exact selections stay unchanged.
                      </p>
                    )}
                    <p className="text-muted">
                      When you select specific tests, defect counts need
                      matching imported evidence. Requirements include only
                      those linked to the selected tests. Your preview stays
                      private until you approve sharing.
                    </p>
                  </details>
                  <fieldset disabled={frozen}>
                    <legend>Sections to include</legend>
                    {REPORT_SECTIONS.map((section) => (
                      <label key={section} className="report-section-option">
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
                        <span>
                          <strong>
                            {
                              {
                                inventory: "Test inventory",
                                execution: "Test results",
                                traceability: "Requirements coverage",
                                defects: "Defects",
                                automation: "Automation",
                              }[section]
                            }
                          </strong>
                          <small>
                            {
                              {
                                inventory: "Test counts and priorities",
                                execution:
                                  "Recorded outcomes and planned progress",
                                traceability: "Requirements linked to tests",
                                defects: "Recorded defect evidence",
                                automation:
                                  "Automation labels and recorded changes",
                              }[section]
                            }
                          </small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <p className="text-muted">
                    Creating this report uses 0 AI credits. No source or
                    external provider data is fetched.
                  </p>
                </div>
              )}
              {step === 3 && (
                <div className="report-commentary-layout">
                  <div className="report-commentary">
                    {definition.templateId && (
                      <details className="report-review-prompts">
                        <summary>Questions to help write this review</summary>
                        <ul>
                          {REPORT_TEMPLATES[
                            definition.templateId
                          ].reviewPrompts.map((prompt) => (
                            <li key={prompt}>{prompt}</li>
                          ))}
                        </ul>
                        <p className="text-muted">
                          Use recorded evidence; these prompts are not findings.
                        </p>
                      </details>
                    )}
                    {(["summary", "risks", "nextActions"] as const).map(
                      (key) => (
                        <label key={key} htmlFor={`report-${projectId}-note-${key}`}>
                          <span id={`report-${projectId}-note-label-${key}`}>{
                            {
                              summary: "Summary (optional)",
                              risks: "Risks and blockers (optional)",
                              nextActions: "Next actions (optional)",
                            }[key]
                          }</span>
                          <textarea
                            id={`report-${projectId}-note-${key}`}
                            aria-labelledby={`report-${projectId}-note-label-${key}`}
                            disabled={frozen}
                            rows={3}
                            maxLength={1500}
                            value={definition[key]}
                            onChange={(event) =>
                              setDefinition({
                                ...definition,
                                [key]: event.target.value,
                              })
                            }
                          />
                        </label>
                      ),
                    )}
                    <p className="text-muted">
                      Keep secrets and personal information out of stakeholder
                      notes. Saving a private preview stores the report for
                      review. Sharing requires your approval on the next step.
                    </p>
                  </div>
                  <aside
                    className="report-notes-preview"
                    aria-label="Draft commentary preview"
                  >
                    <span className="eyebrow">
                      Notes preview · Not saved yet
                    </span>
                    <h2>{title || "Stakeholder report"}</h2>
                    {(["summary", "risks", "nextActions"] as const).map(
                      (key) => (
                        <section key={key}>
                          <h3>
                            {
                              {
                                summary: "Summary",
                                risks: "Risks and blockers",
                                nextActions: "Next actions",
                              }[key]
                            }
                          </h3>
                          <p
                            className={
                              definition[key] ? undefined : "text-muted"
                            }
                          >
                            {definition[key] || "No notes yet."}
                          </p>
                        </section>
                      ),
                    )}
                    <p className="text-muted">
                      The next step saves the selected data for your review.
                      Nothing is shared yet.
                    </p>
                  </aside>
                </div>
              )}
              {step === 4 &&
                (current ? (
                  <FrozenReport report={current.payload} />
                ) : (
                  <p role={resume.error ? "alert" : "status"}>
                    {readOnly
                      ? "Preview context is retained but hidden until current editor access is verified."
                      : resume.error
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
                    disabled={
                      busy || project.isFetching || organizations.isFetching
                    }
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
              <div className="wizard-footer">
                <button
                  className="btn-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    step > 0 && !frozen ? setStep(step - 1) : closeBuilder()
                  }
                >
                  {step > 0 && !frozen ? "Back" : "Close and resume later"}
                </button>
                {(!frozen || saveRequest) && (
                  <button
                    className="btn-secondary"
                    disabled={
                      busy || readOnly || !title.trim() || invalidInterval
                    }
                    type="button"
                    onClick={() => void saveDefinition()}
                  >
                    {saveRequest ? "Retry same settings save" : "Save settings"}
                  </button>
                )}
                {step < 3 && (
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
                {step === 3 && (
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
                    {request ? "Retry same preview" : "Save private preview"}
                  </button>
                )}
                {step === 4 && (
                  <button
                    className="btn-primary"
                    type="button"
                    disabled={busy || readOnly || !current}
                    onClick={() => void publish()}
                  >
                    Approve and share report
                  </button>
                )}
              </div>
            </div>
          </DialogFrame>
        </section>
      </div>
    </>
  );
}
