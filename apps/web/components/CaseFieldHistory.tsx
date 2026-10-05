"use client";
import { useEffect, useState } from "react";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";
import {
  retainedCaseFieldReceipt,
  assertCaseFieldAcknowledgement,
  sameCaseFieldOrigin,
  type CaseFieldReceipt,
} from "@/lib/case-field-origin";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";
import { Modal } from "./Modal";
type Page = RouterOutputs["caseFields"]["history"];
type Preview = RouterOutputs["caseFields"]["previewRestore"];
type Selection = { auditId: string; side: "BEFORE" | "AFTER" };
export function CaseFieldHistory({
  projectId,
  caseId,
}: {
  projectId: string;
  caseId: string;
}) {
  return (
    <History
      key={`${projectId}:${caseId}`}
      projectId={projectId}
      caseId={caseId}
    />
  );
}
function History({ projectId, caseId }: { projectId: string; caseId: string }) {
  const utils = trpcReact.useUtils();
  const access = useCaseFieldAccess(projectId, caseId);
  const [expanded, setExpanded] = useState(false),
    [cursor, setCursor] = useState<
      NonNullable<Page["nextCursor"]> | undefined
    >(),
    [selection, setSelection] = useState<Selection | null>(null),
    [open, setOpen] = useState(false);
  const [pending, setPending] = useState<CaseFieldReceipt<
      RouterInputs["caseFields"]["restore"]
    > | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const query = trpcReact.caseFields.history.useQuery(
    { projectId, caseId, cursor, take: 10 },
    { enabled: expanded && access.authReady, retry: false, staleTime: 0 },
  );
  const fresh =
    access.readable &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.projectId === projectId &&
    query.data.caseId === caseId
      ? query.data
      : null;
  const restore = trpcReact.caseFields.restore.useMutation();
  const pendingReadable =
    access.readable &&
    !!pending &&
    sameCaseFieldOrigin(pending.origin, access.current);
  function show(value: Selection) {
    if (restore.isPending || pending || !fresh) return;
    setSelection(value);
    setNotice(null);
    setOpen(true);
  }
  async function commit(input: RouterInputs["caseFields"]["restore"]) {
    if (
      restore.isPending ||
      !access.origin ||
      !access.canEdit ||
      !access.owns(pending?.origin ?? access.origin, "edit")
    )
      return;
    const attempt = pending ?? {
      input,
      uncertain: false,
      origin: access.origin,
    };
    setPending(attempt);
    setNotice(null);
    try {
      const result = await restore.mutateAsync(attempt.input);
      assertCaseFieldAcknowledgement(result, attempt.input.requestId);
      setPending(null);
      setNotice(
        result.replayed
          ? "Confirmed the previous metadata restore."
          : "Restored reviewed active metadata as a new audited save. Procedures and retained outputs were not replaced.",
      );
      // Consume only the acknowledged original receipt, never another actor's UI.
      if (!access.owns(attempt.origin)) return;
      setOpen(false);
      setSelection(null);
      setCursor(undefined);
      void Promise.all([
        utils.caseFields.history.invalidate({ projectId, caseId }),
        utils.caseFields.get.invalidate({ projectId, caseId }),
        utils.testCases.byId.invalidate({ id: caseId }),
      ]).catch(() => {
        // The mounted access origin never rebases. Retain this acknowledgement
        // notice even while reads fail; render it only under original access.
        setNotice(
          "The metadata restore was acknowledged, but refreshed reads failed. Retry reading; do not submit the accepted restore again.",
        );
      });
    } catch (error) {
      setPending(retainedCaseFieldReceipt(attempt, error));
      if (!access.owns(attempt.origin)) return;
      setNotice(
        error instanceof Error
          ? error.message
          : "Restore response is uncertain. Retry the exact request.",
      );
    }
  }
  return (
    <>
      <details
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>Metadata changes and reviewed restore</summary>
        {!access.readable && (
          <p role="status">
            Original account and workspace access is unavailable. Metadata
            history, drafts and retry requests remain retained but hidden.
          </p>
        )}
        {query.error && (
          <p role="alert">
            Metadata history could not be refreshed.{" "}
            <button type="button" onClick={() => void query.refetch()}>
              Retry
            </button>
          </p>
        )}
        {expanded && !fresh && !query.error && (
          <p role="status">
            {query.isPaused
              ? "Reconnect to load current metadata history."
              : "Loading metadata history…"}
          </p>
        )}
        {fresh && (
          <>
            {!fresh.entries.length && (
              <p>
                No captured metadata audit records yet. Older procedure
                snapshots cannot reconstruct missing metadata.
              </p>
            )}
            <ol>
              {fresh.entries.map((entry) => (
                <li key={entry.auditId} style={{ marginBottom: 12 }}>
                  <strong>{entry.summary}</strong>
                  <p>
                    {new Date(entry.createdAt).toLocaleString()} ·{" "}
                    {entry.actor.label} (current profile)
                    {entry.restoredFromAuditId ? " · Restore-as-new" : ""}
                  </p>
                  <p className="text-muted">
                    {entry.supported
                      ? "Exact metadata/schema evidence is available."
                      : "Legacy or oversized capture: exact metadata is unavailable."}
                  </p>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!!pending || restore.isPending}
                    onClick={() =>
                      show({ auditId: entry.auditId, side: "AFTER" })
                    }
                  >
                    Review recorded values
                  </button>
                </li>
              ))}
            </ol>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {fresh.nextCursor && (
                <button
                  type="button"
                  onClick={() => setCursor(fresh.nextCursor!)}
                >
                  Older metadata records
                </button>
              )}
              {cursor && (
                <button type="button" onClick={() => setCursor(undefined)}>
                  Newest metadata records
                </button>
              )}
            </div>
            <details>
              <summary>History scope</summary>
              {fresh.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </details>
          </>
        )}
      </details>
      {pendingReadable && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setOpen(true)}
        >
          Resume exact metadata restore
        </button>
      )}
      {access.readable && notice && !open && <p role="status">{notice}</p>}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!restore.isPending}
        size="wide"
        title="Review captured case metadata"
        keepMounted={!!selection || !!pending}
      >
        {pending ? (
          pendingReadable ? (
            <>
              <p role="status">
                Request {pending.input.requestId} is retained. Closing this
                dialog does not discard it. Retry its exact identity to confirm
                whether it committed.
              </p>
              {notice && <p role="alert">{notice}</p>}
              <button
                type="button"
                className="btn-primary"
                disabled={restore.isPending || !access.canEdit}
                onClick={() => void commit(pending.input)}
              >
                {restore.isPending
                  ? "Confirming…"
                  : "Retry exact metadata restore"}
              </button>
            </>
          ) : (
            <p role="status">
              The original restore request remains retained but hidden. Return
              to its original account and workspace and refresh current access
              before retrying.
            </p>
          )
        ) : (
          selection && (
            <Comparison
              key={selection.auditId}
              projectId={projectId}
              caseId={caseId}
              selection={selection}
              onSelection={setSelection}
              busy={restore.isPending}
              readable={open && access.readable}
              canEdit={access.canEdit}
              readEnabled={open && access.authReady}
              notice={notice}
              onCommit={(input) => void commit(input)}
            />
          )
        )}
      </Modal>
    </>
  );
}
function Comparison({
  projectId,
  caseId,
  selection,
  onSelection,
  busy,
  readable,
  canEdit,
  readEnabled,
  notice,
  onCommit,
}: {
  projectId: string;
  caseId: string;
  selection: Selection;
  onSelection: (selection: Selection) => void;
  busy: boolean;
  readable: boolean;
  canEdit: boolean;
  readEnabled: boolean;
  notice: string | null;
  onCommit: (input: RouterInputs["caseFields"]["restore"]) => void;
}) {
  const query = trpcReact.caseFields.previewRestore.useQuery(
    { projectId, caseId, ...selection },
    {
      enabled: readEnabled,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
    },
  );
  const [baseline, setBaseline] = useState<Preview | null>(null),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const fresh =
    readable &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.projectId === projectId &&
    query.data.caseId === caseId &&
    query.data.auditId === selection.auditId &&
    query.data.side === selection.side
      ? query.data
      : null;
  useEffect(() => {
    if (!baseline && fresh) setBaseline(fresh);
  }, [baseline, fresh]);
  useEffect(() => {
    if (!fresh || !canEdit) setConfirmed(false);
  }, [fresh, canEdit]);
  const changed =
    !!baseline &&
    !!fresh &&
    (baseline.expectedSchemaHash !== fresh.expectedSchemaHash ||
      baseline.expectedValueHash !== fresh.expectedValueHash ||
      baseline.expectedSourceHash !== fresh.expectedSourceHash);
  const ready =
    !!baseline && !!fresh && !changed && canEdit && fresh.canRestore && !busy;
  function choose(side: Selection["side"]) {
    setBaseline(null);
    setReason("");
    setConfirmed(false);
    onSelection({ ...selection, side });
  }
  function submit() {
    if (!ready || !baseline || !reason.trim() || !confirmed) return;
    onCommit({
      projectId,
      caseId,
      ...selection,
      actorId: baseline.actorId,
      expectedSchemaHash: baseline.expectedSchemaHash,
      expectedValueHash: baseline.expectedValueHash,
      expectedSourceHash: baseline.expectedSourceHash,
      reason: reason.trim(),
      confirmed: true,
      requestId: crypto.randomUUID(),
    });
  }
  // Keep the comparison component and human state mounted; render no private
  // row, definition, reason or cached notice while access/current reads fail.
  if (!readable)
    return (
      <p role="status">
        Original account and workspace access is unavailable. Your comparison
        and reason remain retained but hidden.
      </p>
    );
  return (
    <>
      <label>
        Recorded values
        <select
          value={selection.side}
          disabled={busy || !fresh}
          onChange={(event) => choose(event.target.value as Selection["side"])}
        >
          <option value="AFTER">After this metadata change</option>
          <option value="BEFORE">Before this metadata change</option>
        </select>
      </label>
      {query.error && (
        <p role="alert">
          Comparison could not be refreshed. Cached values cannot authorize a
          restore.{" "}
          <button type="button" onClick={() => void query.refetch()}>
            Retry comparison
          </button>
        </p>
      )}
      {(!baseline || query.isFetching || query.isPaused) && !query.error && (
        <p role="status">
          {query.isPaused
            ? "Reconnect before reviewing current metadata."
            : "Loading current comparison…"}
        </p>
      )}
      {changed && (
        <p role="alert">
          Current values, definitions or captured evidence changed after review.
          Your reason is retained.{" "}
          <button
            type="button"
            onClick={() => {
              setBaseline(fresh);
              setConfirmed(false);
            }}
          >
            Review latest comparison
          </button>
        </p>
      )}
      {baseline && fresh && (
        <>
          <p>
            Captured schema version{" "}
            {baseline.historicalSchemaVersion ?? "unavailable"}. Only eligible
            active values can be restored; retained and later fields are
            identified below.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 650 }}>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Recorded value</th>
                  <th>Current value</th>
                  <th>Proposed value</th>
                  <th>Treatment</th>
                </tr>
              </thead>
              <tbody>
                {baseline.rows.map((row) => (
                  <tr key={row.key}>
                    {[
                      row.label,
                      row.saved,
                      row.current,
                      row.proposed,
                      `${row.treatment}${row.changed ? " (changed)" : " (unchanged)"}`,
                    ].map((value, index) => (
                      <td
                        key={index}
                        style={{
                          maxWidth: 200,
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                          verticalAlign: "top",
                        }}
                      >
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>Captured and current field definitions</summary>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
                gap: 16,
              }}
            >
              {[
                { label: "Captured", schema: baseline.historicalSchema },
                { label: "Current", schema: baseline.currentSchema },
              ].map((item) => (
                <section key={item.label}>
                  <h3>{item.label}</h3>
                  {item.schema ? (
                    <ul>
                      {item.schema.fields.map((field) => (
                        <li key={field.key}>
                          {field.label} ({field.key}):{" "}
                          {field.type.toLowerCase()}
                          {field.required ? ", required" : ", optional"}
                          {field.retired ? ", retired" : ""}
                          {field.options.length
                            ? ` · ${field.options.join(", ")}`
                            : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Exact definitions unavailable.</p>
                  )}
                </section>
              ))}
            </div>
          </details>
          {baseline.warnings.map((warning) => (
            <p role="status" key={warning}>
              {warning}
            </p>
          ))}
          {baseline.problems.map((problem) => (
            <p role="alert" key={problem}>
              {problem}
            </p>
          ))}
          {canEdit && baseline.canRestore && (
            <>
              <label>
                Reason for restoring active values (required)
                <input
                  value={reason}
                  maxLength={1000}
                  disabled={busy}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setConfirmed(false);
                  }}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={!ready}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />{" "}
                I reviewed the proposed active changes and values that will
                remain preserved.
              </label>
              <button
                type="button"
                className="btn-primary"
                disabled={!ready || !confirmed || !reason.trim()}
                onClick={submit}
              >
                Restore reviewed metadata as new save
              </button>
            </>
          )}
        </>
      )}
      {fresh && notice && <p role="alert">{notice}</p>}
    </>
  );
}
