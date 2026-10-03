"use client";

import { useEffect, useState } from "react";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";
import { Modal } from "./Modal";
import { inspectorLabel } from "@/lib/case-inspector";
import {
  retainedTraceabilityReceipt,
  type TraceabilityReceipt,
} from "@/lib/traceability-receipt";

type Preview = RouterOutputs["caseVersionReview"]["preview"];
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
  const list = trpcReact.caseVersionReview.list.useQuery(
    { projectId, testCaseId, take: 10, before: cursors[cursors.length - 1] },
    { enabled: active, retry: false },
  );
  const [version, setVersion] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [baseline, setBaseline] = useState<Preview | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<TraceabilityReceipt<Restore> | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const compare = trpcReact.caseVersionReview.preview.useQuery(
    { projectId, testCaseId, versionNumber: version ?? 1 },
    {
      enabled: open && version !== null && !baseline && !pending,
      retry: false,
      refetchOnWindowFocus: false,
    },
  );
  useEffect(() => {
    if (
      !baseline &&
      !pending &&
      !compare.isFetching &&
      compare.data &&
      compare.data.versionNumber === version
    ) {
      setBaseline(compare.data);
      setFields(
        compare.data.fields
          .filter((f) => f.changed && f.restorable)
          .map((f) => f.key),
      );
    }
  }, [baseline, pending, compare.data, compare.isFetching, version]);
  const restore = trpcReact.caseVersionReview.restore.useMutation();
  function chooseVersion(next: number) {
    if (pending) {
      setOpen(true);
      return;
    }
    setVersion(next);
    setBaseline(null);
    setFields([]);
    setReason("");
    setConfirmed(false);
    setNotice(null);
    setOpen(true);
  }
  async function applyRestore() {
    if (restore.isPending || readOnly || !baseline?.canRestore) return;
    const attempt = pending ?? {
      input: {
        projectId,
        testCaseId,
        versionNumber: baseline.versionNumber,
        expectedCaseRevision: baseline.expectedCaseRevision,
        expectedVersionRevision: baseline.expectedVersionRevision,
        fields,
        reason,
        confirmed: true as const,
        requestId: crypto.randomUUID(),
      },
      uncertain: false,
    };
    if (!pending && (!confirmed || !fields.length || !reason.trim())) return;
    setPending(attempt);
    setNotice(null);
    try {
      const result = await restore.mutateAsync(attempt.input);
      setPending(null);
      setOpen(false);
      setBaseline(null);
      setConfirmed(false);
      setNotice(
        `Restored selected fields from v${result.restoredVersionNumber} as new v${result.createdVersionNumber}${result.replayed ? " (confirmed prior request)" : ""}. Existing risk/design assessments, paid drafts and review decisions were retained and may need renewed review.`,
      );
      void utils.caseVersionReview.list.invalidate({ projectId, testCaseId });
      void utils.testCases.byId.invalidate({ id: testCaseId });
      void utils.testCases.list.invalidate({ projectId });
      void utils.testCases.history.invalidate({ testCaseId });
      onChanged?.();
    } catch (error) {
      const retained = retainedTraceabilityReceipt(attempt, error);
      setPending(retained);
      setNotice(
        retained
          ? "The restore response is uncertain. Your exact reviewed request is retained; retry it to confirm, not to create another restore."
          : "Restore was not applied. Review the error and refresh the comparison if the case changed.",
      );
    }
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
        Compare a saved version with the current case. Restore only the changed
        fields you review.
      </p>
      {notice && !open && <p role="status">{notice}</p>}
      {pending && !open && (
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
                    disabled={Boolean(pending)}
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
                  onClick={() => setCursors((c) => c.slice(0, -1))}
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
        open={open}
        onClose={() => setOpen(false)}
        title={`Compare current case with v${version ?? ""}`}
        dismissible={!restore.isPending}
      >
        {compare.isFetching && !baseline && (
          <p role="status">Loading comparison…</p>
        )}
        {compare.error && !baseline && (
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
        {baseline && (
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
              disabled={restore.isPending || Boolean(pending)}
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
                disabled={restore.isPending || Boolean(pending)}
                onClick={() => {
                  setBaseline(null);
                  setConfirmed(false);
                  setNotice(null);
                  void compare.refetch();
                }}
              >
                Refresh comparison
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={
                  restore.isPending ||
                  readOnly ||
                  !baseline.canRestore ||
                  (!pending && (!confirmed || !reason.trim() || !fields.length))
                }
                onClick={() => void applyRestore()}
              >
                {restore.isPending
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
