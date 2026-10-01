"use client";

import { useEffect, useId, useRef, useState } from "react";
import { GAME_PLATFORMS, type ExperienceProfile } from "@vaettir/core";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import type { RunExecutionContext } from "./RunConfigurationModal";
import { Modal } from "./Modal";

type Template = NonNullable<
  RouterOutputs["testPlans"]["executionTemplate"]["template"]
>;
type Baseline = RouterOutputs["testPlans"]["executionTemplate"];
type RunRequest = RouterInputs["manualExecution"]["start"];
type Screen =
  "cases" | "configurations" | "save-review" | "choose-run" | "run-review";
const labels: Record<keyof RunExecutionContext, string> = {
  configuration: "Configuration / variant",
  platform: "Platform / device",
  build: "Build / revision",
  hardwareRevision: "Hardware revision",
  firmwareVersion: "Firmware version",
  rig: "Rig / simulator reference",
  batchOrLot: "Batch / lot / controlled sample",
  environment: "Execution environment",
  calibrationReference: "Instrument / calibration reference",
  protocolReference: "Approved protocol / method reference",
};
const blankContext = (): RunExecutionContext => ({
  configuration: "",
  platform: "",
  build: "",
  hardwareRevision: "",
  firmwareVersion: "",
  rig: "",
  batchOrLot: "",
  environment: "",
  calibrationReference: "",
  protocolReference: "",
});
const emptyTemplate = (): Template => ({
  version: 1,
  testCaseIds: [],
  configurations: [],
});
const copyTemplate = (template: Template | null): Template =>
  template
    ? {
        ...template,
        testCaseIds: [...template.testCaseIds],
        configurations: template.configurations.map((item) => ({
          ...item,
          context: { ...item.context },
        })),
      }
    : emptyTemplate();
function fieldsFor(
  profile: ExperienceProfile | null,
): (keyof RunExecutionContext)[] {
  const offerings = new Set<string>(profile?.offerings);
  const fields: (keyof RunExecutionContext)[] = [
    "configuration",
    "environment",
  ];
  if (
    !profile ||
    ["SOFTWARE", "GAME", "SYSTEM_INTEGRATION"].some((value) =>
      offerings.has(value),
    )
  )
    fields.push("platform", "build");
  if (
    ["HARDWARE", "HIL", "MANUFACTURING"].some((value) => offerings.has(value))
  )
    fields.push(
      "platform",
      "hardwareRevision",
      "firmwareVersion",
      "rig",
      "calibrationReference",
    );
  if (
    ["FOOD_SAFETY", "CLINICAL", "LABORATORY", "MANUFACTURING"].some((value) =>
      offerings.has(value),
    )
  )
    fields.push("batchOrLot", "protocolReference", "calibrationReference");
  return [...new Set(fields)];
}
function ContextSummary({ context }: { context: RunExecutionContext }) {
  return (
    <dl style={{ margin: 0 }}>
      {Object.entries(context)
        .filter(([, value]) => value.trim())
        .map(([key, value]) => (
          <div key={key} style={{ marginBottom: 8, overflowWrap: "anywhere" }}>
            <dt style={{ fontWeight: 600 }}>
              {labels[key as keyof RunExecutionContext]}
            </dt>
            <dd style={{ marginLeft: 0, whiteSpace: "pre-wrap" }}>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

// Kept mounted by the plan drawer: closing does not discard a draft or an
// ambiguous start receipt. A refreshed baseline never silently rebases edits.
export function PlanExecutionModal({
  open,
  onClose,
  id,
  projectId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  id: string;
  projectId: string;
  onSaved?: () => void;
}) {
  const permission = useProjectPermissions(projectId);
  const [serverSearch, setServerSearch] = useState("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [previousCursors, setPreviousCursors] = useState<
    (string | undefined)[]
  >([]);
  const query = trpcReact.testPlans.executionTemplate.useQuery(
    { id, search: serverSearch, cursor },
    { enabled: open },
  );
  const profileQuery = trpcReact.project.experience.useQuery(
    { projectId },
    { enabled: open },
  );
  const saveMutation = trpcReact.testPlans.saveExecutionTemplate.useMutation();
  const startMutation = trpcReact.manualExecution.start.useMutation();
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [profileBaseline, setProfileBaseline] = useState<
    RouterOutputs["project"]["experience"] | null
  >(null);
  const [draft, setDraft] = useState<Template>(emptyTemplate);
  const [screen, setScreen] = useState<Screen>("cases");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState("");
  const [selectedConfiguration, setSelectedConfiguration] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [runAttempt, setRunAttempt] = useState<RunRequest | null>(null);
  const [startedRunId, setStartedRunId] = useState<string | null>(null);
  const [definitiveRejection, setDefinitiveRejection] = useState(false);
  const [everAmbiguous, setEverAmbiguous] = useState(false);
  const [selectedCaseLabels, setSelectedCaseLabels] = useState<
    Record<string, string>
  >({});
  const [refreshCandidate, setRefreshCandidate] = useState<{
    plan: Baseline;
    profile: NonNullable<typeof profileBaseline>;
  } | null>(null);
  const prefix = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  if (baseline === null && query.data) {
    setBaseline(query.data);
    setDraft(copyTemplate(query.data.template));
    setActiveId(query.data.template?.configurations[0]?.id ?? "");
  }
  if (profileBaseline === null && profileQuery.data)
    setProfileBaseline(profileQuery.data);
  useEffect(() => {
    if (open) heading.current?.focus();
  }, [screen, open]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setServerSearch(search.trim());
      setCursor(undefined);
      setPreviousCursors([]);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const active = draft.configurations.find(
    (configuration) => configuration.id === activeId,
  );
  const preset = baseline?.template?.configurations.find(
    (configuration) => configuration.id === selectedConfiguration,
  );
  const tailoredFields = fieldsFor(profileBaseline?.experience ?? null);
  const availableCases = [
    ...new Map(
      [
        ...(baseline?.cases ?? []),
        ...Object.entries(selectedCaseLabels).map(([caseId, title]) => ({
          id: caseId,
          title,
        })),
        ...(query.data?.cases ?? []),
      ].map((item) => [item.id, item]),
    ).values(),
  ];
  const visibleCases = (query.data?.cases ?? baseline?.cases ?? []).filter(
    (item) => item.title.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const invalidCases = draft.testCaseIds.filter(
    (caseId) => !availableCases.some((item) => item.id === caseId),
  );
  const validDraft =
    draft.testCaseIds.length > 0 &&
    draft.testCaseIds.length <= 500 &&
    invalidCases.length === 0 &&
    draft.configurations.length > 0 &&
    draft.configurations.length <= 20 &&
    draft.configurations.every((item) => item.name.trim());
  const dirty = Boolean(
    baseline &&
    JSON.stringify(draft) !== JSON.stringify(copyTemplate(baseline.template)),
  );
  const locked =
    busy ||
    Boolean(runAttempt) ||
    Boolean(startedRunId) ||
    Boolean(refreshCandidate);
  function chooseCases(caseId: string, checked: boolean) {
    setSaved(false);
    setSelectedCaseLabels((current) => {
      const retained = { ...current };
      if (checked) {
        const item = availableCases.find((item) => item.id === caseId);
        if (item) retained[caseId] = item.title;
      } else delete retained[caseId];
      return retained;
    });
    setDraft((current) => ({
      ...current,
      testCaseIds: checked
        ? [...current.testCaseIds, caseId]
        : current.testCaseIds.filter((value) => value !== caseId),
    }));
  }
  function moveCase(index: number, direction: number) {
    setDraft((current) => {
      const ids = [...current.testCaseIds];
      const target = index + direction;
      if (target < 0 || target >= ids.length) return current;
      [ids[index], ids[target]] = [ids[target]!, ids[index]!];
      return { ...current, testCaseIds: ids };
    });
    setSaved(false);
  }
  function editConfiguration(
    change: Partial<Template["configurations"][number]>,
  ) {
    setDraft((current) => ({
      ...current,
      configurations: current.configurations.map((item) =>
        item.id === activeId ? { ...item, ...change } : item,
      ),
    }));
    setSaved(false);
  }
  async function save() {
    if (
      !baseline ||
      !permission.canEdit ||
      !validDraft ||
      locked ||
      screen !== "save-review"
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveMutation.mutateAsync({
        id,
        expectedTemplateHash: baseline.templateHash,
        template: draft,
      });
      setBaseline({
        ...baseline,
        template: result.template,
        templateHash: result.templateHash,
      });
      setDraft(copyTemplate(result.template));
      setSaved(true);
      setScreen("choose-run");
      onSaved?.();
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : "The configuration could not be saved."} Your draft is retained. No automatic retry was sent.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function refresh(rejectedAttempt = false) {
    if (busy || startedRunId || (runAttempt && !rejectedAttempt)) return;
    if (rejectedAttempt && definitiveRejection) {
      setRunAttempt(null);
      setDefinitiveRejection(false);
    }
    setBusy(true);
    setError(null);
    try {
      const [plan, profile] = await Promise.all([
        query.refetch(),
        profileQuery.refetch(),
      ]);
      if (plan.error || profile.error || !plan.data || !profile.data)
        throw new Error(
          "The current plan or project context could not be loaded.",
        );
      setRefreshCandidate({ plan: plan.data, profile: profile.data });
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : "Refresh failed."} Your draft is retained.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (
      !baseline?.template ||
      !profileBaseline ||
      !permission.canEdit ||
      busy ||
      startedRunId ||
      refreshCandidate ||
      screen !== "run-review" ||
      (!runAttempt && (!preset || dirty))
    )
      return;
    const request = runAttempt ?? {
      projectId,
      testCaseIds: [...baseline.template.testCaseIds],
      expectedProfileHash: profileBaseline.profileHash,
      executionContext: { ...preset!.context },
      idempotencyKey: crypto.randomUUID(),
      planReference: {
        testPlanId: id,
        expectedTemplateHash: baseline.templateHash,
        configurationId: preset!.id,
      },
    };
    setRunAttempt(request);
    setBusy(true);
    setError(null);
    try {
      const result = await startMutation.mutateAsync(request);
      setStartedRunId(result.testRunId);
    } catch (cause) {
      const code =
        cause &&
        typeof cause === "object" &&
        "data" in cause &&
        cause.data &&
        typeof cause.data === "object" &&
        "code" in cause.data
          ? cause.data.code
          : null;
      const rejected = [
        "CONFLICT",
        "FORBIDDEN",
        "UNAUTHORIZED",
        "BAD_REQUEST",
        "NOT_FOUND",
        "PRECONDITION_FAILED",
      ].includes(String(code));
      const safelyRejected = rejected && !everAmbiguous;
      if (!rejected) setEverAmbiguous(true);
      setDefinitiveRejection(safelyRejected);
      setError(
        `${cause instanceof Error ? cause.message : "The run response could not be confirmed."} ${safelyRejected ? "The server rejected this reviewed request. Refresh the saved plan and project context, then review again." : "The earlier response may be unconfirmed. Restore access if needed; retry sends the identical reviewed request and receipt, not a second execution."}`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reusable plan executions"
      dismissible={!busy}
    >
      {permission.accessError ? (
        <div>
          <p role="alert">
            Project access could not be checked. No changes were made.
          </p>
          <button className="btn-secondary" onClick={permission.retryAccess}>
            Retry access check
          </button>
        </div>
      ) : !permission.loaded ? (
        <p role="status">Checking project access…</p>
      ) : !permission.canEdit ? (
        <p>
          A full editor seat is required to configure or start a plan execution.
        </p>
      ) : (query.error || profileQuery.error) &&
        (!baseline || !profileBaseline) ? (
        <div>
          <p role="alert">
            Plan configuration or testing context could not be loaded.
          </p>
          <button
            className="btn-secondary"
            onClick={() => {
              void query.refetch();
              void profileQuery.refetch();
            }}
          >
            Try again
          </button>
        </div>
      ) : !baseline || !profileBaseline ? (
        <p role="status">Loading saved configurations…</p>
      ) : (
        <>
          <h3 ref={heading} tabIndex={-1}>
            {
              {
                cases: "Which cases belong in each execution?",
                configurations: "Which configurations will you reuse?",
                "save-review": "Review changes before saving",
                "choose-run": "Which saved configuration will you run?",
                "run-review": "Review this execution record",
              }[screen]
            }
          </h3>
          {!locked && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 16,
              }}
            >
              <button
                className="btn-secondary"
                onClick={() => {
                  setScreen("cases");
                  setError(null);
                }}
              >
                Edit reusable plan
              </button>
              <button
                className="btn-secondary"
                disabled={
                  !baseline.template?.testCaseIds.length ||
                  !baseline.template.configurations.length ||
                  dirty
                }
                onClick={() => {
                  setScreen("choose-run");
                  setError(null);
                }}
              >
                Run a saved configuration
              </button>
            </div>
          )}
          {saved && (
            <p role="status">
              Reusable configuration saved. Previous runs remain unchanged.
            </p>
          )}
          {dirty && screen === "choose-run" && (
            <p role="alert">
              Review and save your changes before starting a run.
            </p>
          )}
          {screen === "cases" && (
            <fieldset
              disabled={locked}
              style={{ border: 0, padding: 0, minWidth: 0 }}
            >
              <legend>
                {draft.testCaseIds.length} cases selected, in execution order
              </legend>
              <label htmlFor={`${prefix}-search`}>Search project cases</label>
              <input
                id={`${prefix}-search`}
                maxLength={200}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                style={{ width: "100%", margin: "6px 0 12px" }}
              />
              <div
                style={{
                  maxHeight: 240,
                  overflowY: "auto",
                  display: "grid",
                  gap: 8,
                }}
              >
                {visibleCases.map((item) => (
                  <label
                    key={item.id}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      overflowWrap: "anywhere",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={draft.testCaseIds.includes(item.id)}
                      disabled={
                        !draft.testCaseIds.includes(item.id) &&
                        draft.testCaseIds.length >= 500
                      }
                      onChange={(event) =>
                        chooseCases(item.id, event.target.checked)
                      }
                    />
                    <span>{item.title}</span>
                  </label>
                ))}
                {!visibleCases.length && (
                  <p className="text-muted">No matching project cases.</p>
                )}
              </div>
              {query.data?.caseLimitReached && (
                <p role="status">
                  Showing a bounded selection of project cases. Search by title
                  to find additional cases; your current selection stays
                  unchanged.
                </p>
              )}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 10,
                }}
              >
                <button
                  className="btn-secondary"
                  disabled={previousCursors.length === 0 || query.isFetching}
                  onClick={() => {
                    setCursor(previousCursors[previousCursors.length - 1]);
                    setPreviousCursors((current) => current.slice(0, -1));
                  }}
                >
                  Previous case page
                </button>
                <button
                  className="btn-secondary"
                  disabled={!query.data?.nextCursor || query.isFetching}
                  onClick={() => {
                    if (query.data?.nextCursor) {
                      setPreviousCursors((current) => [...current, cursor]);
                      setCursor(query.data.nextCursor);
                    }
                  }}
                >
                  Next case page
                </button>
              </div>
              {query.error && (
                <p role="alert">
                  Case search failed. Existing selections are retained. Try
                  searching again before adding cases.
                </p>
              )}
              {invalidCases.length > 0 && (
                <p role="alert">
                  {invalidCases.length} selected cases are unavailable. They
                  were not removed automatically. Remove them explicitly or
                  restore access before saving.
                </p>
              )}
              <details style={{ marginTop: 14 }}>
                <summary>Review and change execution order</summary>
                <ol style={{ paddingLeft: 20 }}>
                  {draft.testCaseIds.map((caseId, index) => (
                    <li
                      key={caseId}
                      style={{ marginTop: 8, overflowWrap: "anywhere" }}
                    >
                      {availableCases.find((item) => item.id === caseId)
                        ?.title ?? `Unavailable case ${caseId}`}
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                          marginTop: 4,
                        }}
                      >
                        <button
                          className="btn-secondary"
                          aria-label={`Move case ${index + 1} up`}
                          disabled={index === 0}
                          onClick={() => moveCase(index, -1)}
                        >
                          Up
                        </button>
                        <button
                          className="btn-secondary"
                          aria-label={`Move case ${index + 1} down`}
                          disabled={index === draft.testCaseIds.length - 1}
                          onClick={() => moveCase(index, 1)}
                        >
                          Down
                        </button>
                        <button
                          className="btn-secondary"
                          aria-label={`Remove case ${index + 1} from plan`}
                          onClick={() => chooseCases(caseId, false)}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
              <p className="text-muted">
                Required prerequisites are included by the server. Up to 500
                cases including prerequisites can be started; imported code is
                never executed.
              </p>
            </fieldset>
          )}
          {screen === "configurations" && (
            <fieldset
              disabled={locked}
              style={{ border: 0, padding: 0, minWidth: 0 }}
            >
              <label htmlFor={`${prefix}-configuration`}>
                Saved configuration to edit
              </label>
              <select
                id={`${prefix}-configuration`}
                value={activeId}
                onChange={(event) => setActiveId(event.target.value)}
                style={{ width: "100%", margin: "6px 0 10px" }}
              >
                <option value="">Choose a configuration</option>
                {draft.configurations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name || "Unnamed configuration"}
                  </option>
                ))}
              </select>
              <button
                className="btn-secondary"
                disabled={draft.configurations.length >= 20}
                onClick={() => {
                  const configId = crypto.randomUUID();
                  setDraft((current) => ({
                    ...current,
                    configurations: [
                      ...current.configurations,
                      { id: configId, name: "", context: blankContext() },
                    ],
                  }));
                  setActiveId(configId);
                  setSaved(false);
                }}
              >
                Add configuration
              </button>
              {active && (
                <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
                  <label>
                    Name
                    <input
                      value={active.name}
                      maxLength={120}
                      onChange={(event) =>
                        editConfiguration({ name: event.target.value })
                      }
                      style={{ width: "100%", display: "block", marginTop: 4 }}
                    />
                  </label>
                  {tailoredFields.map((field) => (
                    <label key={field}>
                      {labels[field]}
                      <input
                        value={active.context[field]}
                        maxLength={
                          field === "configuration" || field === "environment"
                            ? 2000
                            : 300
                        }
                        onChange={(event) =>
                          editConfiguration({
                            context: {
                              ...active.context,
                              [field]: event.target.value,
                            },
                          })
                        }
                        list={
                          field === "platform"
                            ? `${prefix}-platforms`
                            : undefined
                        }
                        style={{
                          width: "100%",
                          display: "block",
                          marginTop: 4,
                        }}
                      />
                    </label>
                  ))}
                  <details>
                    <summary>Other configuration references</summary>
                    {(Object.keys(labels) as (keyof RunExecutionContext)[])
                      .filter((field) => !tailoredFields.includes(field))
                      .map((field) => (
                        <label
                          key={field}
                          style={{ display: "block", marginTop: 10 }}
                        >
                          {labels[field]}
                          <input
                            value={active.context[field]}
                            maxLength={300}
                            onChange={(event) =>
                              editConfiguration({
                                context: {
                                  ...active.context,
                                  [field]: event.target.value,
                                },
                              })
                            }
                            style={{ width: "100%", display: "block" }}
                          />
                        </label>
                      ))}
                  </details>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setDraft((current) => ({
                        ...current,
                        configurations: current.configurations.filter(
                          (item) => item.id !== activeId,
                        ),
                      }));
                      setActiveId("");
                      setSaved(false);
                    }}
                  >
                    Remove this configuration from future runs
                  </button>
                </div>
              )}
              <datalist id={`${prefix}-platforms`}>
                {(profileBaseline.experience?.gamePlatforms ?? []).map(
                  (platform) => (
                    <option
                      key={platform}
                      value={
                        GAME_PLATFORMS.find((choice) => choice.id === platform)
                          ?.label ?? platform
                      }
                    />
                  ),
                )}
              </datalist>
              <p className="text-muted">
                Use controlled references, not patient data, secrets or
                credentials. A method reference does not approve the procedure.
              </p>
            </fieldset>
          )}
          {screen === "save-review" && (
            <>
              <p>
                {draft.testCaseIds.length} ordered cases and{" "}
                {draft.configurations.length} reusable configurations. This
                updates future selections only, never prior execution records.
              </p>
              <ol style={{ paddingLeft: 20 }}>
                {draft.testCaseIds.map((caseId) => (
                  <li key={caseId} style={{ overflowWrap: "anywhere" }}>
                    {availableCases.find((item) => item.id === caseId)?.title ??
                      `Unavailable case ${caseId}`}
                  </li>
                ))}
              </ol>
              {draft.configurations.map((configuration) => (
                <details key={configuration.id} style={{ marginBottom: 10 }}>
                  <summary>
                    {configuration.name || "Unnamed configuration"}
                  </summary>
                  <ContextSummary context={configuration.context} />
                </details>
              ))}
              {!validDraft && (
                <p role="alert">
                  Choose 1–500 available cases and 1–20 named configurations
                  before saving.
                </p>
              )}
            </>
          )}
          {screen === "choose-run" && (
            <fieldset
              disabled={locked}
              style={{ border: 0, padding: 0, minWidth: 0 }}
            >
              <legend>One configuration per execution record</legend>
              {baseline.template?.configurations.map((configuration) => (
                <label
                  key={configuration.id}
                  style={{
                    display: "flex",
                    gap: 8,
                    margin: "12px 0",
                    overflowWrap: "anywhere",
                  }}
                >
                  <input
                    type="radio"
                    name={`${prefix}-run-preset`}
                    checked={selectedConfiguration === configuration.id}
                    onChange={() => setSelectedConfiguration(configuration.id)}
                  />
                  {configuration.name}
                </label>
              ))}
              <p className="text-muted">
                Repeated executions receive separate records. This is manual
                recording, not scheduled automation or equipment activation.
              </p>
            </fieldset>
          )}
          {screen === "run-review" && (
            <>
              <p>
                {baseline.template?.testCaseIds.length} saved cases plus
                required prerequisites, using <strong>{preset?.name}</strong>.
                The saved plan, configuration, project context and case
                definitions are frozen for this record.
              </p>
              {preset && <ContextSummary context={preset.context} />}
              <p className="text-muted">
                No AI credits, source reading, code execution or device control.
                This record does not certify regulatory compliance or platform
                acceptance.
              </p>
              {runAttempt && !startedRunId && (
                <p role="status">
                  The reviewed request is locked until its response is
                  confirmed. Retrying recovers this same record.
                </p>
              )}
              {startedRunId && (
                <>
                  <p role="status">
                    Execution record created.{" "}
                    <a
                      href={`/projects/${projectId}/test-runs/manual/${startedRunId}`}
                    >
                      Open execution record
                    </a>
                  </p>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setRunAttempt(null);
                      setStartedRunId(null);
                      setEverAmbiguous(false);
                      setDefinitiveRejection(false);
                      setError(null);
                      setSelectedConfiguration("");
                      setScreen("choose-run");
                    }}
                  >
                    Configure another separate execution
                  </button>
                </>
              )}
            </>
          )}
          {error && (
            <p role="alert" style={{ color: "var(--ember)" }}>
              {error}
            </p>
          )}
          {refreshCandidate && (
            <div className="panel">
              <p>
                Current saved state is available. Loading it will discard this
                unsaved draft and require another review.
              </p>
              <button
                className="btn-secondary"
                onClick={() => {
                  setBaseline(refreshCandidate.plan);
                  setProfileBaseline(refreshCandidate.profile);
                  setDraft(copyTemplate(refreshCandidate.plan.template));
                  setSelectedCaseLabels({});
                  setActiveId(
                    refreshCandidate.plan.template?.configurations[0]?.id ?? "",
                  );
                  setSelectedConfiguration("");
                  setRefreshCandidate(null);
                  setScreen("cases");
                  setError(null);
                  setSaved(false);
                }}
              >
                Discard draft and load current state
              </button>
              <button
                className="btn-secondary"
                onClick={() => setRefreshCandidate(null)}
              >
                Keep my draft
              </button>
            </div>
          )}
          <footer
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              gap: 8,
              marginTop: 20,
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                className="btn-secondary"
                disabled={
                  locked || screen === "cases" || screen === "choose-run"
                }
                onClick={() =>
                  setScreen(
                    screen === "configurations"
                      ? "cases"
                      : screen === "save-review"
                        ? "configurations"
                        : "choose-run",
                  )
                }
              >
                Back
              </button>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={onClose}
              >
                Close
              </button>
            </div>
            {screen === "cases" && (
              <button
                className="btn-primary"
                disabled={locked || !draft.testCaseIds.length}
                onClick={() => setScreen("configurations")}
              >
                Continue
              </button>
            )}
            {screen === "configurations" && (
              <button
                className="btn-primary"
                disabled={locked || !validDraft}
                onClick={() => setScreen("save-review")}
              >
                Review changes
              </button>
            )}
            {screen === "save-review" && (
              <button
                className="btn-primary"
                disabled={locked || !validDraft}
                onClick={() => void save()}
              >
                {busy ? "Saving…" : "Save reusable configuration"}
              </button>
            )}
            {screen === "choose-run" && (
              <button
                className="btn-primary"
                disabled={locked || !preset || dirty}
                onClick={() => setScreen("run-review")}
              >
                Review execution
              </button>
            )}
            {screen === "run-review" && !startedRunId && (
              <button
                className="btn-primary"
                disabled={
                  busy ||
                  Boolean(refreshCandidate) ||
                  (!runAttempt && (!preset || dirty))
                }
                onClick={() => void start()}
              >
                {busy
                  ? "Starting…"
                  : runAttempt
                    ? "Retry same execution"
                    : "Start execution record"}
              </button>
            )}
          </footer>
          {error && !runAttempt && (
            <button
              className="btn-secondary"
              style={{ marginTop: 12 }}
              disabled={busy}
              onClick={() => void refresh()}
            >
              Check current state without discarding draft
            </button>
          )}
          {error && definitiveRejection && runAttempt && (
            <button
              className="btn-secondary"
              style={{ marginTop: 12 }}
              disabled={busy}
              onClick={() => void refresh(true)}
            >
              Refresh rejected execution and review again
            </button>
          )}
          <p className="text-muted" style={{ fontSize: 12 }}>
            Unsaved changes stay here while this plan remains open. Save before
            leaving the page. Recurring scheduling and qualified regulatory
            approvals are not enabled.
          </p>
        </>
      )}
    </Modal>
  );
}
