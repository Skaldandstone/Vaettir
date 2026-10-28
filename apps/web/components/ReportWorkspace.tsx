"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { trpcReact, type RouterInputs } from "@/lib/trpcReact";
import {
  dashboardConfigSchema,
  reportScheduleConfigSchema,
} from "@vaettir/api/src/services/reportWorkflowSchema";
import { ReportDefinitionSettingsEditor } from "./ReportDefinitionSettingsEditor";
import { QualityVisualReport } from "./QualityVisualReport";
import styles from "./ReportWorkspace.module.css";

type Dashboard = RouterInputs["reportWorkflows"]["saveDashboard"];
type Schedule = RouterInputs["reportWorkflows"]["saveSchedule"];
type Config = Dashboard["config"];
const definition: Config["definition"] = {
  audience: "stakeholders",
  templateId: "quality-status",
  windowDays: 30,
  sections: ["inventory", "execution", "traceability", "defects", "automation"],
  summary: "",
  risks: "",
  nextActions: "",
};
const starter: Config = {
  definition,
  columns: 2,
  widgets: [
    { id: "outcomes", display: "donut" },
    { id: "coverage", display: "bars" },
    { id: "priority", display: "bars" },
    { id: "automation", display: "donut" },
  ],
};
const widgetNames = {
  outcomes: "Recorded outcomes",
  coverage: "Execution coverage",
  "plan-progress": "Planned checks",
  priority: "Case priority",
  automation: "Automation",
  requirements: "Requirements coverage",
  "custom-1": "Custom metric 1",
  "custom-2": "Custom metric 2",
  "custom-3": "Custom metric 3",
  "custom-4": "Custom metric 4",
};

/** Parent retains the original actor/workspace binding and hides this editor
 * during access revalidation. Mutation retries retain their exact request. */
export function ReportWorkspace({
  projectId,
  organizationId,
  clerkActorId,
  ready,
  editable,
}: {
  projectId: string;
  organizationId: string;
  clerkActorId: string;
  ready: boolean;
  editable: boolean;
}) {
  const [tab, setTab] = useState<"dashboards" | "schedules">("dashboards");
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("Quality overview"),
    [config, setConfig] = useState<Config>(starter);
  const [selected, setSelected] = useState({ id: "", version: 0, owned: true });
  const [visibility, setVisibility] =
    useState<Dashboard["visibility"]>("private");
  const [schedule, setSchedule] = useState<
    Omit<Schedule["config"], "definition">
  >({
    cadence: "weekly",
    timeZone: "UTC",
    hour: 9,
    minute: 0,
    weekday: 1,
    monthDay: 1,
  });
  const [enabled, setEnabled] = useState(false),
    [screen, setScreen] = useState(0);
  const [message, setMessage] = useState(""),
    [pending, setPending] = useState<
      | { kind: "dashboard"; request: Dashboard }
      | { kind: "schedule"; request: Schedule }
      | null
    >(null);
  const scope = useRef({ ready, projectId, organizationId, clerkActorId });
  useLayoutEffect(() => {
    const value = { ready, projectId, organizationId, clerkActorId };
    scope.current = value;
    return () => {
      value.ready = false;
    };
  }, [ready, projectId, organizationId, clerkActorId]);
  const query = trpcReact.reportWorkflows.list.useQuery(
    { projectId, expectedClerkActorId: clerkActorId },
    { enabled: expanded && ready, retry: false, staleTime: 0 },
  );
  const catalog =
    ready &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.projectId === projectId &&
    query.data.organizationId === organizationId &&
    query.data.clerkActorId === clerkActorId
      ? query.data
      : null;
  const preview = trpcReact.reportWorkflows.preview.useQuery(
    { projectId, expectedClerkActorId: clerkActorId, config },
    {
      enabled: expanded && ready && tab === "dashboards" && !!catalog,
      retry: false,
      staleTime: 0,
      refetchInterval: 60000,
    },
  );
  const live =
    catalog &&
    !preview.error &&
    !preview.isFetching &&
    !preview.isPaused &&
    preview.data?.projectId === projectId &&
    preview.data.organizationId === organizationId &&
    preview.data.clerkActorId === clerkActorId
      ? preview.data
      : null;
  const saveDashboard = trpcReact.reportWorkflows.saveDashboard.useMutation(),
    saveSchedule = trpcReact.reportWorkflows.saveSchedule.useMutation();
  const busy = saveDashboard.isPending || saveSchedule.isPending;
  const locked = !ready || !editable || !!pending || busy || !catalog;
  const canSave = !locked && selected.owned;
  function reset(kind = tab) {
    setTab(kind);
    setSelected({ id: "", version: 0, owned: true });
    setName(
      kind === "dashboards" ? "Quality overview" : "Weekly quality review",
    );
    setConfig(starter);
    setVisibility("private");
    setEnabled(false);
    setMessage("");
  }
  async function send(change: NonNullable<typeof pending>) {
    if (!ready || !editable || busy) return;
    const current = scope.current;
    setPending(change);
    setMessage("");
    try {
      const result =
        change.kind === "dashboard"
          ? await saveDashboard.mutateAsync(change.request)
          : await saveSchedule.mutateAsync(change.request);
      if (scope.current !== current || !current.ready) return;
      setSelected({ id: result.id, version: result.version, owned: true });
      setPending(null);
      if ("enabled" in result) setEnabled(result.enabled === true);
      setMessage(
        change.kind === "dashboard"
          ? "Dashboard saved."
          : "enabled" in result && result.enabled
            ? "Schedule enabled. Captures will appear here for review."
            : "Schedule paused.",
      );
      await query.refetch();
    } catch {
      if (scope.current === current && current.ready)
        setMessage(
          "Save was not confirmed. Retry the same request, or reload the saved version before making another change. Your draft is retained.",
        );
    }
  }
  function save(archive = false) {
    if (!canSave) return;
    const parsed =
      tab === "dashboards"
        ? dashboardConfigSchema.safeParse(config)
        : reportScheduleConfigSchema.safeParse({
            ...schedule,
            definition: config.definition,
          });
    if (!name.trim() || !parsed.success) {
      setMessage(
        !name.trim()
          ? "Enter a name."
          : (parsed.error?.issues[0]?.message ?? "Review report settings."),
      );
      return;
    }
    const base = {
      projectId,
      expectedClerkActorId: clerkActorId,
      name: name.trim(),
      id: selected.id || crypto.randomUUID(),
      expectedVersion: selected.version,
      requestId: crypto.randomUUID(),
    };
    void send(
      tab === "dashboards"
        ? {
            kind: "dashboard",
            request: { ...base, config, visibility, archived: archive },
          }
        : {
            kind: "schedule",
            request: {
              ...base,
              config: { ...schedule, definition: config.definition },
              enabled,
              approveRecurringCapture: true,
              ...(schedule.delivery === "slack"
                ? { approveRecurringDelivery: true as const }
                : {}),
            },
          },
    );
  }
  const movedControl = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (ready && movedControl.current?.isConnected)
      movedControl.current.focus();
    movedControl.current = null;
  }, [config.widgets, ready]);
  function move(index: number, direction: number, control: HTMLButtonElement) {
    if (index + direction < 0 || index + direction >= config.widgets.length)
      return;
    movedControl.current = control;
    setConfig((value) => {
      const widgets = [...value.widgets];
      [widgets[index], widgets[index + direction]] = [
        widgets[index + direction]!,
        widgets[index]!,
      ];
      return { ...value, widgets };
    });
  }
  return (
    <details
      className={styles.workspace}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      hidden={!ready}
    >
      <summary>Dashboards and scheduled reports</summary>
      <p>
        Choose a saved view or start with an overview. Scheduled reports save a
        private capture for review. Workspace admins can also opt into recurring
        Slack aggregate delivery.
      </p>
      <div className={styles.actions} aria-label="Reporting tools">
        <button
          type="button"
          className="btn-secondary"
          aria-pressed={tab === "dashboards"}
          disabled={!!pending || busy}
          onClick={() => reset("dashboards")}
        >
          Dashboards
        </button>
        <button
          type="button"
          className="btn-secondary"
          aria-pressed={tab === "schedules"}
          disabled={!!pending || busy}
          onClick={() => reset("schedules")}
        >
          Schedules
        </button>
      </div>
      {query.error && (
        <p role="alert">
          Saved views could not be loaded.{" "}
          <button type="button" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      )}
      {query.isFetching && (
        <p role="status">Checking saved reporting settings…</p>
      )}
      {catalog && (
        <div className={styles.actions}>
          <label>
            Saved {tab}
            <select
              value={selected.id}
              disabled={!!pending || busy}
              onChange={(event) => {
                const row =
                  tab === "dashboards"
                    ? catalog.dashboards.find(
                        (row) => row.id === event.target.value,
                      )
                    : catalog.schedules.find(
                        (row) => row.id === event.target.value,
                      );
                if (!row) {
                  reset();
                  return;
                }
                setSelected({
                  id: row.id,
                  version: row.version,
                  owned: "editable" in row ? row.editable : true,
                });
                setName(row.name);
                setMessage("");
                if ("visibility" in row) {
                  setConfig(row.config);
                  setVisibility(
                    row.visibility === "project" ? "project" : "private",
                  );
                } else {
                  setConfig({ ...starter, definition: row.config.definition });
                  setSchedule(row.config);
                  setEnabled(row.enabled);
                }
              }}
            >
              <option value="">
                New {tab === "dashboards" ? "dashboard" : "schedule"}
              </option>
              {(tab === "dashboards"
                ? catalog.dashboards.filter((row) => !row.archived)
                : catalog.schedules
              ).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-secondary"
            disabled={locked || !selected.id}
            onClick={() => {
              setSelected({ id: "", version: 0, owned: true });
              setName(`${name.slice(0, 90)} copy`);
              setVisibility("private");
              setEnabled(false);
            }}
          >
            Duplicate
          </button>
        </div>
      )}
      <fieldset disabled={locked || !selected.owned} className={styles.fields}>
        <label>
          Name
          <input
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Reporting window
          <select
            value={config.definition.windowDays}
            onChange={(event) =>
              setConfig((value) => ({
                ...value,
                definition: {
                  ...value.definition,
                  windowDays: Number(event.target.value) as 7 | 30 | 90,
                  dateInterval: undefined,
                },
              }))
            }
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
        {tab === "dashboards" ? (
          <>
            <label>
              Visibility
              <select
                value={visibility}
                onChange={(event) =>
                  setVisibility(event.target.value as Dashboard["visibility"])
                }
              >
                <option value="private">Only me</option>
                <option value="project">Project members</option>
              </select>
            </label>
            <label>
              Layout
              <select
                value={config.columns}
                onChange={(event) =>
                  setConfig((value) => ({
                    ...value,
                    columns: Number(event.target.value) as 1 | 2,
                  }))
                }
              >
                <option value={1}>One column</option>
                <option value={2}>Two columns</option>
              </select>
            </label>
            <details className={styles.full}>
              <summary>Include other projects</summary>
              <p>
                This project is always included. Choose up to four more
                workspace projects; each keeps its own charts and denominators.
              </p>
              {(catalog?.projects ?? [])
                .filter((project) => project.id !== projectId)
                .map((project) => (
                  <label
                    key={project.id}
                    style={{ display: "block", marginBlock: 8 }}
                  >
                    <input
                      type="checkbox"
                      checked={
                        config.additionalProjectIds?.includes(project.id) ??
                        false
                      }
                      disabled={
                        !config.additionalProjectIds?.includes(project.id) &&
                        (config.additionalProjectIds?.length ?? 0) >= 4
                      }
                      onChange={(event) =>
                        setConfig((value) => ({
                          ...value,
                          additionalProjectIds: event.target.checked
                            ? [
                                ...(value.additionalProjectIds ?? []),
                                project.id,
                              ]
                            : value.additionalProjectIds?.filter(
                                (id) => id !== project.id,
                              ),
                        }))
                      }
                    />{" "}
                    {project.name}
                  </label>
                ))}
              {catalog?.projectCatalogLimited && (
                <p>
                  The first 100 workspace projects are listed. This is a limited
                  project picker, not a complete portfolio.
                </p>
              )}
            </details>
            <details className={styles.full}>
              <summary>Customize charts</summary>
              <ol>
                {config.widgets.map((widget, index) => (
                  <li key={widget.id} className={styles.actions}>
                    <span>{widgetNames[widget.id]}</span>
                    <select
                      aria-label={`${widgetNames[widget.id]} display`}
                      value={widget.display}
                      onChange={(event) =>
                        setConfig((value) => ({
                          ...value,
                          widgets: value.widgets.map((row) =>
                            row.id === widget.id
                              ? {
                                  ...row,
                                  display: event.target
                                    .value as typeof widget.display,
                                }
                              : row,
                          ),
                        }))
                      }
                    >
                      <option value="bars">Bars</option>
                      <option value="donut">Donut</option>
                      <option value="table">Table</option>
                    </select>
                    <button
                      type="button"
                      aria-label={`Move ${widgetNames[widget.id]} up`}
                      aria-disabled={index === 0}
                      onClick={(event) => move(index, -1, event.currentTarget)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${widgetNames[widget.id]} down`}
                      aria-disabled={index === config.widgets.length - 1}
                      onClick={(event) => move(index, 1, event.currentTarget)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={config.widgets.length === 1}
                      onClick={() =>
                        setConfig((value) => ({
                          ...value,
                          widgets: value.widgets.filter(
                            (row) => row.id !== widget.id,
                          ),
                        }))
                      }
                    >
                      Remove {widgetNames[widget.id]}
                    </button>
                    {widget.query && (
                      <MetricEditor
                        value={widget.query}
                        onChange={(query) =>
                          setConfig((value) => ({
                            ...value,
                            widgets: value.widgets.map((row) =>
                              row.id === widget.id ? { ...row, query } : row,
                            ),
                          }))
                        }
                      />
                    )}
                  </li>
                ))}
              </ol>
              <label>
                Add chart
                <select
                  value=""
                  onChange={(event) => {
                    const id = event.target
                      .value as Config["widgets"][number]["id"];
                    if (id)
                      setConfig((value) => ({
                        ...value,
                        widgets: [
                          ...value.widgets,
                          {
                            id,
                            display: "bars",
                            ...(id.startsWith("custom-")
                              ? {
                                  query: {
                                    entity: "cases" as const,
                                    dimension: "priority" as const,
                                    operation: "count" as const,
                                  },
                                }
                              : {}),
                          },
                        ],
                      }));
                  }}
                >
                  <option value="">Choose a chart</option>
                  {Object.entries(widgetNames)
                    .filter(
                      ([id]) => !config.widgets.some((row) => row.id === id),
                    )
                    .map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                </select>
              </label>
            </details>
          </>
        ) : (
          <>
            <label>
              Repeat
              <select
                value={schedule.cadence}
                onChange={(event) =>
                  setSchedule((value) => ({
                    ...value,
                    cadence: event.target.value as typeof value.cadence,
                  }))
                }
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            {schedule.cadence === "weekly" && (
              <label>
                Day
                <select
                  value={schedule.weekday}
                  onChange={(event) =>
                    setSchedule((value) => ({
                      ...value,
                      weekday: Number(event.target.value),
                    }))
                  }
                >
                  {[
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ].map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {schedule.cadence === "monthly" && (
              <label>
                Day of month (1–28)
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={schedule.monthDay}
                  onChange={(event) =>
                    setSchedule((value) => ({
                      ...value,
                      monthDay: Number(event.target.value),
                    }))
                  }
                />
              </label>
            )}
            <label>
              Time
              <input
                type="time"
                value={`${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`}
                onChange={(event) => {
                  const [hour, minute] = event.target.value
                    .split(":")
                    .map(Number);
                  setSchedule((value) => ({
                    ...value,
                    hour: hour!,
                    minute: minute!,
                  }));
                }}
              />
            </label>
            <label>
              Time zone
              <input
                maxLength={100}
                placeholder="America/Los_Angeles"
                value={schedule.timeZone}
                onChange={(event) =>
                  setSchedule((value) => ({
                    ...value,
                    timeZone: event.target.value,
                  }))
                }
              />
            </label>
            <label className={styles.full}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />{" "}
              Enable recurring private captures using my current access
            </label>
            <label className={styles.full}>
              <input
                type="checkbox"
                checked={schedule.delivery === "slack"}
                onChange={(event) =>
                  setSchedule((value) => ({
                    ...value,
                    delivery: event.target.checked ? "slack" : "private",
                  }))
                }
              />{" "}
              Also deliver selected inventory and result totals to the
              configured workspace Slack destination
            </label>
            {schedule.delivery === "slack" && (
              <p className={styles.full}>
                Saving authorizes recurring delivery to the current workspace
                Slack destination. Workspace admin access is required. Project
                name, capture time, window and selected totals are sent;
                authored notes and raw records stay private. Changing the
                destination or losing admin access pauses delivery. An uncertain
                send is never automatically retried.
              </p>
            )}
            <p className={styles.full}>
              Daylight-saving gaps move to the next valid time; repeated hours
              run once. If access changes or capture fails, the schedule pauses.
              Missed periods produce one current capture, not invented
              historical reports.
            </p>
          </>
        )}
        <details className={styles.full}>
          <summary>More report settings</summary>
          <ReportDefinitionSettingsEditor
            projectId={projectId}
            value={config.definition}
            onChange={(value) =>
              setConfig((current) => ({ ...current, definition: value }))
            }
            screen={screen}
            onScreen={setScreen}
            active={!locked}
          />
        </details>
      </fieldset>
      {message && <p role="status">{message}</p>}
      {pending ? (
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!ready || !editable || busy}
            onClick={() => void send(pending)}
          >
            Retry same save
          </button>
          <button
            type="button"
            disabled={busy || !ready}
            onClick={async () => {
              const current = scope.current;
              const result = await query.refetch();
              if (scope.current === current && current.ready && !result.error) {
                setPending(null);
                reset();
              }
            }}
          >
            Reload saved versions
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className="btn-primary"
            disabled={!canSave}
            onClick={() => save()}
          >
            {tab === "dashboards"
              ? "Save dashboard"
              : enabled
                ? "Enable schedule"
                : "Save paused schedule"}
          </button>
          {tab === "dashboards" && selected.id && (
            <button
              type="button"
              disabled={!canSave}
              onClick={() => save(true)}
            >
              Archive dashboard
            </button>
          )}
        </div>
      )}
      {tab === "dashboards" && (
        <>
          <div className={styles.actions}>
            <h3>Live preview</h3>
            <button
              type="button"
              disabled={!catalog || preview.isFetching}
              onClick={() => void preview.refetch()}
            >
              Refresh
            </button>
          </div>
          {preview.error && (
            <p role="alert">
              Live metrics could not be verified. Refresh to retry.
            </p>
          )}
          {preview.isFetching && (
            <p role="status">Refreshing current metrics…</p>
          )}
          {live && (
            <>
              <p>
                Updated {new Date(live.asOf).toLocaleString()} · refreshes every
                minute
              </p>
              <div className={styles.grid} data-columns={live.columns}>
                {live.widgets.map(
                  (widget) =>
                    widget.visual && (
                      <div key={widget.id}>
                        {widget.display === "table" ? (
                          <figure>
                            <figcaption>{widget.visual.title}</figcaption>
                            <table>
                              <thead>
                                <tr>
                                  <th>Category</th>
                                  <th>{widget.visual.unit}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {widget.visual.rows.map((row) => (
                                  <tr key={row.label}>
                                    <th scope="row">{row.label}</th>
                                    <td>{row.value}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <p>
                              {widget.visual.rows.length
                                ? widget.visual.note
                                : widget.visual.empty}
                            </p>
                          </figure>
                        ) : (
                          <QualityVisualReport
                            model={{
                              version: 1,
                              charts: [
                                { ...widget.visual, kind: widget.display },
                              ],
                            }}
                          />
                        )}
                      </div>
                    ),
                )}
              </div>
              <details>
                <summary>Metric limitations</summary>
                {live.limitations.map((text, index) => (
                  <p key={index}>{text}</p>
                ))}
              </details>
            </>
          )}
        </>
      )}
      {tab === "schedules" &&
        catalog?.schedules
          .filter((row) => row.id === selected.id)
          .map((row) => (
            <section key={row.id}>
              <h3>
                {row.enabled
                  ? `Next capture: ${new Date(row.nextRunAt).toLocaleString()}`
                  : row.pauseReason
                    ? "Schedule paused after access changed or capture failed"
                    : "Schedule paused"}
              </h3>
              {!row.runs.length && <p>No capture has run yet.</p>}
              <ul>
                {row.runs.map((run) => (
                  <li key={run.id}>
                    {new Date(run.scheduledFor).toLocaleString()} ·{" "}
                    {run.status === "CAPTURED" && run.snapshotId ? (
                      <Link
                        href={`/projects/${projectId}/reports/snapshots/${run.snapshotId}`}
                      >
                        Review private capture
                      </Link>
                    ) : run.failureCode === "ACCESS_CHANGED" ? (
                      "Access changed. Restore current editor access, then explicitly enable the schedule."
                    ) : (
                      "Capture failed. Check report scope and snapshot capacity, then enable to retry."
                    )}
                    {run.deliveryStatus &&
                      run.deliveryStatus !== "NOT_REQUESTED" && (
                        <span>
                          {" "}
                          ·{" "}
                          {run.deliveryStatus === "SENT"
                            ? "Delivered to Slack"
                            : run.deliveryStatus === "PENDING"
                              ? "Delivery queued"
                              : run.deliveryStatus === "CANCELLED"
                                ? "Delivery cancelled after schedule or access changed"
                                : "Delivery outcome unconfirmed. Check Slack before sharing manually; no automatic retry."}
                        </span>
                      )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
    </details>
  );
}

function MetricEditor({
  value,
  onChange,
}: {
  value: NonNullable<Config["widgets"][number]["query"]>;
  onChange: (query: NonNullable<Config["widgets"][number]["query"]>) => void;
}) {
  const dimensions =
    value.entity === "cases"
      ? ["priority", "testType", "automationStatus", "day", "week", "month"]
      : value.entity === "results"
        ? ["status", "day", "week", "month"]
        : ["priority", "testType", "day", "week", "month"];
  return (
    <div className={styles.fields}>
      <label>
        Data source
        <select
          value={value.entity}
          onChange={(event) => {
            const entity = event.target.value as typeof value.entity;
            onChange({
              entity,
              operation: "count",
              dimension: entity === "results" ? "status" : "priority",
            });
          }}
        >
          <option value="cases">Current cases / creation activity</option>
          <option value="results">Recorded results</option>
          <option value="caseVersions">Recorded case versions</option>
        </select>
      </label>
      <label>
        Group by
        <select
          value={value.dimension}
          onChange={(event) =>
            onChange({
              ...value,
              dimension: event.target.value as typeof value.dimension,
            })
          }
        >
          {dimensions.map((key) => (
            <option key={key} value={key}>
              {
                (
                  {
                    priority: "Priority",
                    testType: "Test type",
                    automationStatus: "Automation",
                    status: "Outcome",
                    day: "Day (UTC)",
                    week: "Week (Monday, UTC)",
                    month: "Month (UTC)",
                  } as Record<string, string>
                )[key]
              }
            </option>
          ))}
        </select>
      </label>
      <label>
        Measure
        <select
          value={value.operation}
          onChange={(event) =>
            onChange({
              ...value,
              operation: event.target.value as typeof value.operation,
            })
          }
        >
          <option value="count">Count records</option>
          {value.entity === "results" && (
            <option value="durationMs">Recorded duration (milliseconds)</option>
          )}
        </select>
      </label>
      <label>
        Priority filter
        <select
          value={value.priority ?? ""}
          onChange={(event) =>
            onChange({
              ...value,
              priority: (event.target.value ||
                undefined) as typeof value.priority,
            })
          }
        >
          <option value="">All priorities</option>
          {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((key) => (
            <option key={key}>{key}</option>
          ))}
        </select>
      </label>
      {value.entity !== "caseVersions" && (
        <label>
          Automation filter
          <select
            value={value.automationStatus ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                automationStatus: (event.target.value ||
                  undefined) as typeof value.automationStatus,
              })
            }
          >
            <option value="">All automation states</option>
            {[
              "MANUAL",
              "AUTOMATED",
              "PARTIALLY_AUTOMATED",
              "NEEDS_AUTOMATION",
            ].map((key) => (
              <option key={key}>{key}</option>
            ))}
          </select>
        </label>
      )}
      {value.entity === "results" && (
        <label>
          Outcome filter
          <select
            value={value.status ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                status: (event.target.value ||
                  undefined) as typeof value.status,
              })
            }
          >
            <option value="">All outcomes</option>
            {["PASS", "FAIL", "SKIP", "FLAKY", "BLOCKED"].map((key) => (
              <option key={key}>{key}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
