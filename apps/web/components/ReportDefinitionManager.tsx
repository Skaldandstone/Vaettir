"use client";
import { useState } from "react";
import { Modal } from "./Modal";
import { trpcReact, type RouterInputs } from "@/lib/trpcReact";
import { readableMetric } from "@/lib/frozen-report";
import {
  reportDefinitionSchema,
  type ReportDefinition,
} from "@vaettir/api/src/services/reportDefinitionSchema";
import { ReportDefinitionSettingsEditor } from "./ReportDefinitionSettingsEditor";
type Request = RouterInputs["reportSnapshots"]["manageDefinition"];
export function ReportDefinitionManager({ projectId }: { projectId: string }) {
  return <Manager key={projectId} projectId={projectId} />;
}
function Manager({ projectId }: { projectId: string }) {
  const [expanded, setExpanded] = useState(false),
    [page, setPage] = useState(0),
    [archives, setArchives] = useState(false);
  const [id, setId] = useState(""),
    [open, setOpen] = useState(false),
    [pending, setPending] = useState<Request | null>(null),
    [message, setMessage] = useState("");
  const query = trpcReact.reportSnapshots.definitionCatalog.useQuery(
    { projectId, page, includeArchived: archives },
    { enabled: expanded, staleTime: 0 },
  );
  const data =
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.projectId === projectId &&
    query.data.page === page &&
    query.data.includeArchived === archives
      ? query.data
      : null;
  return (
    <details
      style={{ marginBlock: 16 }}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>Manage reusable report definitions</summary>
      <p>
        Reuse settings, archive without deleting, review sharing or recover a
        recorded version. Captured reports remain separate and unchanged.
      </p>
      <label>
        <input
          type="checkbox"
          checked={archives}
          disabled={!!pending}
          onChange={(event) => {
            setArchives(event.target.checked);
            setPage(0);
          }}
        />{" "}
        Include archived definitions
      </label>
      {message && <p role="status">{message}</p>}
      {pending && (
        <p role="status">
          An exact change request is retained.{" "}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setId(pending.id);
              setOpen(true);
            }}
          >
            Resume the same request
          </button>
        </p>
      )}
      {query.error ? (
        <div role="alert">
          <p>
            Definitions could not be verified. No cached names or empty results
            were substituted.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void query.refetch()}
          >
            Retry definitions
          </button>
        </div>
      ) : expanded && !data ? (
        <p role="status">
          {query.isPaused
            ? "Waiting to verify workspace access…"
            : "Loading reusable definitions…"}
        </p>
      ) : (
        data && (
          <>
            <p>
              {data.total} retained matching definitions. Page {page + 1}.
            </p>
            {!data.items.length ? (
              <p>
                No definitions on this page. Reset paging or create a reusable
                definition in the report wizard.
              </p>
            ) : (
              <div className="table-scroll">
                <table className="workspace-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th scope="col">Definition</th>
                      <th scope="col">Visibility / state</th>
                      <th scope="col">Version</th>
                      <th scope="col">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row) => (
                      <tr key={row.id}>
                        <th
                          scope="row"
                          style={{
                            whiteSpace: "normal",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {row.name}
                        </th>
                        <td>
                          {row.visibility === "project"
                            ? "Project members"
                            : "Private"}{" "}
                          · {row.archivedAt ? "Archived" : "Active"}
                        </td>
                        <td>{row.version}</td>
                        <td>
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={!!pending && pending.id !== row.id}
                            onClick={() => {
                              setId(row.id);
                              setOpen(true);
                            }}
                          >
                            {row.canManage
                              ? "Manage / history"
                              : "View history"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
                disabled={!page || !!pending}
                onClick={() => setPage(page - 1)}
              >
                Previous definitions
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={!data.hasMore || page >= 9 || !!pending}
                onClick={() => setPage(page + 1)}
              >
                Next definitions
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={!!pending}
                onClick={() => setPage(0)}
              >
                First page
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void query.refetch()}
              >
                Refresh definitions
              </button>
            </div>
            <ul>
              {data.limitations.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </>
        )
      )}
      {id && (
        <DefinitionReview
          key={id}
          projectId={projectId}
          id={id}
          open={open}
          onClose={() => setOpen(false)}
          pending={pending}
          setPending={setPending}
          onSaved={() => {
            setOpen(false);
            setMessage(
              "Reviewed change saved as a new version. Existing captures and historical receipts are unchanged.",
            );
            void query.refetch();
          }}
        />
      )}
    </details>
  );
}
function DefinitionReview({
  projectId,
  id,
  open,
  onClose,
  pending,
  setPending,
  onSaved,
}: {
  projectId: string;
  id: string;
  open: boolean;
  onClose: () => void;
  pending: Request | null;
  setPending: (value: Request | null) => void;
  onSaved: () => void;
}) {
  const utils = trpcReact.useUtils();
  const [page, setPage] = useState(0),
    [step, setStep] = useState(0),
    [kind, setKind] = useState<
      "settings" | "rename" | "visibility" | "archive" | "restore"
    >("rename");
  const [name, setName] = useState(""),
    [receiptKey, setReceiptKey] = useState(""),
    [side, setSide] = useState<"before" | "after">("after");
  const [reason, setReason] = useState(""),
    [sharing, setSharing] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [message, setMessage] = useState("");
  const [definitiveRefusal, setDefinitiveRefusal] = useState(false);
  const [settings, setSettings] = useState<{
    definition: ReportDefinition;
    version: number;
  } | null>(null);
  const [settingsScreen, setSettingsScreen] = useState(0);
  const [reviewedVersion, setReviewedVersion] = useState(0);
  const query = trpcReact.reportSnapshots.definitionHistory.useQuery(
    { projectId, id, page },
    { enabled: open, staleTime: 0 },
  );
  const mutation = trpcReact.reportSnapshots.manageDefinition.useMutation();
  const data =
    open &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.projectId === projectId &&
    query.data.id === id &&
    query.data.page === page
      ? query.data
      : null;
  const locked = !!pending || mutation.isPending;
  const receipt = data?.items.find((row) => row.key === receiptKey);
  const restored = side === "before" ? receipt?.before : receipt?.after;
  const settingsChecked = settings
    ? reportDefinitionSchema.safeParse(settings.definition)
    : null;
  const action: Request["action"] | null = !data
    ? null
    : kind === "settings"
      ? settingsChecked?.success
        ? { kind, definition: settingsChecked.data }
        : null
      : kind === "rename"
        ? { kind, name: name.trim() }
        : kind === "visibility"
          ? {
              kind,
              visibility:
                data.current.visibility === "private" ? "project" : "private",
            }
          : kind === "archive"
            ? { kind, archived: !data.current.archived }
            : restored
              ? { kind, receiptKey, side }
              : null;
  const target = !data
    ? null
    : kind === "restore"
      ? restored
      : {
          ...data.current,
          definition:
            action?.kind === "settings"
              ? action.definition
              : data.current.definition,
          name: action?.kind === "rename" ? action.name : data.current.name,
          visibility:
            action?.kind === "visibility"
              ? action.visibility
              : data.current.visibility,
          archived:
            action?.kind === "archive"
              ? action.archived
              : data.current.archived,
        };
  const needsSharing =
    pending?.approveProjectSharing || target?.visibility === "project";
  async function save() {
    if (
      !data ||
      !data.canManage ||
      mutation.isPending ||
      (!pending &&
        (!action ||
          !confirmed ||
          !reason.trim() ||
          reviewedVersion !== data.current.version ||
          (needsSharing && !sharing)))
    )
      return;
    const request = pending ?? {
      projectId,
      id,
      version: reviewedVersion,
      requestId: crypto.randomUUID(),
      action: action!,
      reason: reason.trim(),
      approve: true as const,
      approveProjectSharing: sharing,
    };
    setPending(request);
    setMessage("");
    setDefinitiveRefusal(false);
    try {
      await mutation.mutateAsync(request);
    } catch (error) {
      const code = (error as { data?: { code?: string } } | null)?.data?.code;
      const refused =
        !!code &&
        [
          "CONFLICT",
          "BAD_REQUEST",
          "FORBIDDEN",
          "PRECONDITION_FAILED",
          "NOT_FOUND",
        ].includes(code);
      setDefinitiveRefusal(refused);
      setMessage(
        `${error instanceof Error ? error.message : "The outcome is unavailable."} ${refused ? "The server refused this attempt. Review current history before discarding this review; a prior attempt may already have applied." : "The outcome is unknown. The exact request is retained; retry the same request after access is restored."}`,
      );
      return;
    }
    // Acknowledgement and refresh are separate: a failed refresh must never
    // turn a successful write into an unknown outcome or duplicate submission.
    setPending(null);
    setConfirmed(false);
    setSharing(false);
    setStep(0);
    onSaved();
    try {
      await Promise.all([
        utils.reportSnapshots.definitions.invalidate({ projectId }),
        utils.reportSnapshots.definitionCatalog.invalidate({ projectId }),
        utils.reportSnapshots.definitionHistory.invalidate({ projectId, id }),
      ]);
    } catch {
      setMessage(
        "The change was acknowledged as saved. Refresh is unavailable; reopen history to verify the current version. No repeat write is needed.",
      );
    }
  }
  const shown = pending ? null : target;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Review reusable report definition"
      size="wide"
      dismissible={!mutation.isPending}
    >
      {query.error ? (
        <div role="alert">
          <p>
            Definition history/access could not be verified. No cached body is
            shown.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void query.refetch()}
          >
            Retry history
          </button>
        </div>
      ) : !data ? (
        <p role="status">
          {query.isPaused
            ? "Waiting to verify definition access…"
            : "Loading current definition and retained history…"}
        </p>
      ) : (
        <>
          <h3>{data.current.name}</h3>
          <p>
            Current version {data.current.version} ·{" "}
            {data.current.visibility === "project"
              ? "Visible to project members"
              : "Private to the author"}{" "}
            · {data.current.archived ? "Archived" : "Active"}
          </p>
          {!data.canManage && (
            <p>
              Read-only history. Private changes require the author with a full
              editor seat; project-shared changes require a full-seat
              Owner/Admin.
            </p>
          )}
          {pending ? (
            <>
              <p role="status">
                Pending exact {pending.action.kind} request against version{" "}
                {pending.version}. Its reason and approval are retained
                unchanged.
              </p>
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {pending.reason}
              </p>
              <button
                type="button"
                className="btn-primary"
                disabled={!data.canManage || mutation.isPending}
                onClick={() => void save()}
              >
                Retry same reviewed change
              </button>
              {definitiveRefusal && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={mutation.isPending}
                  onClick={() => {
                    setPending(null);
                    setDefinitiveRefusal(false);
                    setConfirmed(false);
                    setSharing(false);
                    setStep(0);
                    setMessage(
                      "Refused review discarded. Verify current history and create a new review; this does not undo any prior applied version.",
                    );
                    void query.refetch();
                  }}
                >
                  Discard refused review and refresh
                </button>
              )}
            </>
          ) : (
            data.canManage && (
              <>
                <p className="eyebrow">
                  Step {step + 1} of 2 ·{" "}
                  {step === 0 ? "Choose change" : "Review change"}
                </p>
                {step === 0 ? (
                  <div style={{ display: "grid", gap: 12 }}>
                    <label>
                      Change
                      <select
                        value={kind}
                        onChange={(event) => {
                          const selected = event.target.value as typeof kind;
                          setKind(selected);
                          if (selected === "settings" && !settings) {
                            setSettings({
                              definition: data.current.definition,
                              version: data.current.version,
                            });
                            setSettingsScreen(0);
                          }
                          setConfirmed(false);
                          setSharing(false);
                        }}
                      >
                        <option value="settings">
                          Edit audience, metrics, scope and notes
                        </option>
                        <option value="rename">Rename</option>
                        {data.canShare && (
                          <option value="visibility">
                            {data.current.visibility === "project"
                              ? "Make private to the author"
                              : "Share with project members"}
                          </option>
                        )}
                        <option value="archive">
                          {data.current.archived
                            ? "Reactivate"
                            : "Archive without deleting"}
                        </option>
                        <option value="restore">
                          Restore recorded settings as a new version
                        </option>
                      </select>
                    </label>
                    {kind === "settings" && settings && (
                      <>
                        <ReportDefinitionSettingsEditor
                          projectId={projectId}
                          value={settings.definition}
                          onChange={(definition) => {
                            setSettings({ ...settings, definition });
                            setConfirmed(false);
                            setSharing(false);
                          }}
                          screen={settingsScreen}
                          onScreen={setSettingsScreen}
                          active={open && !!data && !locked}
                        />
                        {settings.version !== data.current.version && (
                          <div role="alert">
                            <p>
                              Your edits started from version {settings.version}
                              ; current version is {data.current.version}. Edits
                              are retained, not automatically rebased. Inspect
                              current history before reviewing them against a
                              newer head.
                            </p>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => {
                                setSettings({
                                  ...settings,
                                  version: data.current.version,
                                });
                                setConfirmed(false);
                                setSharing(false);
                              }}
                            >
                              Keep edits and review against current version
                            </button>
                          </div>
                        )}
                        {settingsChecked && !settingsChecked.success && (
                          <p role="alert">
                            Settings are incomplete or unsupported. Choose at
                            least one metric section and valid bounded
                            scope/dates before review.
                          </p>
                        )}
                      </>
                    )}
                    {kind === "rename" && (
                      <label>
                        New name
                        <input
                          value={name}
                          maxLength={80}
                          onChange={(event) => setName(event.target.value)}
                        />
                      </label>
                    )}
                    {kind === "restore" && (
                      <>
                        <label>
                          Retained history on this page
                          <select
                            value={receiptKey}
                            onChange={(event) => {
                              setReceiptKey(event.target.value);
                              setConfirmed(false);
                            }}
                          >
                            <option value="">Choose a recorded write</option>
                            {data.items.map((row) => (
                              <option
                                key={row.key}
                                value={row.key}
                                disabled={!row.before && !row.after}
                              >
                                Applied version {row.appliedVersion} ·{" "}
                                {new Date(row.createdAt).toLocaleString()}
                                {!row.before && !row.after
                                  ? " · retained body unavailable"
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Restore which state?
                          <select
                            value={side}
                            onChange={(event) =>
                              setSide(event.target.value as typeof side)
                            }
                          >
                            <option value="after">
                              State after that write
                            </option>
                            <option value="before">
                              State before that write
                            </option>
                          </select>
                        </label>
                        {receipt && !restored && (
                          <p role="alert">
                            This side has no supported retained body. Nothing
                            will be reconstructed.
                          </p>
                        )}
                      </>
                    )}
                    {(kind !== "settings" || settingsScreen === 3) && (
                      <label>
                        Reason
                        <textarea
                          value={reason}
                          maxLength={1000}
                          onChange={(event) => setReason(event.target.value)}
                          style={{ width: "100%", boxSizing: "border-box" }}
                        />
                      </label>
                    )}
                    {(kind !== "settings" || settingsScreen === 3) && (
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={
                          !action ||
                          !reason.trim() ||
                          (kind === "settings" &&
                            (!settings ||
                              settingsScreen !== 3 ||
                              settings.version !== data.current.version)) ||
                          (action.kind === "rename" && !action.name)
                        }
                        onClick={() => {
                          setStep(1);
                          setReviewedVersion(
                            kind === "settings" && settings
                              ? settings.version
                              : data.current.version,
                          );
                          setConfirmed(false);
                          setSharing(false);
                        }}
                      >
                        Review proposed change
                      </button>
                    )}
                  </div>
                ) : (
                  shown && (
                    <>
                      <p>
                        Review against version {reviewedVersion}. This saves
                        reusable settings only; no capture, evidence refresh or
                        existing report changes.
                      </p>
                      {reviewedVersion !== data.current.version && (
                        <p role="alert">
                          Current version changed. Go back, inspect the new
                          history and review again. Your written edits remain
                          retained.
                        </p>
                      )}
                      <p>
                        <strong>{shown.name}</strong> ·{" "}
                        {shown.visibility === "project"
                          ? "Project members"
                          : "Private"}{" "}
                        · {shown.archived ? "Archived" : "Active"}
                      </p>
                      <p>
                        Audience: {readableMetric(shown.definition.audience)}.
                        Sections:{" "}
                        {shown.definition.sections
                          .map(readableMetric)
                          .join(", ")}
                        . Window: {shown.definition.windowDays} days
                        {shown.definition.dateInterval
                          ? `; exact dates ${shown.definition.dateInterval.start} to ${shown.definition.dateInterval.end}`
                          : ""}
                        .
                      </p>
                      <details>
                        <summary>
                          Complete stored settings and author commentary
                        </summary>
                        <pre
                          style={{
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {JSON.stringify(shown.definition, null, 2)}
                        </pre>
                      </details>
                      {kind === "settings" && (
                        <details>
                          <summary>
                            Current stored settings for comparison
                          </summary>
                          <pre
                            style={{
                              whiteSpace: "pre-wrap",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {JSON.stringify(data.current.definition, null, 2)}
                          </pre>
                        </details>
                      )}
                      <p
                        style={{
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        Reason: {reason}
                      </p>
                      {needsSharing && (
                        <label
                          style={{ display: "flex", gap: 8, marginBlock: 12 }}
                        >
                          <input
                            type="checkbox"
                            checked={sharing}
                            onChange={(event) =>
                              setSharing(event.target.checked)
                            }
                          />
                          I reviewed the settings and author commentary and
                          approve their visibility to current project members.
                          No captured report is shared by this action.
                        </label>
                      )}
                      <label
                        style={{ display: "flex", gap: 8, marginBlock: 12 }}
                      >
                        <input
                          type="checkbox"
                          checked={confirmed}
                          onChange={(event) =>
                            setConfirmed(event.target.checked)
                          }
                        />
                        Apply this exact reviewed change as a new version.
                        Preserve captures and prior history.
                      </label>
                      <div
                        style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
                      >
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setStep(0)}
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={
                            locked ||
                            !confirmed ||
                            reviewedVersion !== data.current.version ||
                            (needsSharing && !sharing)
                          }
                          onClick={() => void save()}
                        >
                          Apply reviewed change
                        </button>
                      </div>
                    </>
                  )
                )}
              </>
            )
          )}
          <details style={{ marginTop: 16 }}>
            <summary>Retained write history · page {page + 1}</summary>
            <ul>
              {data.items.map((row) => (
                <li key={row.key}>
                  Applied version {row.appliedVersion} ·{" "}
                  {new Date(row.createdAt).toLocaleString()} ·{" "}
                  {row.before || row.after
                    ? "Recorded settings retained"
                    : "Body unavailable or private to author"}
                </li>
              ))}
            </ul>
            <p>{data.limitation}</p>
            <button
              type="button"
              className="btn-secondary"
              disabled={!page || locked}
              onClick={() => {
                setPage(page - 1);
                setReceiptKey("");
                setStep(0);
              }}
            >
              Previous history
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={!data.hasMore || page >= 199 || locked}
              onClick={() => {
                setPage(page + 1);
                setReceiptKey("");
                setStep(0);
              }}
            >
              Next history
            </button>
          </details>
        </>
      )}
      {message && <p role="alert">{message}</p>}
    </Modal>
  );
}
