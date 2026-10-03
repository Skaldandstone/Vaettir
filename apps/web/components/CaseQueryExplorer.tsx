"use client";
import { useState } from "react";
import Link from "next/link";
import { DialogFrame } from "./ui/DialogFrame";
import { trpcReact } from "@/lib/trpcReact";
import { readableMetric } from "@/lib/frozen-report";
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
type Field = CaseQueryRule["field"];
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
  const [columns, setColumns] = useState<
    Array<(typeof CASE_QUERY_COLUMNS)[number]>
  >(["title", "type", "priority", "risk", "automation"]);
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
    { enabled: open && screen === "results" && !!applied, staleTime: 0 },
  );
  const result =
    open &&
    screen === "results" &&
    applied &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.requestId === applied.requestId
      ? query.data
      : null;
  const totalRules = draft.groups.reduce((sum, g) => sum + g.rules.length, 0);
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
    const parsed = caseQuerySchema.safeParse(draft);
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Review the query conditions.",
      );
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
          Read-only. These criteria and columns are not saved or shared.
        </p>
        {screen === "criteria" ? (
          <>
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
                        value={rule.field}
                        onChange={(e) =>
                          updateRule(gi, ri, newRule(e.target.value as Field))
                        }
                      >
                        {Object.entries(fields).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
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
                    {!["unassigned", "unassessed"].includes(rule.operator) && (
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
                            max={rule.field === "riskScore" ? 100 : undefined}
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
            <details style={{ marginBlock: 12 }}>
              <summary>Displayed columns</summary>
              <fieldset style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                <legend>Case ID is always visible</legend>
                {CASE_QUERY_COLUMNS.map((col) => (
                  <label key={col} style={{ display: "flex", gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={columns.includes(col)}
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
              </fieldset>
            </details>
            {query.error ? (
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
                    exports stay unchanged. This explorer is a separate
                    read-only scope.
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
                </div>
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
                              {readableMetric(c)}
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
                                {col === "title" ? (
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
