"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DialogFrame } from "./ui/DialogFrame";
import { trpcReact } from "@/lib/trpcReact";
import { readableMetric } from "@/lib/frozen-report";
import { useSavedCaseQueries } from "./SavedCaseQueries";
import { CaseCustomQueryCondition } from "./CaseCustomQueryCondition";
import { CaseQueryExport } from "./CaseQueryExport";
import {
  customBindingProblems,
  type CaseCustomBinding,
} from "@vaettir/api/src/services/caseCustomQuerySchema";
import {
  caseQuerySchema,
  defaultCaseQuery,
  CASE_QUERY_COLUMNS,
  CASE_QUERY_TYPES,
  CASE_QUERY_DOMAINS,
  type CaseQuery,
  type CaseQueryRule,
} from "@vaettir/api/src/services/caseQuerySchema";
const queryMetric = (value: string) =>
  ["HIL", "E2E"].includes(value) ? value : readableMetric(value);
type Field = Exclude<CaseQueryRule["field"], "custom">;
const fields: Record<Field, string> = {
  title: "Title",
  displayId: "Case ID",
  tag: "Tag",
  suite: "Suite path",
  priority: "Priority",
  type: "Test type",
  domain: "Domain",
  automation: "Automation",
  review: "Review status",
  origin: "Origin",
  riskScore: "Risk score",
  flaky: "Marked flaky",
};
const enumValues: Partial<Record<Field, readonly string[]>> = {
  priority: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
  type: CASE_QUERY_TYPES,
  domain: CASE_QUERY_DOMAINS,
  automation: [
    "MANUAL",
    "AUTOMATED",
    "PARTIALLY_AUTOMATED",
    "NEEDS_AUTOMATION",
  ],
  review: ["APPROVED", "PENDING_REVIEW", "REJECTED"],
  origin: ["AUTHORED", "AI_REVERSE_ENGINEERED", "IMPORTED"],
};
function newRule(field: Field): CaseQueryRule {
  if (field === "riskScore") return { field, operator: "atLeast", value: 50 };
  if (field === "flaky") return { field, operator: "equals", value: true };
  if (field === "suite") return { field, operator: "equals", value: "" };
  if (field === "title") return { field, operator: "contains", value: "" };
  return {
    field,
    operator: "equals",
    value: enumValues[field]?.[0] ?? "",
  } as CaseQueryRule;
}
const operationLabel = (op: string) =>
  ({
    contains: "Contains text",
    equals: "Equals",
    unassigned: "Unassigned",
    unassessed: "Not assessed",
    atLeast: "At least",
    atMost: "At most",
  })[op] ?? op;
export function CaseQueryExplorer({ projectId }: { projectId: string }) {
  return <Explorer key={projectId} projectId={projectId} />;
}
function Explorer({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false),
    [screen, setScreen] = useState<"criteria" | "results">("criteria"),
    [draft, setDraft] = useState<CaseQuery>(defaultCaseQuery),
    [message, setMessage] = useState("");
  const [columns, setColumns] = useState<string[]>([
    "title",
    "type",
    "priority",
    "risk",
    "automation",
  ]);
  const project = trpcReact.project.byId.useQuery(
    { id: projectId },
    { enabled: open, retry: false, staleTime: 0 },
  );
  const organizations = trpcReact.organization.mine.useQuery(undefined, {
    enabled: open,
    retry: false,
    staleTime: 0,
  });
  const organizationId =
    project.data?.id === projectId ? project.data.organizationId : undefined;
  const accessReady =
    open &&
    !project.error &&
    !project.isFetching &&
    !project.isPaused &&
    project.data?.id === projectId &&
    !organizations.error &&
    !organizations.isFetching &&
    !organizations.isPaused &&
    !!organizations.data?.some((org) => org.id === organizationId);
  const definitions = trpcReact.caseFields.get.useQuery(
    { projectId },
    { enabled: accessReady, retry: false, staleTime: 0 },
  );
  const freshDefinitions =
    accessReady &&
    !definitions.error &&
    !definitions.isFetching &&
    !definitions.isPaused &&
    definitions.data?.projectId === projectId &&
    definitions.data.organizationId === organizationId &&
    definitions.data.caseId === null
      ? definitions.data
      : null;
  const activeFields =
    freshDefinitions?.schema.fields.filter((field) => !field.retired) ?? [];
  const bindingFor = (key: string): CaseCustomBinding | null => {
    const field = activeFields.find((field) => field.key === key);
    return field
      ? { key: field.key, type: field.type, options: field.options }
      : null;
  };
  const columnLabel = (column: string) =>
    column.startsWith("custom:")
      ? (freshDefinitions?.schema.fields.find(
          (field) => field.key === column.slice(7),
        )?.label ?? `${column.slice(7)} (repair required)`)
      : readableMetric(column);
  function toggleCustomColumn(key: string, selected: boolean) {
    const binding = bindingFor(key);
    if (
      selected &&
      (!binding ||
        columns.length >= 8 ||
        (draft.customColumns?.length ?? 0) >= 6)
    )
      return;
    setColumns(
      selected
        ? [...columns, `custom:${key}`]
        : columns.filter((column) => column !== `custom:${key}`),
    );
    setDraft({
      ...draft,
      customColumns: selected
        ? [...(draft.customColumns ?? []), binding!]
        : (draft.customColumns ?? []).filter((column) => column.key !== key),
    });
  }
  const [applied, setApplied] = useState<{
      query: CaseQuery;
      cursor?: string;
      requestId: string;
    } | null>(null),
    [history, setHistory] = useState<string[]>([]);
  const query = trpcReact.caseQueries.page.useQuery(
    {
      projectId,
      query: applied?.query ?? defaultCaseQuery(),
      cursor: applied?.cursor,
      requestId: applied?.requestId ?? "00000000-0000-4000-8000-000000000000",
    },
    {
      enabled: accessReady && screen === "results" && !!applied,
      staleTime: 0,
      retry: false,
    },
  );
  const appliedBindings = applied
    ? [
        ...(applied.query.customColumns ?? []),
        ...applied.query.groups.flatMap((group) =>
          group.rules.filter((rule) => rule.field === "custom"),
        ),
      ]
    : [];
  const appliedBindingProblems = freshDefinitions
    ? customBindingProblems(freshDefinitions.schema.fields, appliedBindings)
    : [];
  const result =
    accessReady &&
    screen === "results" &&
    applied &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    (!(
      applied.query.customColumns?.length ||
      applied.query.groups.some((group) =>
        group.rules.some((rule) => rule.field === "custom"),
      )
    ) ||
      !!freshDefinitions) &&
    appliedBindingProblems.length === 0 &&
    query.data?.requestId === applied.requestId &&
    query.data.projectId === projectId &&
    query.data.organizationId === organizationId
      ? query.data
      : null;
  const previousOrganization = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      organizationId &&
      previousOrganization.current &&
      organizationId !== previousOrganization.current
    ) {
      // Retain authored criteria and uncertain saved writes, but never reuse a
      // previous tenant's returned metadata or export review.
      void definitions.refetch();
      if (applied) void query.refetch();
    }
    if (organizationId) previousOrganization.current = organizationId;
  }, [organizationId, definitions.refetch, query.refetch, applied]);
  const projectionMatches =
    !!applied &&
    JSON.stringify(
      columns
        .filter((column) => column.startsWith("custom:"))
        .map((column) => column.slice(7))
        .sort(),
    ) ===
      JSON.stringify(
        (applied.query.customColumns ?? []).map((column) => column.key).sort(),
      );
  const totalRules = draft.groups.reduce((sum, g) => sum + g.rules.length, 0);
  const savedQueries = useSavedCaseQueries({
    projectId,
    organizationId,
    enabled: accessReady,
    query: draft,
    columns,
    onLoad: (savedQuery, savedColumns) => {
      setDraft(savedQuery);
      setColumns(savedColumns);
      setApplied(null);
      setHistory([]);
      setScreen("criteria");
      setMessage("");
    },
  });
  function updateRule(group: number, index: number, rule: CaseQueryRule) {
    setDraft({
      ...draft,
      groups: draft.groups.map((g, i) =>
        i === group
          ? { ...g, rules: g.rules.map((r, j) => (j === index ? rule : r)) }
          : g,
      ),
    });
    setMessage("");
  }
  function run() {
    if (!accessReady) {
      setMessage(
        "Refresh current project access before running these retained criteria.",
      );
      return;
    }
    const parsed = caseQuerySchema.safeParse(draft);
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Review the query conditions.",
      );
      return;
    }
    const bindings = [
      ...(parsed.data.customColumns ?? []),
      ...parsed.data.groups.flatMap((group) =>
        group.rules.filter((rule) => rule.field === "custom"),
      ),
    ];
    if (bindings.length && !freshDefinitions) {
      setMessage(
        "Refresh current project fields before running custom conditions or columns.",
      );
      return;
    }
    const problems = customBindingProblems(
      freshDefinitions?.schema.fields ?? [],
      bindings,
    );
    if (problems.length) {
      setMessage(problems.join(" "));
      return;
    }
    setApplied({ query: parsed.data, requestId: crypto.randomUUID() });
    setHistory([]);
    setScreen("results");
    setMessage("");
  }
  function refresh() {
    if (!applied) return;
    setApplied({ query: applied.query, requestId: crypto.randomUUID() });
    setHistory([]);
  }
  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setOpen(true)}
      >
        Query cases
      </button>
      <DialogFrame
        open={open}
        onClose={() => setOpen(false)}
        className="modal-panel"
        label="Query test cases"
        style={{
          width: "min(1100px,calc(100vw - 32px))",
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        <div className="modal-header">
          <h2 style={{ margin: 0 }}>Query test cases</h2>
          <button
            type="button"
            className="btn-secondary modal-close"
            aria-label="Close case query"
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>
        <p className="text-muted">
          Querying does not change cases. Save personal or shared criteria and
          column layouts below; existing table views and selections stay
          unchanged.
        </p>
        {!accessReady && (
          <div role={project.error || organizations.error ? "alert" : "status"}>
            <p>
              Current project access must be refreshed. Retained criteria are
              not current case evidence.
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                void Promise.all([
                  project.refetch(),
                  organizations.refetch(),
                  definitions.refetch(),
                  query.refetch(),
                ])
              }
            >
              Refresh project access
            </button>
          </div>
        )}
        {savedQueries}
        {screen === "criteria" ? (
          <>
            {definitions.error && (
              <p role="alert">
                Project fields could not be refreshed. Existing custom
                conditions are retained for repair.{" "}
                <button
                  type="button"
                  onClick={() => void definitions.refetch()}
                >
                  Retry field definitions
                </button>
              </p>
            )}
            {!freshDefinitions && !definitions.error && (
              <p role="status">
                {definitions.isPaused
                  ? "Reconnect to verify current project fields."
                  : "Loading current project fields…"}
              </p>
            )}
            <label>
              Combine groups
              <select
                data-dialog-initial-focus
                value={draft.match}
                onChange={(e) =>
                  setDraft({ ...draft, match: e.target.value as "all" | "any" })
                }
              >
                <option value="all">All groups must match (AND)</option>
                <option value="any">Any group may match (OR)</option>
              </select>
            </label>
            {!draft.groups.length && (
              <p>
                No conditions: query all cases in the selected archive scope.
              </p>
            )}
            {draft.groups.map((group, gi) => (
              <fieldset key={gi} style={{ marginBlock: 16, padding: 12 }}>
                <legend>Group {gi + 1}</legend>
                <label>
                  Within group {gi + 1}
                  <select
                    value={group.match}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        groups: draft.groups.map((g, i) =>
                          i === gi
                            ? { ...g, match: e.target.value as "all" | "any" }
                            : g,
                        ),
                      })
                    }
                  >
                    <option value="all">All conditions (AND)</option>
                    <option value="any">Any condition (OR)</option>
                  </select>
                </label>
                {group.rules.map((rule, ri) => (
                  <div
                    key={ri}
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      alignItems: "end",
                      marginBlock: 12,
                    }}
                  >
                    <label>
                      Field {gi + 1}.{ri + 1}
                      <select
                        value={
                          rule.field === "custom"
                            ? `custom:${rule.key}`
                            : rule.field
                        }
                        onChange={(e) => {
                          if (e.target.value.startsWith("custom:")) {
                            const binding = bindingFor(e.target.value.slice(7));
                            if (binding)
                              updateRule(gi, ri, {
                                ...binding,
                                field: "custom",
                                operator: "missing",
                              });
                          } else
                            updateRule(
                              gi,
                              ri,
                              newRule(e.target.value as Field),
                            );
                        }}
                      >
                        {Object.entries(fields).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                        {rule.field === "custom" &&
                          !activeFields.some(
                            (field) => field.key === rule.key,
                          ) && (
                            <option value={`custom:${rule.key}`}>
                              {rule.key} (unavailable; repair or remove)
                            </option>
                          )}
                        {activeFields.map((field) => (
                          <option key={field.key} value={`custom:${field.key}`}>
                            {field.label} (project field)
                          </option>
                        ))}
                      </select>
                    </label>
                    {rule.field === "custom" ? (
                      <CaseCustomQueryCondition
                        rule={rule}
                        onChange={(updated) => updateRule(gi, ri, updated)}
                        label={`${gi + 1}.${ri + 1}`}
                      />
                    ) : (
                      <>
                        <label>
                          Condition {gi + 1}.{ri + 1}
                          <select
                            value={rule.operator}
                            onChange={(e) =>
                              updateRule(gi, ri, {
                                ...rule,
                                operator: e.target.value,
                              } as CaseQueryRule)
                            }
                          >
                            {(rule.field === "title"
                              ? ["contains", "equals"]
                              : rule.field === "suite"
                                ? ["equals", "unassigned"]
                                : rule.field === "riskScore"
                                  ? ["atLeast", "atMost", "unassessed"]
                                  : ["equals"]
                            ).map((op) => (
                              <option key={op} value={op}>
                                {operationLabel(op)}
                              </option>
                            ))}
                          </select>
                        </label>
                        {!["unassigned", "unassessed"].includes(
                          rule.operator,
                        ) && (
                          <label
                            style={{
                              minWidth: 0,
                              maxWidth: "100%",
                              flex: "1 1 180px",
                            }}
                          >
                            Value {gi + 1}.{ri + 1}
                            {enumValues[rule.field] ? (
                              <select
                                style={{ width: "100%", minWidth: 0 }}
                                value={String(rule.value)}
                                onChange={(e) =>
                                  updateRule(gi, ri, {
                                    ...rule,
                                    value: e.target.value,
                                  } as CaseQueryRule)
                                }
                              >
                                {enumValues[rule.field]!.map((value) => (
                                  <option key={value} value={value}>
                                    {queryMetric(value)}
                                  </option>
                                ))}
                              </select>
                            ) : rule.field === "flaky" ? (
                              <select
                                style={{ width: "100%", minWidth: 0 }}
                                value={String(rule.value)}
                                onChange={(e) =>
                                  updateRule(gi, ri, {
                                    ...rule,
                                    value: e.target.value === "true",
                                  })
                                }
                              >
                                <option value="true">Yes</option>
                                <option value="false">No</option>
                              </select>
                            ) : (
                              <input
                                style={{ width: "100%", minWidth: 0 }}
                                type={
                                  rule.field === "riskScore" ? "number" : "text"
                                }
                                min={rule.field === "riskScore" ? 0 : undefined}
                                max={
                                  rule.field === "riskScore" ? 100 : undefined
                                }
                                maxLength={rule.field === "suite" ? 240 : 160}
                                value={String(rule.value)}
                                onChange={(e) =>
                                  updateRule(gi, ri, {
                                    ...rule,
                                    value:
                                      rule.field === "riskScore"
                                        ? Number(e.target.value)
                                        : e.target.value,
                                  } as CaseQueryRule)
                                }
                              />
                            )}
                          </label>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      className="btn-secondary"
                      aria-label={`Remove condition ${gi + 1}.${ri + 1}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          groups: draft.groups.flatMap((g, i) =>
                            i !== gi
                              ? [g]
                              : g.rules.length === 1
                                ? []
                                : [
                                    {
                                      ...g,
                                      rules: g.rules.filter((_, j) => j !== ri),
                                    },
                                  ],
                          ),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={group.rules.length >= 8 || totalRules >= 12}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      groups: draft.groups.map((g, i) =>
                        i === gi
                          ? { ...g, rules: [...g.rules, newRule("title")] }
                          : g,
                      ),
                    })
                  }
                >
                  Add condition to group {gi + 1}
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              className="btn-secondary"
              disabled={draft.groups.length >= 3 || totalRules >= 12}
              onClick={() =>
                setDraft({
                  ...draft,
                  groups: [
                    ...draft.groups,
                    { match: "all", rules: [newRule("title")] },
                  ],
                })
              }
            >
              Add condition group
            </button>
            <details style={{ marginBlock: 16 }}>
              <summary>Archive scope and sorting</summary>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  marginTop: 12,
                }}
              >
                <label>
                  Archive scope
                  <select
                    value={draft.archive}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        archive: e.target.value as CaseQuery["archive"],
                      })
                    }
                  >
                    <option value="active">Active cases</option>
                    <option value="archived">Archived cases</option>
                    <option value="all">Active and archived</option>
                  </select>
                </label>
                <label>
                  Sort by
                  <select
                    value={draft.sort}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        sort: e.target.value as CaseQuery["sort"],
                      })
                    }
                  >
                    <option value="caseNumber">Case ID number</option>
                    <option value="title">Title</option>
                    <option value="updatedAt">Last updated</option>
                  </select>
                </label>
                <label>
                  Sort direction
                  <select
                    value={draft.direction}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        direction: e.target.value as "asc" | "desc",
                      })
                    }
                  >
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </select>
                </label>
              </div>
            </details>
            {message && <p role="alert">{message}</p>}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                marginTop: 20,
              }}
            >
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setDraft(defaultCaseQuery());
                  setMessage("");
                }}
              >
                Clear conditions
              </button>
              <button type="button" className="btn-primary" onClick={run}>
                Run query
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setScreen("criteria")}
            >
              Edit criteria
            </button>
            <button type="button" className="btn-secondary" onClick={run}>
              Run current criteria with selected columns
            </button>
            {message && <p role="alert">{message}</p>}
            {definitions.error && (
              <p role="alert">
                Current custom-field access could not be verified. Cached custom
                values are withheld.{" "}
                <button
                  type="button"
                  onClick={() => void definitions.refetch()}
                >
                  Retry current field access
                </button>
              </p>
            )}
            <details style={{ marginBlock: 12 }}>
              <summary>Displayed columns</summary>
              <fieldset style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                <legend>Case ID is always visible</legend>
                {CASE_QUERY_COLUMNS.map((col) => (
                  <label key={col} style={{ display: "flex", gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={columns.includes(col)}
                      disabled={!columns.includes(col) && columns.length >= 8}
                      onChange={(e) =>
                        setColumns(
                          e.target.checked
                            ? [...columns, col]
                            : columns.filter((c) => c !== col),
                        )
                      }
                    />
                    {readableMetric(col)}
                  </label>
                ))}
                {activeFields.map((field) => (
                  <label key={field.key}>
                    <input
                      type="checkbox"
                      checked={columns.includes(`custom:${field.key}`)}
                      disabled={
                        !columns.includes(`custom:${field.key}`) &&
                        (columns.length >= 8 ||
                          (draft.customColumns?.length ?? 0) >= 6)
                      }
                      onChange={(event) =>
                        toggleCustomColumn(field.key, event.target.checked)
                      }
                    />
                    {field.label} (project field)
                  </label>
                ))}
                {columns
                  .filter(
                    (column) =>
                      column.startsWith("custom:") &&
                      !activeFields.some(
                        (field) => `custom:${field.key}` === column,
                      ),
                  )
                  .map((column) => (
                    <label key={column}>
                      <input
                        type="checkbox"
                        checked
                        onChange={() =>
                          toggleCustomColumn(column.slice(7), false)
                        }
                      />
                      {columnLabel(column)}
                    </label>
                  ))}
              </fieldset>
              <ol style={{ paddingLeft: 24 }}>
                {columns.map((column, index) => (
                  <li key={column} style={{ marginBlock: 8 }}>
                    {columnLabel(column)}{" "}
                    <button
                      type="button"
                      className="btn-secondary"
                      aria-label={`Move ${column} column earlier`}
                      disabled={index === 0}
                      onClick={() => {
                        const next = [...columns];
                        [next[index - 1], next[index]] = [
                          next[index]!,
                          next[index - 1]!,
                        ];
                        setColumns(next);
                      }}
                    >
                      Up
                    </button>{" "}
                    <button
                      type="button"
                      className="btn-secondary"
                      aria-label={`Move ${column} column later`}
                      disabled={index === columns.length - 1}
                      onClick={() => {
                        const next = [...columns];
                        [next[index + 1], next[index]] = [
                          next[index]!,
                          next[index + 1]!,
                        ];
                        setColumns(next);
                      }}
                    >
                      Down
                    </button>
                  </li>
                ))}
              </ol>
            </details>
            {appliedBindingProblems.length > 0 ? (
              <p role="alert">
                Current field definitions no longer match this applied query.
                Retained criteria must be repaired and run again; no old rows or
                export review have been substituted.{" "}
                {appliedBindingProblems.join(" ")}
              </p>
            ) : query.error ? (
              <div role="alert">
                <p>
                  Query unavailable or stale. No previous page has been
                  substituted.
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void query.refetch()}
                >
                  Retry same query page
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={refresh}
                >
                  Restart query with current cases
                </button>
              </div>
            ) : !result ? (
              <p role="status">
                {query.isPaused
                  ? "Waiting for a connection to verify query access…"
                  : "Verifying case query…"}
              </p>
            ) : (
              <>
                <p>
                  {result.total} matching cases · Page {history.length + 1} · Up
                  to 50 rows per page.
                </p>
                <details style={{ marginBlock: 12 }}>
                  <summary>Read watermark and table scope</summary>
                  <p className="text-muted">
                    Read watermark:{" "}
                    {new Date(result.watermark).toLocaleString()}. This is not a
                    frozen report. Updated records are excluded until you
                    restart; page anchors expire after 15 minutes.
                  </p>
                  <p>
                    Existing saved views, selected cases, bulk actions and
                    existing exports stay unchanged. This explorer has a
                    separate reviewed whole-query metadata export, not a
                    procedure backup.
                  </p>
                </details>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 12,
                  }}
                >
                  <button
                    type="button"
                    className="btn-secondary"
                    aria-label="Previous query page"
                    disabled={!history.length}
                    onClick={() => {
                      const previous = history.at(-1)!;
                      setHistory(history.slice(0, -1));
                      setApplied({
                        ...applied!,
                        cursor: previous,
                        requestId: crypto.randomUUID(),
                      });
                    }}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    aria-label="Next query page"
                    disabled={!result.nextCursor}
                    onClick={() => {
                      setHistory([...history, result.pageCursor]);
                      setApplied({
                        ...applied!,
                        cursor: result.nextCursor!,
                        requestId: crypto.randomUUID(),
                      });
                    }}
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={refresh}
                  >
                    Restart query with current cases
                  </button>
                  {applied && organizationId && (
                    <CaseQueryExport
                      projectId={projectId}
                      organizationId={organizationId}
                      query={applied.query}
                      columns={columns}
                      requestKey={applied.requestId}
                      enabled={
                        !!result &&
                        accessReady &&
                        projectionMatches &&
                        columns.length > 0
                      }
                    />
                  )}
                </div>
                {!projectionMatches && (
                  <p role="status">
                    Selected custom columns differ from the applied query.
                    Return to criteria and run again before exporting those
                    fields.
                  </p>
                )}
                {!!result.items.length && (
                  <p className="text-muted" style={{ fontSize: 12 }}>
                    More columns? Scroll the table sideways, or focus it and use
                    Left/Right.
                  </p>
                )}
                {!result.items.length ? (
                  <p>
                    No cases match this query. This is not an execution or
                    passing result.
                  </p>
                ) : (
                  <div
                    className="table-scroll"
                    role="region"
                    aria-label="Scrollable query results"
                    tabIndex={0}
                  >
                    <table
                      className="workspace-table"
                      style={{
                        width: "100%",
                        minWidth: Math.max(360, 110 + columns.length * 120),
                        overflowWrap: "break-word",
                      }}
                    >
                      <thead>
                        <tr>
                          <th scope="col">Case ID</th>
                          {columns.map((c) => (
                            <th scope="col" key={c}>
                              {columnLabel(c)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.items.map((row) => (
                          <tr key={row.id}>
                            <th scope="row" style={{ whiteSpace: "normal" }}>
                              <Link
                                href={`/projects/${encodeURIComponent(projectId)}/test-cases/${encodeURIComponent(row.id)}`}
                              >
                                {row.displayId || `Case ${row.caseNumber}`}
                              </Link>
                              {row.archived && (
                                <small style={{ display: "block" }}>
                                  Archived
                                </small>
                              )}
                            </th>
                            {columns.map((col) => (
                              <td key={col} style={{ whiteSpace: "normal" }}>
                                {col.startsWith("custom:") ? (
                                  (() => {
                                    const cell = row.customValues[col.slice(7)];
                                    return !cell
                                      ? "Column not queried; run current criteria again"
                                      : cell.state === "ABSENT"
                                        ? "Absent (never set)"
                                        : cell.state === "NULL"
                                          ? "Not set (null)"
                                          : cell.state === "INVALID"
                                            ? "Invalid stored value; repair in case"
                                            : cell.value === ""
                                              ? 'Empty text ("")'
                                              : typeof cell.value === "boolean"
                                                ? cell.value
                                                  ? "Yes (true)"
                                                  : "No (false)"
                                                : String(cell.value);
                                  })()
                                ) : col === "title" ? (
                                  <>
                                    {row.title}
                                    {row.titleClipped && (
                                      <small style={{ display: "block" }}>
                                        Title clipped; open the case for
                                        complete text.
                                      </small>
                                    )}
                                  </>
                                ) : col === "type" ? (
                                  queryMetric(row.testType)
                                ) : col === "priority" ? (
                                  readableMetric(row.priority)
                                ) : col === "risk" ? (
                                  row.riskScore === null ? (
                                    "Not assessed"
                                  ) : (
                                    `${row.riskScore}/100`
                                  )
                                ) : col === "automation" ? (
                                  readableMetric(row.automationStatus)
                                ) : col === "review" ? (
                                  readableMetric(row.reviewStatus)
                                ) : col === "suite" ? (
                                  <>
                                    {row.suitePath || "Unassigned"}
                                    {row.suiteClipped && (
                                      <small style={{ display: "block" }}>
                                        Suite label clipped.
                                      </small>
                                    )}
                                  </>
                                ) : (
                                  new Date(row.updatedAt).toLocaleString()
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <details style={{ marginTop: 12 }}>
                  <summary>Query limitations</summary>
                  <ul>
                    {result.limitations.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </details>
              </>
            )}
          </>
        )}
      </DialogFrame>
    </>
  );
}
