"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { CaseProcedureColumns } from "@/components/CaseProcedureColumns";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";
import {
  retainedTraceabilityReceipt,
  type TraceabilityReceipt,
} from "@/lib/traceability-receipt";
import { inspectorLabel } from "@/lib/case-inspector";
import { useFolderActionScope } from "@/lib/use-folder-action-scope";
import { verifiedFolderPrerequisiteAck } from "@/lib/folder-prerequisite-copy-ack";
import { verifiedFolderDatasetAck } from "@/lib/folder-dataset-copy-ack";

type Review = RouterInputs["caseFolders"]["copyPreview"];
type Write = RouterInputs["caseFolders"]["copyWrite"];
type Result = RouterOutputs["caseFolders"]["copyWrite"];
const control = {
  display: "block",
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  marginTop: 4,
} as const;
export function TestCaseFolderCopy({
  projectId,
  selectedPath,
  onSaved,
}: {
  projectId: string;
  selectedPath: string | null;
  onSaved: (path: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [source, setSource] = useState(""),
    [parent, setParent] = useState(""),
    [name, setName] = useState("");
  const [copyInternalPrerequisites, setCopyInternalPrerequisites] =
    useState(false);
  const [copyParameterDatasets, setCopyParameterDatasets] = useState(false);
  const [prepared, setPrepared] = useState<Review | null>(null),
    [accessFresh, setAccessFresh] = useState(false),
    [reviewFresh, setReviewFresh] = useState(false),
    [reason, setReason] = useState(""),
    [approved, setApproved] = useState(false),
    [pending, setPending] = useState<Write | null>(null),
    [completed, setCompleted] = useState<Result | null>(null);
  const scope = useFolderActionScope(projectId, open || !!completed);
  const [accessGeneration, setAccessGeneration] = useState(-1),
    [reviewGeneration, setReviewGeneration] = useState(-1),
    [draftStarted, setDraftStarted] = useState(false),
    [approvedHash, setApprovedHash] = useState<string | null>(null),
    [message, setMessage] = useState("");
  const receipt = useRef<TraceabilityReceipt<Write> | null>(null);
  const access = trpcReact.caseFolders.list.useQuery(
    { projectId },
    {
      enabled: scope.ready,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
    },
  );
  const review = trpcReact.caseFolders.copyPreview.useQuery(
    prepared ?? {
      projectId,
      fromPath: "placeholder",
      toPath: "placeholder-copy",
    },
    {
      enabled: scope.ready && open && !!prepared,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
    },
  );
  const mutation = trpcReact.caseFolders.copyWrite.useMutation({
    onSuccess: async (result) => {
      const input = receipt.current?.input;
      const graphVerified = input
        ? await verifiedFolderPrerequisiteAck(input, result)
        : false;
      const datasetsVerified = input
        ? await verifiedFolderDatasetAck(input, result)
        : false;
      const acknowledgedScope = input?.expectedScope ?? scope.origin;
      if (
        !input ||
        !graphVerified ||
        !datasetsVerified ||
        receipt.current?.input !== input ||
        !acknowledgedScope ||
        (!input.expectedScope && scope.origin?.projectId !== input.projectId) ||
        result.requestId !== input.requestId ||
        result.projectId !== input.projectId ||
        result.organizationId !== acknowledgedScope.organizationId ||
        result.clerkActorId !== acknowledgedScope.clerkActorId ||
        result.destinationPath !== input.toPath
      ) {
        if (receipt.current)
          receipt.current = { ...receipt.current, uncertain: true };
        setPending(receipt.current?.input ?? null);
        setMessage(
          "The copy receipt could not be verified. Its exact approved request is retained.",
        );
        return;
      }
      receipt.current = null;
      setPending(null);
      setCompleted(result);
      setPrepared(null);
      setOpen(false);
      setApproved(false);
      setApprovedHash(null);
      setDraftStarted(false);
      const acknowledgement =
        "Folder copy accepted. New IDs were allocated once; this acknowledgement is separate from refreshing current access.";
      setMessage(acknowledgement);
      const live = scope.live.current;
      if (
        live.ready &&
        live.origin?.organizationId === result.organizationId &&
        live.origin.clerkActorId === result.clerkActorId
      ) {
        try {
          onSaved(result.destinationPath);
        } catch {
          setMessage(
            `${acknowledgement} The current table could not be refreshed; the accepted copy was not retried.`,
          );
        }
        void access
          .refetch({ throwOnError: true })
          .catch(() =>
            setMessage(
              `${acknowledgement} Current folders could not be refreshed; the accepted copy was not retried.`,
            ),
          );
      }
    },
    onError: (error) => {
      if (!receipt.current) return;
      receipt.current = retainedTraceabilityReceipt(receipt.current, error);
      setPending(receipt.current?.input ?? null);
      if (!receipt.current) {
        setApproved(false);
        setReviewFresh(false);
        setApprovedHash(null);
      }
    },
  });
  const { refetch: refetchAccess } = access;
  useEffect(() => {
    let active = true;
    const before = access.dataUpdatedAt;
    if (scope.ready)
      void refetchAccess().then((r) => {
        if (
          active &&
          !r.isError &&
          r.fetchStatus === "idle" &&
          r.dataUpdatedAt > before &&
          scope.matches(r.data) &&
          scope.live.current.generation === scope.generation
        ) {
          setAccessFresh(true);
          setAccessGeneration(scope.generation);
        }
      });
    return () => {
      active = false;
    };
  }, [open, scope.ready, scope.generation, refetchAccess]);
  const { refetch: refetchReview } = review;
  useEffect(() => {
    let active = true;
    const before = review.dataUpdatedAt;
    if (scope.ready && open && prepared)
      void refetchReview().then((r) => {
        if (
          active &&
          !r.isError &&
          r.fetchStatus === "idle" &&
          r.dataUpdatedAt > before &&
          scope.matches(r.data) &&
          scope.live.current.generation === scope.generation
        ) {
          setReviewFresh(true);
          setReviewGeneration(scope.generation);
        }
      });
    return () => {
      active = false;
    };
  }, [open, prepared, scope.ready, scope.generation, refetchReview]);
  const currentAccess =
    scope.ready &&
    accessFresh &&
    accessGeneration === scope.generation &&
    !access.isError &&
    access.isFetchedAfterMount &&
    access.fetchStatus === "idle" &&
    scope.matches(access.data)
      ? access.data
      : null;
  const reviewed =
    !!currentAccess &&
    reviewFresh &&
    reviewGeneration === scope.generation &&
    !!prepared &&
    !review.isError &&
    review.isFetchedAfterMount &&
    review.fetchStatus === "idle" &&
    scope.matches(review.data) &&
    review.data?.fromPath === prepared.fromPath &&
    review.data.toPath === prepared.toPath &&
    review.data.copyInternalPrerequisites ===
      !!prepared.copyInternalPrerequisites &&
    review.data.copyParameterDatasets === !!prepared.copyParameterDatasets
      ? review.data
      : null;
  function close() {
    setOpen(false);
    setAccessFresh(false);
    setReviewFresh(false);
  }
  async function refreshAccess() {
    setAccessFresh(false);
    await scope.refresh();
    if (!scope.live.current.ready) return;
    const before = access.dataUpdatedAt;
    const result = await access.refetch();
    if (
      !result.isError &&
      result.fetchStatus === "idle" &&
      result.dataUpdatedAt > before &&
      scope.matches(result.data) &&
      scope.live.current.generation === scope.generation
    ) {
      setAccessFresh(true);
      setAccessGeneration(scope.generation);
    }
  }
  return (
    <>
      <button
        onClick={() => {
          setAccessFresh(false);
          setReviewFresh(false);
          if (!pending && !draftStarted) {
            setDraftStarted(true);
            const path =
              selectedPath && selectedPath !== "__unassigned__"
                ? selectedPath
                : "";
            setSource(path);
            setParent(
              path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
            );
            setName(
              path
                ? path.slice(path.lastIndexOf("/") + 1).slice(0, 75) + " copy"
                : "",
            );
            setPrepared(null);
            setApproved(false);
            setReason("");
            setCopyInternalPrerequisites(false);
            setCopyParameterDatasets(false);
            mutation.reset();
          }
          setApproved(false);
          setApprovedHash(null);
          setOpen(true);
        }}
      >
        Copy folder
      </button>
      {scope.ready && message && <p role="status">{message}</p>}
      {completed && currentAccess && scope.matches(completed) && (
        <details style={{ marginTop: 8 }}>
          <summary>
            {completed.recovered
              ? "Recovered completed folder copy"
              : "Folder copy completed"}
            : {completed.copies.length} new cases
          </summary>
          <p>
            New cases have their own IDs and pending review. No old execution or
            paid draft evidence was copied.
          </p>
          {completed.copies.map((c) => (
            <p key={c.caseId}>
              <Link href={`/projects/${projectId}/test-cases/${c.caseId}`}>
                {c.displayId}
              </Link>
            </p>
          ))}
          {!!completed.copiedPrerequisites?.length && (
            <div>
              <p>
                Internal prerequisites created at the accepted copy (
                {completed.copiedPrerequisites.length}). This retained receipt
                is not a fresh check of later relationship edits.
              </p>
              {completed.copiedPrerequisites.map((edge) => (
                <p key={`${edge.dependentId}:${edge.prerequisiteId}`}>
                  <Link
                    href={`/projects/${projectId}/test-cases/${edge.dependentId}`}
                  >
                    {edge.dependentDisplayId}
                  </Link>
                  {" requires "}
                  <Link
                    href={`/projects/${projectId}/test-cases/${edge.prerequisiteId}`}
                  >
                    {edge.prerequisiteDisplayId}
                  </Link>
                </p>
              ))}
            </div>
          )}
          {!!completed.copiedDatasets?.length && (
            <section aria-label="Copied parameter datasets">
              <p>
                Historical dataset mapping from the accepted copy. Row identity
                is the fresh dataset ID plus its zero-based index; this retained
                mapping does not certify later edits or executions.
              </p>
              {completed.copiedDatasets.map((d) => (
                <details key={d.datasetId}>
                  <summary>
                    <Link
                      href={`/projects/${projectId}/test-cases/${d.caseId}`}
                    >
                      {d.displayId}
                    </Link>
                    : {d.rowCount} rows / {d.parameterCount} parameters
                  </summary>
                  <p style={{ overflowWrap: "anywhere" }}>
                    Fresh dataset: {d.datasetId}
                  </p>
                  <ol>
                    {d.rows.map((row) => (
                      <li key={row.rowIndex}>
                        {row.name} (index {row.rowIndex})
                      </li>
                    ))}
                  </ol>
                </details>
              ))}
            </section>
          )}
        </details>
      )}
      <Modal open={open} onClose={close} title="Review folder copy" size="wide">
        {pending && (
          <p role="alert">
            An exact approved copy request is retained. Verify its original
            account and workspace before recovering the outcome.
          </p>
        )}
        {scope.changed || scope.signedOut ? (
          <p role="alert">
            Source procedures, copy results and draft controls are hidden after
            an account or workspace change. The original draft and request
            remain retained.
          </p>
        ) : !currentAccess ? (
          <div role={access.isError ? "alert" : "status"}>
            <p>
              {access.isError
                ? access.error.message
                : "Checking current project access…"}
            </p>
            <button
              disabled={!scope.actorReady}
              onClick={() => void refreshAccess()}
            >
              Retry current access
            </button>
          </div>
        ) : !currentAccess.canEdit ? (
          <p role="alert">
            A current full editor seat is required to copy folders.
          </p>
        ) : !prepared ? (
          <div
            style={{
              display: "grid",
              gap: 12,
              minWidth: 0,
              overflowWrap: "anywhere",
            }}
          >
            <p>
              Copy up to 50 independent cases and their complete empty/nested
              folder hierarchy in one atomic operation. The batch is limited to
              8 MiB; each procedure to 512 KiB / 500 steps. Archived cases,
              shared libraries, media and attachments block this copy rather
              than being silently dropped. Parameter datasets require the
              explicit supported-data review below. Prerequisites also block it
              unless you explicitly review complete internal remapping below.
              External links always block the entire copy.
            </p>
            <label>
              Source folder
              <select
                style={control}
                value={source}
                onChange={(e) => {
                  const path = e.target.value;
                  setSource(path);
                  setParent(
                    path.includes("/")
                      ? path.slice(0, path.lastIndexOf("/"))
                      : "",
                  );
                  setName(
                    path
                      ? path.slice(path.lastIndexOf("/") + 1).slice(0, 75) +
                          " copy"
                      : "",
                  );
                }}
              >
                <option value="">Choose a folder…</option>
                {currentAccess.paths.map((p) => (
                  <option key={p} value={p}>
                    {p.split("/").join(" › ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              New folder name (required)
              <input
                style={control}
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Destination parent
              <select
                style={control}
                value={parent}
                onChange={(e) => setParent(e.target.value)}
              >
                <option value="">Project root</option>
                {currentAccess.paths
                  .filter((p) => !(p === source || p.startsWith(source + "/")))
                  .map((p) => (
                    <option key={p} value={p}>
                      {p.split("/").join(" › ")}
                    </option>
                  ))}
              </select>
            </label>
            <p>
              Destination must be new. Originals, their folder IDs, case IDs,
              order and evidence stay unchanged. No AI credits are used.
            </p>
            <label style={{ display: "flex", gap: 8 }}>
              <input
                type="checkbox"
                checked={copyInternalPrerequisites}
                disabled={!!pending}
                onChange={(e) => setCopyInternalPrerequisites(e.target.checked)}
              />
              Also review internal prerequisite links. Both endpoints must be
              among the complete selected cases; any external incoming or
              outgoing link refuses the copy.
            </label>
            <label style={{ display: "flex", gap: 8 }}>
              <input
                type="checkbox"
                checked={copyParameterDatasets}
                disabled={!!pending}
                onChange={(e) => setCopyParameterDatasets(e.target.checked)}
              />
              Also review supported parameter datasets. Exact names, row order
              and string values are preserved; unsupported row
              overrides/correlations or dataset prerequisites refuse the
              complete copy.
            </label>
            <p role="status" style={{ overflowWrap: "anywhere" }}>
              New destination:{" "}
              <strong>
                {[parent, name.trim()].filter(Boolean).join("/") ||
                  "Choose a name and destination"}
              </strong>
              .
            </p>
            <button
              className="btn-primary"
              disabled={!source || !name.trim()}
              onClick={() => {
                setReviewFresh(false);
                setPrepared({
                  projectId,
                  fromPath: source,
                  toPath: [parent, name.trim()].filter(Boolean).join("/"),
                  ...(copyInternalPrerequisites
                    ? { copyInternalPrerequisites: true as const }
                    : {}),
                  ...(copyParameterDatasets
                    ? { copyParameterDatasets: true as const }
                    : {}),
                });
                setApproved(false);
                setReason("");
              }}
            >
              Review complete copy
            </button>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gap: 12,
              minWidth: 0,
              overflowWrap: "anywhere",
            }}
          >
            {review.isError ? (
              <div role="alert">
                <p>{review.error.message}</p>
                <button
                  onClick={() => {
                    setReviewFresh(false);
                    setApproved(false);
                    setApprovedHash(null);
                    const before = review.dataUpdatedAt;
                    void review.refetch().then((r) => {
                      if (
                        !r.isError &&
                        r.fetchStatus === "idle" &&
                        r.dataUpdatedAt > before &&
                        scope.matches(r.data) &&
                        scope.live.current.generation === scope.generation
                      ) {
                        setApproved(false);
                        setApprovedHash(null);
                        setReviewFresh(true);
                        setReviewGeneration(scope.generation);
                      }
                    });
                  }}
                >
                  Retry review
                </button>
              </div>
            ) : !reviewed ? (
              <p role="status">
                Checking every source case, dependency and current metadata
                definition…
              </p>
            ) : (
              <>
                <p style={{ overflowWrap: "anywhere" }}>
                  From: <strong>{reviewed.fromPath}</strong>
                  <br />
                  New destination: <strong>{reviewed.toPath}</strong>
                </p>
                <p>
                  {reviewed.caseCount} new cases and {reviewed.folderCount} new
                  folder identities. All are copied together or none are. Newly
                  allocated case IDs are shown only after the approved
                  transaction commits.
                </p>
                <p>{reviewed.notice}</p>
                <p>{reviewed.orderNotice}</p>
                {reviewed.copyParameterDatasets && (
                  <section aria-label="Complete parameter dataset review">
                    <h3>Parameter datasets ({reviewed.datasets.length})</h3>
                    <p>
                      Every declared parameter and row is copied exactly. Fresh
                      row identity is the new dataset ID and the preserved row
                      index, not a separate stable row ID. Source values stay
                      unchanged; execution history and previous dataset
                      approvals are not transferred.
                    </p>
                    {!reviewed.datasets.length && (
                      <p>
                        No saved datasets are present in this complete
                        selection.
                      </p>
                    )}
                    {reviewed.datasets.map((d) => (
                      <details key={d.sourceDatasetId}>
                        <summary>
                          {d.sourceDisplayId}: {d.rowCount} rows /{" "}
                          {d.parameterCount} parameters
                        </summary>
                        <div style={{ maxHeight: 380, overflow: "auto" }}>
                          <table>
                            <thead>
                              <tr>
                                <th scope="col">Row</th>
                                {d.parameterNames.map((name) => (
                                  <th key={name} scope="col">
                                    {name}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {d.rows.map((row, rowIndex) => (
                                <tr key={rowIndex}>
                                  <th scope="row">
                                    {rowIndex + 1}. {row.name}
                                  </th>
                                  {d.parameterNames.map((name) => (
                                    <td
                                      key={name}
                                      style={{
                                        whiteSpace: "pre-wrap",
                                        overflowWrap: "anywhere",
                                      }}
                                    >
                                      {row.values[name] === "" ? (
                                        <em>Empty string</em>
                                      ) : (
                                        row.values[name]
                                      )}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    ))}
                  </section>
                )}
                {reviewed.copyInternalPrerequisites && (
                  <section aria-label="Internal prerequisite review">
                    <h3>
                      Internal prerequisite links (
                      {reviewed.internalPrerequisites.length})
                    </h3>
                    <p>
                      These source links remain unchanged. Each dependent will
                      require the newly copied prerequisite, not its original.
                      This creates new relationships, not old execution or
                      approval evidence.
                    </p>
                    {!reviewed.internalPrerequisites.length && (
                      <p>
                        No internal prerequisite links are present in this
                        complete selection.
                      </p>
                    )}
                    <div style={{ maxHeight: 300, overflow: "auto" }}>
                      {reviewed.internalPrerequisites.map((edge) => (
                        <p key={`${edge.dependentId}:${edge.prerequisiteId}`}>
                          <Link
                            href={`/projects/${projectId}/test-cases/${edge.dependentId}`}
                          >
                            {edge.dependentDisplayId}
                          </Link>
                          {" requires "}
                          <Link
                            href={`/projects/${projectId}/test-cases/${edge.prerequisiteId}`}
                          >
                            {edge.prerequisiteDisplayId}
                          </Link>
                          {" → new copied identities"}
                        </p>
                      ))}
                    </div>
                  </section>
                )}
                <details>
                  <summary>
                    Review every destination folder ({reviewed.folderCount})
                  </summary>
                  {reviewed.destinationPaths.map((p) => (
                    <p key={p} style={{ overflowWrap: "anywhere" }}>
                      {p}
                    </p>
                  ))}
                </details>
                <details>
                  <summary>
                    Review every source procedure and human field (
                    {reviewed.caseCount})
                  </summary>
                  <div style={{ maxHeight: 380, overflow: "auto" }}>
                    {reviewed.cases.map((c) => (
                      <details key={c.sourceId}>
                        <summary>
                          {c.sourceDisplayId}: {c.title}
                        </summary>
                        <p style={{ overflowWrap: "anywhere" }}>
                          {c.sourcePath} → {c.destinationPath}; destination
                          position {c.destinationPosition + 1}
                        </p>
                        <p>
                          {inspectorLabel(c.definition.testType)} ·{" "}
                          {inspectorLabel(c.definition.priority)} ·{" "}
                          {inspectorLabel(c.definition.validationDomain)}
                        </p>
                        <details>
                          <summary>
                            Source-specific warnings and exclusions
                          </summary>
                          <ul>
                            {c.warnings.map((warning, index) => (
                              <li key={index}>{warning}</li>
                            ))}
                          </ul>
                        </details>
                        {c.definition.background && (
                          <p>Setup: {c.definition.background}</p>
                        )}
                        {(["given", "when", "then"] as const).map(
                          (phase) =>
                            c.definition[phase].length > 0 && (
                              <div key={phase}>
                                <strong>
                                  {phase[0]!.toUpperCase() + phase.slice(1)}
                                </strong>
                                <ol>
                                  {c.definition[phase].map((line, index) => (
                                    <li key={index}>{line}</li>
                                  ))}
                                </ol>
                              </div>
                            ),
                        )}
                        {!!c.definition.steps.length && (
                          <CaseProcedureColumns steps={c.definition.steps} />
                        )}
                        <p>
                          Tags:{" "}
                          {c.definition.tags.length
                            ? c.definition.tags.join(", ")
                            : "None"}
                        </p>
                        <dl>
                          {Object.entries(c.definition.verificationProfile).map(
                            ([key, value]) => (
                              <div key={key}>
                                <dt>
                                  {inspectorLabel(
                                    key.replace(/([a-z])([A-Z])/g, "$1 $2"),
                                  )}
                                </dt>
                                <dd>{value}</dd>
                              </div>
                            ),
                          )}
                          {Object.entries(c.customFields).map(
                            ([key, value]) => (
                              <div key={key}>
                                <dt>
                                  {reviewed.customFieldLabels[key] ?? key}
                                </dt>
                                <dd>
                                  {value === null ? "Not set" : String(value)}
                                </dd>
                              </div>
                            ),
                          )}
                        </dl>
                      </details>
                    ))}
                  </div>
                </details>
                <label>
                  Reason (required)
                  <textarea
                    style={control}
                    rows={3}
                    value={reason}
                    disabled={!!pending}
                    maxLength={1000}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <label style={{ display: "flex", gap: 8 }}>
                  <input
                    type="checkbox"
                    disabled={!!pending}
                    checked={approved}
                    onChange={(e) => {
                      setApproved(e.target.checked);
                      setApprovedHash(
                        e.target.checked ? reviewed.expectedHash : null,
                      );
                    }}
                  />
                  I reviewed every procedure, destination, listed internal
                  prerequisite link, dataset parameter/row/value and evidence
                  exclusion.
                </label>
              </>
            )}
            {mutation.isError && (
              <p role="alert">
                {mutation.error.message}{" "}
                {pending
                  ? "An earlier attempt may have completed. Keep its exact request; retry without creating another copy."
                  : "This copy was refused. Review a fresh baseline before trying again."}
              </p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                disabled={!!pending}
                onClick={() => {
                  setPrepared(null);
                  setReviewFresh(false);
                  setApproved(false);
                  mutation.reset();
                }}
              >
                Back
              </button>
              <button
                className="btn-primary"
                disabled={
                  mutation.isPending ||
                  !currentAccess.canEdit ||
                  (!pending &&
                    (!reviewed ||
                      !approved ||
                      approvedHash !== reviewed.expectedHash ||
                      !reason.trim()))
                }
                onClick={() => {
                  if (
                    mutation.isPending ||
                    !scope.live.current.ready ||
                    !currentAccess?.canEdit
                  )
                    return;
                  if (pending) {
                    mutation.mutate(pending);
                    return;
                  }
                  if (
                    !prepared ||
                    !reviewed ||
                    !approved ||
                    approvedHash !== reviewed.expectedHash ||
                    !reason.trim()
                  )
                    return;
                  const input: Write = {
                    ...prepared,
                    expectedHash: reviewed.expectedHash,
                    requestId: crypto.randomUUID(),
                    confirmed: true,
                    reason,
                    expectedScope: {
                      organizationId: scope.origin!.organizationId,
                      clerkActorId: scope.origin!.clerkActorId,
                    },
                    ...(prepared.copyInternalPrerequisites
                      ? {
                          expectedPrerequisiteHash:
                            reviewed.prerequisiteReviewHash!,
                          expectedInternalPrerequisites:
                            reviewed.internalPrerequisites.map(
                              ({ dependentId, prerequisiteId }) => ({
                                dependentId,
                                prerequisiteId,
                              }),
                            ),
                        }
                      : {}),
                    ...(prepared.copyParameterDatasets
                      ? {
                          expectedDatasetHash: reviewed.datasetReviewHash!,
                          expectedDatasets: reviewed.datasetSources,
                        }
                      : {}),
                  };
                  receipt.current = { input, uncertain: false };
                  setPending(input);
                  mutation.mutate(input);
                }}
              >
                {mutation.isPending
                  ? "Copying…"
                  : pending
                    ? "Retry exact approved copy"
                    : "Approve folder copy"}
              </button>
            </div>
          </div>
        )}
        <button onClick={close} style={{ marginTop: 12 }}>
          Close
        </button>
      </Modal>
    </>
  );
}
