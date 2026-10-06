"use client";

import { useState } from "react";
import { trpcReact, type RouterInputs } from "@/lib/trpcReact";
import { Modal } from "./Modal";
import { inspectorLabel } from "@/lib/case-inspector";
import { currentCaseVersionPreview } from "@/lib/case-version-baseline";
import { currentVersionRead } from "@/lib/case-version-draft";
import {
  useCaseVersionAccess,
  useVersionReadNonce,
} from "@/lib/use-case-version-access";
import { useCaseVersionRestore } from "@/lib/use-case-version-restore";

type Restore = RouterInputs["caseVersionReview"]["restore"];
type Field = Restore["fields"][number];

function ComparisonValue({ value, field }: { value: string; field: Field }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = value;
  }
  const textStyle = {
    whiteSpace: "pre-wrap" as const,
    overflowWrap: "anywhere" as const,
  };
  if (parsed === null) return <p className="muted">Not recorded.</p>;
  if (typeof parsed === "string")
    return (
      <p style={textStyle}>
        {["priority", "testType", "validationDomain"].includes(field)
          ? inspectorLabel(parsed)
          : parsed || "Empty text"}
      </p>
    );
  if (Array.isArray(parsed)) {
    if (!parsed.length) return <p className="muted">No entries recorded.</p>;
    if (parsed.every((entry) => typeof entry === "string"))
      return (
        <ol style={{ paddingLeft: 22 }}>
          {parsed.map((entry, index) => (
            <li key={index} style={textStyle}>
              {entry || "Empty text"}
            </li>
          ))}
        </ol>
      );
    if (
      field === "steps" &&
      parsed.every(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          typeof entry.action === "string",
      )
    )
      return (
        <ol style={{ paddingLeft: 22 }}>
          {parsed.map((entry, index) => {
            const step = entry as Record<string, unknown>;
            return (
              <li key={index} style={{ marginBottom: 14 }}>
                <strong>Action</strong>
                <p style={textStyle}>{String(step.action)}</p>
                <dl>
                  {(
                    [
                      "expectedActionOrData",
                      "expectedResult",
                      "expectedResponse",
                    ] as const
                  ).map((key) => (
                    <div key={key}>
                      <dt className="muted">
                        {key === "expectedActionOrData"
                          ? "Expected action / data"
                          : key === "expectedResult"
                            ? "Expected result"
                            : "Expected response"}
                      </dt>
                      <dd style={{ ...textStyle, margin: "0 0 8px" }}>
                        {typeof step[key] === "string"
                          ? String(step[key])
                          : "Not recorded"}
                      </dd>
                    </div>
                  ))}
                </dl>
                {Array.isArray(step.mediaAttachmentIds) &&
                  step.mediaAttachmentIds.length > 0 && (
                    <p style={textStyle}>
                      Recorded image/video references:{" "}
                      {step.mediaAttachmentIds.join(", ")}
                    </p>
                  )}
              </li>
            );
          })}
        </ol>
      );
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    Object.values(parsed).every((entry) => typeof entry === "string")
  )
    return (
      <dl>
        {Object.entries(parsed).map(([key, entry]) => (
          <div key={key}>
            <dt className="muted">
              {inspectorLabel(key.replace(/([a-z])([A-Z])/g, "$1 $2"))}
            </dt>
            <dd style={{ ...textStyle, margin: "0 0 8px" }}>
              {String(entry) || "Empty text"}
            </dd>
          </div>
        ))}
      </dl>
    );
  return (
    <details>
      <summary>Unsupported stored format</summary>
      <pre style={{ ...textStyle, fontSize: 12 }}>{value}</pre>
    </details>
  );
}

export function TestCaseVersionReview({
  projectId,
  testCaseId,
  active = true,
  readOnly = false,
  onChanged,
}: {
  projectId: string;
  testCaseId: string;
  active?: boolean;
  readOnly?: boolean;
  onChanged?: () => void;
}) {
  const utils = trpcReact.useUtils();
  const [cursors, setCursors] = useState<Array<number | undefined>>([
    undefined,
  ]);
  const reads = useCaseVersionAccess(projectId, testCaseId, active);
  const before = cursors[cursors.length - 1];
  const listCycle = useVersionReadNonce(
    JSON.stringify([active, reads.activation, before]),
  );
  const pins = reads.origin
    ? {
        originalOrganizationId: reads.origin.organizationId,
        expectedClerkActorId: reads.origin.clerkActorId,
      }
    : {};
  const listQuery = trpcReact.caseVersionReview.list.useQuery(
    {
      projectId,
      testCaseId,
      take: 10,
      before,
      ...pins,
      readRequestId: listCycle.requestId,
    },
    {
      enabled: active && reads.readable && listCycle.ready,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  );
  const admittedList = currentVersionRead(
    listQuery,
    reads.origin,
    active && reads.readable && listCycle.ready,
    listCycle.requestId,
    { kind: "LIST", take: 10, before: before ?? null },
  );
  const list = {
    ...listQuery,
    data: admittedList ?? undefined,
    error: reads.readable ? listQuery.error : null,
  };
  const [version, setVersion] = useState<number | null>(null);
  const [fromVersion, setFromVersion] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [comparisonEpoch, setComparisonEpoch] = useState(0);
  const compareCycle = useVersionReadNonce(
    JSON.stringify([
      open,
      active,
      reads.activation,
      version,
      fromVersion,
      comparisonEpoch,
    ]),
  );
  const compareQuery = trpcReact.caseVersionReview.preview.useQuery(
    {
      projectId,
      testCaseId,
      versionNumber: version ?? 1,
      ...pins,
      readRequestId: compareCycle.requestId,
    },
    {
      enabled:
        active &&
        reads.readable &&
        compareCycle.ready &&
        open &&
        version !== null &&
        fromVersion === null,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  );
  const historicalCycle = useVersionReadNonce(
    JSON.stringify([
      open,
      active,
      reads.activation,
      fromVersion,
      version,
      comparisonEpoch,
    ]),
  );
  const historicalQuery =
    trpcReact.caseVersionReview.compareHistorical.useQuery(
      {
        projectId,
        testCaseId,
        fromVersionNumber: fromVersion ?? 1,
        toVersionNumber: version ?? 1,
        ...pins,
        readRequestId: historicalCycle.requestId,
      },
      {
        enabled:
          active &&
          reads.readable &&
          historicalCycle.ready &&
          open &&
          fromVersion !== null &&
          version !== null,
        retry: false,
        refetchOnWindowFocus: false,
      },
    );
  const admittedPreview = currentVersionRead(
    compareQuery,
    reads.origin,
    active && reads.readable && compareCycle.ready,
    compareCycle.requestId,
    { kind: "CURRENT", versionNumber: version ?? 1 },
  );
  const compare = { ...compareQuery, data: admittedPreview ?? undefined };
  const freshPreview = currentCaseVersionPreview(compare, version);
  const admittedHistorical = currentVersionRead(
    historicalQuery,
    reads.origin,
    active && reads.readable && historicalCycle.ready,
    historicalCycle.requestId,
    {
      kind: "HISTORICAL",
      fromVersionNumber: fromVersion ?? 1,
      toVersionNumber: version ?? 1,
    },
  );
  const historical = {
    ...historicalQuery,
    data: admittedHistorical ?? undefined,
  };
  const restore = trpcReact.caseVersionReview.restoreReviewed.useMutation();
  const editor = useCaseVersionRestore({
    projectId,
    testCaseId,
    active,
    open,
    version,
    fromVersion,
    readOnly,
    reads,
    preview: freshPreview,
    mutation: restore,
    navigationActivation: listCycle.requestId,
    navigationReady: !!admittedList,
    afterConfirmed: () => {
      setOpen(false);
      setComparisonEpoch((value) => value + 1);
      reads.refresh();
      void Promise.all([
        utils.caseVersionReview.list.invalidate({ projectId, testCaseId }),
        utils.testCases.byId.invalidate({ id: testCaseId }),
        utils.testCases.list.invalidate({ projectId }),
        utils.testCases.history.invalidate({ testCaseId }),
      ]).catch(() => {});
      onChanged?.();
    },
  });
  const baseline = editor.draft?.baseline ?? null,
    fields = editor.draft?.fields ?? [],
    reason = editor.draft?.reason ?? "",
    confirmed = editor.draft?.confirmed ?? false,
    pending = editor.pending,
    notice = editor.notice;
  const setFields = (next: (value: Field[]) => Field[]) =>
    editor.change({ fields: next(editor.draftRef.current?.fields ?? []) });
  const setReason = (value: string) => editor.change({ reason: value });
  const setConfirmed = (value: boolean) => editor.change({ confirmed: value });
  const applyRestore = editor.commit;
  function changeComparison(nextVersion: number, nextFrom: number | null) {
    if (!editor.clearComparison()) return;
    setVersion(nextVersion);
    setFromVersion(nextFrom);
    setComparisonEpoch((value) => value + 1);
  }
  function chooseVersion(next: number) {
    if (!active || !reads.readable || editor.busyRef.current) return;
    if (editor.pendingRef.current) {
      setOpen(true);
      return;
    }
    if (!editor.clearComparison(true)) return;
    setVersion(next);
    setFromVersion(null);
    setComparisonEpoch((value) => value + 1);
    setOpen(true);
  }
  return (
    <section
      aria-label="Case changes"
      style={{
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
      }}
    >
      <h3>Case changes</h3>
      <p className="muted">
        Compare the current case or any two saved versions. Restore only from a
        separately reviewed current-case comparison.
      </p>
      {active && !reads.readable && (
        <p role="status">
          Verify current original access to load case versions. Any pending
          restore stays retained.
        </p>
      )}
      {notice && !open && active && reads.readable && (
        <p role="status">{notice}</p>
      )}
      {pending && !open && active && reads.readable && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setOpen(true)}
        >
          Review pending restore
        </button>
      )}
      {list.isFetching && <p role="status">Loading case versions…</p>}
      {list.error ? (
        <div role="alert">
          <p>Case changes could not be loaded. {list.error.message}</p>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => void list.refetch()}
          >
            Retry versions
          </button>
        </div>
      ) : (
        list.data && (
          <>
            {list.data.restorationNotice && (
              <p role="note">{list.data.restorationNotice}</p>
            )}
            {!list.data.items.length && (
              <p>No saved case versions are available.</p>
            )}
            <ol
              style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}
            >
              {list.data.items.map((v) => (
                <li
                  key={v.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <span>
                    <strong>v{v.versionNumber}</strong> ·{" "}
                    <time dateTime={v.createdAt}>
                      {new Date(v.createdAt).toLocaleString()}
                    </time>
                    <small style={{ display: "block" }}>
                      {v.createdBy
                        ? `Changed by ${v.createdBy.label} (current profile)`
                        : "Change author not recorded"}
                    </small>
                    {v.restoration && (
                      <small
                        style={{ display: "block", overflowWrap: "anywhere" }}
                      >
                        Restored from v{v.restoration.restoredVersionNumber}:{" "}
                        {v.restoration.reason}
                      </small>
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={editor.busy || Boolean(pending)}
                    onClick={() => chooseVersion(v.versionNumber)}
                  >
                    Compare v{v.versionNumber}
                  </button>
                </li>
              ))}
            </ol>
            <nav
              aria-label="Case version pages"
              style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
            >
              {cursors.length > 1 && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={list.isFetching}
                  onClick={() => {
                    if (editor.canBrowse()) setCursors((c) => c.slice(0, -1));
                  }}
                >
                  Newer versions
                </button>
              )}
              {list.data.nextCursor !== null && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={list.isFetching}
                  onClick={() =>
                    editor.canBrowse() &&
                    setCursors((c) => [...c, list.data!.nextCursor!])
                  }
                >
                  Older versions
                </button>
              )}
            </nav>
          </>
        )
      )}
      <Modal
        size="wide"
        open={open && active && reads.readable}
        onClose={() => {
          editor.closeFrame();
          setOpen(false);
        }}
        title={
          fromVersion === null
            ? `Compare current case with v${version ?? ""}`
            : `Compare saved v${fromVersion} with v${version ?? ""}`
        }
        dismissible={!editor.busy}
      >
        {version !== null && (
          <fieldset
            disabled={editor.busy || Boolean(pending)}
            style={{ border: 0, padding: 0, minWidth: 0 }}
          >
            <legend>Choose comparison versions</legend>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(min(100%, 200px), 1fr))",
                gap: 12,
              }}
            >
              <label style={{ display: "grid", gap: 6 }}>
                From
                <select
                  value={fromVersion ?? "current"}
                  onChange={(e) =>
                    changeComparison(
                      version,
                      e.target.value === "current"
                        ? null
                        : Number(e.target.value),
                    )
                  }
                >
                  <option value="current">Current case (restore review)</option>
                  {[
                    ...new Set([
                      ...(list.data?.items.map((v) => v.versionNumber) ?? []),
                      version,
                      ...(fromVersion === null ? [] : [fromVersion]),
                    ]),
                  ]
                    .sort((a, b) => b - a)
                    .map((number) => (
                      <option key={number} value={number}>
                        Saved v{number}
                      </option>
                    ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                To
                <select
                  value={version}
                  onChange={(e) =>
                    changeComparison(Number(e.target.value), fromVersion)
                  }
                >
                  {[
                    ...new Set([
                      ...(list.data?.items.map((v) => v.versionNumber) ?? []),
                      version,
                      ...(fromVersion === null ? [] : [fromVersion]),
                    ]),
                  ]
                    .sort((a, b) => b - a)
                    .map((number) => (
                      <option key={number} value={number}>
                        Saved v{number}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <p className="muted">
              Browse saved versions below to choose either side. Selected
              versions stay available when you change pages.
            </p>
            <nav
              aria-label="Comparison version pages"
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
            >
              {cursors.length > 1 && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={list.isFetching}
                  onClick={() => {
                    if (editor.canBrowse()) setCursors((c) => c.slice(0, -1));
                  }}
                >
                  Browse newer versions
                </button>
              )}
              {list.data?.nextCursor != null && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={list.isFetching}
                  onClick={() =>
                    editor.canBrowse() &&
                    setCursors((c) => [...c, list.data!.nextCursor!])
                  }
                >
                  Browse older versions
                </button>
              )}
              {list.error && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void list.refetch()}
                >
                  Retry version choices
                </button>
              )}
            </nav>
            {list.isFetching && <p role="status">Loading version choices…</p>}
            {list.error && (
              <p role="alert">
                Additional version choices could not be loaded.{" "}
                {list.error.message}
              </p>
            )}
          </fieldset>
        )}
        {fromVersion === null && compare.isFetching && !baseline && (
          <p role="status">Loading comparison…</p>
        )}
        {fromVersion === null && compare.isPaused && !baseline && (
          <p role="status">
            Waiting for a connection to refresh the comparison. Restore is
            unavailable until a current comparison succeeds.
          </p>
        )}
        {fromVersion === null && compare.error && !baseline && (
          <div role="alert">
            <p>Comparison could not be loaded. {compare.error.message}</p>
            <button
              className="btn-secondary"
              type="button"
              onClick={() => void compare.refetch()}
            >
              Retry comparison
            </button>
          </div>
        )}
        {fromVersion !== null && historical.isFetching && (
          <p role="status">Loading saved-version comparison…</p>
        )}
        {fromVersion !== null && historical.error && (
          <div role="alert">
            <p>
              Saved-version comparison could not be loaded.{" "}
              {historical.error.message}
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void historical.refetch()}
            >
              Retry saved comparison
            </button>
          </div>
        )}
        {fromVersion !== null &&
          historical.data &&
          historical.data.from.versionNumber === fromVersion &&
          historical.data.to.versionNumber === version &&
          !historical.error && (
            <>
              <p>
                <strong>{historical.data.displayId}</strong> · Saved v
                {fromVersion} → saved v{version}
              </p>
              <p role="note">
                Historical comparison only. Neither side is the current case or
                a write baseline.
              </p>
              <details style={{ margin: "8px 0" }}>
                <summary>Snapshot limitations</summary>
                <ul>
                  {historical.data.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </details>
              {historical.data.fields.map((field) => (
                <details
                  key={`${fromVersion}-${version}-${field.key}`}
                  open={field.changed}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 6,
                    padding: 8,
                    margin: "8px 0",
                  }}
                >
                  <summary>
                    {field.label} · {field.changed ? "Changed" : "Unchanged"}
                  </summary>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(min(100%, 200px), 1fr))",
                      gap: 12,
                    }}
                  >
                    <div>
                      <strong>Saved v{fromVersion}</strong>
                      <ComparisonValue value={field.from} field={field.key} />
                    </div>
                    <div>
                      <strong>Saved v{version}</strong>
                      <ComparisonValue value={field.to} field={field.key} />
                    </div>
                  </div>
                </details>
              ))}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => changeComparison(version!, null)}
              >
                {readOnly
                  ? `Compare v${version} with current`
                  : `Review restoring v${version} to current`}
              </button>
            </>
          )}
        {fromVersion === null && baseline && (
          <>
            <p>
              <strong>{baseline.displayId}</strong> · Saved v
              {baseline.versionNumber}
            </p>
            <p>
              No credits are used. This changes selected current fields, not
              existing run evidence or old versions.
            </p>
            <ul>
              {baseline.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <fieldset
              disabled={
                editor.busy ||
                Boolean(pending) ||
                readOnly ||
                !reads.fresh?.canRecover
              }
              style={{ border: 0, padding: 0, minWidth: 0 }}
            >
              <legend>Review and select changed fields to restore</legend>
              {baseline.fields.map((field) => (
                <details
                  key={field.key}
                  open={field.changed}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 6,
                    padding: 8,
                    margin: "8px 0",
                  }}
                >
                  <summary>
                    {field.label} · {field.changed ? "Changed" : "Unchanged"}
                    {!field.restorable ? " · Preserved" : ""}
                  </summary>
                  {field.reason && <p role="note">{field.reason}</p>}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(min(100%, 200px), 1fr))",
                      gap: 12,
                    }}
                  >
                    <div>
                      <strong>Current</strong>
                      <ComparisonValue
                        value={field.current}
                        field={field.key}
                      />
                    </div>
                    <div>
                      <strong>Saved v{baseline.versionNumber}</strong>
                      <ComparisonValue value={field.saved} field={field.key} />
                    </div>
                  </div>
                  <label
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <input
                      type="checkbox"
                      checked={fields.includes(field.key)}
                      disabled={
                        readOnly ||
                        !baseline.canRestore ||
                        !field.changed ||
                        !field.restorable
                      }
                      onChange={(e) =>
                        setFields((c) =>
                          e.target.checked
                            ? [...c, field.key]
                            : c.filter((k) => k !== field.key),
                        )
                      }
                    />
                    Restore {field.label.toLowerCase()}
                  </label>
                </details>
              ))}
              {readOnly || !baseline.canRestore ? (
                <p>
                  A current full editor seat is required to restore. Comparison
                  remains available.
                </p>
              ) : (
                <>
                  <label style={{ display: "grid", gap: 6 }}>
                    Reason for this restore (required)
                    <textarea
                      maxLength={1000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={3}
                    />
                  </label>
                  <label
                    style={{
                      display: "flex",
                      gap: 8,
                      margin: "12px 0",
                      alignItems: "start",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I reviewed the selected fields and want to create a new case
                    version.
                  </label>
                </>
              )}
            </fieldset>
            {notice && <p role="status">{notice}</p>}
            {restore.error && <p role="alert">{restore.error.message}</p>}
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginTop: 12,
              }}
            >
              <button
                type="button"
                className="btn-secondary"
                disabled={editor.busy || Boolean(pending)}
                onClick={() => {
                  if (!editor.clearComparison()) return;
                  setComparisonEpoch((value) => value + 1);
                }}
              >
                Refresh comparison
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!editor.canCommit}
                onClick={() => void applyRestore()}
              >
                {editor.busy
                  ? "Restoring…"
                  : pending
                    ? "Retry reviewed restore"
                    : `Restore ${fields.length} selected fields`}
              </button>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}
