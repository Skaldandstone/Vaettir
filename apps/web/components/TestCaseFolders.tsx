"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Modal } from "@/components/Modal";
import { IconButton } from "@/components/ui/IconButton";
import { TestCaseFolderRecovery } from "@/components/TestCaseFolderRecovery";
import { TestCaseFolderCopy } from "@/components/TestCaseFolderCopy";
import { trpcReact, type RouterInputs } from "@/lib/trpcReact";
import {
  retainedTraceabilityReceipt,
  type TraceabilityReceipt,
} from "@/lib/traceability-receipt";
import { folderIntentMatches, type CaseFolderCatalog, type FolderReviewIntent } from "@/lib/case-folder-tree";

type Change = RouterInputs["caseFolders"]["preview"];
type Write = RouterInputs["caseFolders"]["write"];
const control = {
  display: "block",
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  marginTop: 4,
} as const;
export function TestCaseFolders({
  projectId,
  selectedPath,
  onFolderPaths,
  onSaved,
  onFolderCatalog,
  requestedIntent = null,
}: {
  projectId: string;
  selectedPath: string | null;
  onFolderPaths: (paths: string[]) => void;
  onSaved: (path: string) => void;
  onFolderCatalog?: (catalog: CaseFolderCatalog | null) => void;
  requestedIntent?: FolderReviewIntent | null;
}) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const actorReady = isLoaded && isSignedIn && !!userId;
  const project = trpcReact.project.byId.useQuery(
    { id: projectId },
    { enabled: actorReady, retry: false, staleTime: 0 },
  );
  const organizations = trpcReact.organization.mine.useQuery(undefined, {
    enabled: actorReady,
    retry: false,
    staleTime: 0,
  });
  const organizationId =
    project.data?.id === projectId ? project.data.organizationId : undefined;
  const currentAccess =
    actorReady &&
    !project.error &&
    !project.isFetching &&
    !project.isPaused &&
    project.data?.id === projectId &&
    !organizations.error &&
    !organizations.isFetching &&
    !organizations.isPaused &&
    !!organizations.data?.some((org) => org.id === organizationId);
  const [origin, setOrigin] = useState<{
    projectId: string;
    organizationId: string;
    clerkActorId: string;
  } | null>(null);
  useEffect(() => {
    if (!origin && currentAccess && organizationId)
      setOrigin({ projectId, organizationId, clerkActorId: userId! });
  }, [origin, currentAccess, organizationId, projectId, userId]);
  const scopeReady =
    currentAccess &&
    !!origin &&
    origin.projectId === projectId &&
    origin.organizationId === organizationId &&
    origin.clerkActorId === userId;
  const scopeChanged =
    !!origin &&
    (origin.projectId !== projectId ||
      (!!organizationId && origin.organizationId !== organizationId) ||
      (actorReady && origin.clerkActorId !== userId));
  const scopeKey = JSON.stringify([
    projectId,
    organizationId,
    userId,
    isLoaded,
    isSignedIn,
    currentAccess,
    scopeReady,
  ]);
  const [scopeGeneration, setScopeGeneration] = useState({ key: scopeKey, generation: 0 });
  const generation = scopeGeneration.key === scopeKey ? scopeGeneration.generation : scopeGeneration.generation + 1;
  if (scopeGeneration.key !== scopeKey) setScopeGeneration({ key: scopeKey, generation });
  const [accessGeneration, setAccessGeneration] = useState(-1),
    [previewGeneration, setPreviewGeneration] = useState(-1);
  const liveScope = useRef<{ scopeReady: boolean; origin: typeof origin; generation: number }>({ scopeReady: false, origin: null, generation: -1 });
  useLayoutEffect(() => {
    liveScope.current = { scopeReady, origin, generation };
    return () => { liveScope.current = { scopeReady: false, origin: null, generation: -1 }; };
  }, [scopeReady, origin, generation]);
  const [open, setOpen] = useState(false),
    [action, setAction] = useState<Change["action"]>("CREATE");
  const [source, setSource] = useState(""),
    [name, setName] = useState(""),
    [parent, setParent] = useState("");
  const [prepared, setPrepared] = useState<Change | null>(null),
    [fresh, setFresh] = useState(false),
    [reason, setReason] = useState(""),
    [approved, setApproved] = useState(false);
  const [pending, setPending] = useState<Write | null>(null),
    [accessFresh, setAccessFresh] = useState(false);
  const [draftStarted, setDraftStarted] = useState(false),
    [message, setMessage] = useState(""),
    [approvedHash, setApprovedHash] = useState<string | null>(null);
  const receipt = useRef<TraceabilityReceipt<Write> | null>(null);
  const consumedIntent = useRef<string | null>(null);
  const list = trpcReact.caseFolders.list.useQuery(
    { projectId },
    {
      enabled: scopeReady,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
    },
  );
  const preview = trpcReact.caseFolders.preview.useQuery(
    prepared ?? { projectId, action: "CREATE", toPath: "placeholder" },
    {
      enabled: scopeReady && open && prepared !== null,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
    },
  );
  const mutation = trpcReact.caseFolders.write.useMutation({
    onSuccess: (result) => {
      const input = receipt.current?.input;
      // Legacy retained requests have no scope field. Verify against the original
      // mounted scope, never fresh/rebound query data, without rewriting payload.
      const acknowledgementScope = input?.expectedScope ?? origin;
      if (
        !input ||
        !acknowledgementScope ||
        (!input.expectedScope && origin?.projectId !== input.projectId) ||
        result.requestId !== input.requestId ||
        result.projectId !== input.projectId ||
        result.organizationId !== acknowledgementScope.organizationId ||
        result.clerkActorId !== acknowledgementScope.clerkActorId
      ) {
        if (receipt.current)
          receipt.current = { ...receipt.current, uncertain: true };
        setPending(receipt.current?.input ?? null);
        setMessage(
          "The folder receipt could not be verified. Its exact approved request remains retained.",
        );
        return;
      }
      const destination = receipt.current?.input.toPath;
      receipt.current = null;
      setPending(null);
      setDraftStarted(false); // Only a verified ACK completes this draft.
      setPrepared(null);
      setApproved(false);
      setApprovedHash(null);
      setOpen(false);
      const acknowledgement =
        "Folder change accepted. Cases, folder IDs and history were retained; this acknowledgement is separate from refreshing current access.";
      setMessage(acknowledgement);
      const live = liveScope.current;
      if (
        live.scopeReady &&
        live.origin?.organizationId === result.organizationId &&
        live.origin.clerkActorId === result.clerkActorId
      ) {
        try {
          if (destination) onSaved(destination);
        } catch {
          setMessage(
            `${acknowledgement} The current table could not be refreshed; the accepted change was not retried.`,
          );
        }
        void list
          .refetch({ throwOnError: true })
          .catch(() =>
            setMessage(
              `${acknowledgement} Current folders could not be refreshed; the accepted change was not retried.`,
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
        setFresh(false);
        setApprovedHash(null);
      }
    },
  });
  const { refetch: refetchList } = list;
  useEffect(() => {
    let active = true;
    if (scopeReady)
      void refetchList().then((r) => {
        if (
          active &&
          !r.isError &&
          liveScope.current.generation === generation
        ) {
          setAccessFresh(true);
          setAccessGeneration(generation);
        }
      });
    return () => {
      active = false;
    };
  }, [projectId, open, scopeReady, generation, refetchList]);
  const ready =
    scopeReady &&
    accessFresh &&
    accessGeneration === generation &&
    !list.isError &&
    list.fetchStatus === "idle" &&
    list.isFetchedAfterMount &&
    list.data?.projectId === projectId &&
    list.data.organizationId === organizationId &&
    list.data.clerkActorId === userId;
  const paths = useMemo(
    () => (ready ? (list.data?.paths ?? []) : []),
    [ready, list.data],
  );
  const publishedPaths = useRef<{ key: string; callback: typeof onFolderPaths } | null>(null);
  useEffect(() => {
    const key = JSON.stringify(paths);
    if (publishedPaths.current?.key === key && publishedPaths.current.callback === onFolderPaths) return;
    publishedPaths.current = { key, callback: onFolderPaths };
    onFolderPaths(paths);
  }, [paths, onFolderPaths]); // Failed/paused cached data is not an approved tree.
  const publishedCatalog = useRef<{ key: string; callback: typeof onFolderCatalog } | null>(null);
  useLayoutEffect(() => {
    const catalog = ready && list.data ? { projectId: list.data.projectId, organizationId: list.data.organizationId, clerkActorId: list.data.clerkActorId, paths: list.data.paths, folders: list.data.folders, canEdit: list.data.canEdit } : null;
    // Query wrappers may be replaced without changing this snapshot. Publishing
    // a new object back into parent state on every such render creates a loop.
    // Include the entire scope, access and folder identity payload; null still
    // immediately withdraws the tree when current authorization is unavailable.
    const key = JSON.stringify(catalog);
    if (publishedCatalog.current?.key === key && publishedCatalog.current.callback === onFolderCatalog) return;
    publishedCatalog.current = { key, callback: onFolderCatalog };
    onFolderCatalog?.(catalog);
  }, [ready, list.data, onFolderCatalog]);
  useEffect(() => {
    if (!requestedIntent || consumedIntent.current === requestedIntent.id || !ready || !list.data) return;
    consumedIntent.current = requestedIntent.id;
    if (!folderIntentMatches(requestedIntent, list.data)) { setMessage("Folder gesture refused: restore its exact original account/project and a supported current path. Nothing was moved or normalized."); return; }
    // A gesture is a setup intent, not an approval, and can never overwrite a
    // closed draft or an exact uncertain request retained from an earlier view.
    if (receipt.current || pending || mutation.isPending || draftStarted) {
      setMessage("Existing folder draft/request retained. Finish or recover it, or explicitly discard an editable nonpending draft before starting another folder gesture. Nothing was replaced or moved.");
      return;
    }
    setDraftStarted(true); setAction(requestedIntent.action); setSource(requestedIntent.fromPath);
    setName(requestedIntent.fromPath.slice(requestedIntent.fromPath.lastIndexOf("/") + 1));
    setParent(requestedIntent.destinationParent === undefined ? requestedIntent.fromPath.includes("/") ? requestedIntent.fromPath.slice(0, requestedIntent.fromPath.lastIndexOf("/")) : "" : requestedIntent.destinationParent ?? "");
    mutation.reset(); setPrepared(null); setApproved(false); setApprovedHash(null); setReason(""); setFresh(false); setAccessFresh(false); setOpen(true);
    setMessage("Folder gesture opened an unsaved review setup only. Source files/provenance stay unchanged. Review the complete native subtree impact before approving any move or rename.");
  }, [requestedIntent, ready, list.data, pending, mutation.isPending, draftStarted]);
  const { refetch: refetchPreview } = preview;
  useEffect(() => {
    let active = true;
    if (scopeReady && open && prepared)
      void refetchPreview().then((r) => {
        if (
          active &&
          !r.isError &&
          liveScope.current.generation === generation
        ) {
          setFresh(true);
          setPreviewGeneration(generation);
        }
      });
    return () => {
      active = false;
    };
  }, [open, prepared, scopeReady, generation, refetchPreview]);
  const reviewed =
    ready &&
    fresh &&
    previewGeneration === generation &&
    !!prepared &&
    preview.isFetchedAfterMount &&
    !preview.isError &&
    preview.fetchStatus === "idle" &&
    preview.data?.projectId === projectId &&
    preview.data.organizationId === organizationId &&
    preview.data.clerkActorId === userId &&
    preview.data.action === prepared.action &&
    preview.data.fromPath === (prepared.fromPath ?? null) &&
    preview.data.toPath === prepared.toPath
      ? preview.data
      : null;
  const leaf = source.slice(source.lastIndexOf("/") + 1);
  const change = useMemo<Change>(
    () => ({
      projectId,
      action,
      ...(action !== "CREATE" ? { fromPath: source } : {}),
      toPath:
        action === "RENAME"
          ? [
              source.includes("/")
                ? source.slice(0, source.lastIndexOf("/"))
                : "",
              name.trim(),
            ]
              .filter(Boolean)
              .join("/")
          : [parent, action === "MOVE" ? leaf : name.trim()]
              .filter(Boolean)
              .join("/"),
    }),
    [projectId, action, source, name, parent, leaf],
  );
  const disabled = !ready || !list.data?.canEdit;
  async function refreshAccess() {
    setAccessFresh(false);
    await Promise.all([project.refetch(), organizations.refetch()]);
    if (!liveScope.current.scopeReady) return;
    const result = await list.refetch();
    if (!result.isError && liveScope.current.generation === generation) {
      setAccessFresh(true);
      setAccessGeneration(generation);
    }
  }
  function begin() {
    setAccessFresh(false);
    setFresh(false);
    if (!pending && !draftStarted) {
      setDraftStarted(true);
      setAction("CREATE");
      mutation.reset();
      setPrepared(null);
      setApproved(false);
      setReason("");
      setSource(
        selectedPath && selectedPath !== "__unassigned__" ? selectedPath : "",
      );
      setParent(
        selectedPath && selectedPath !== "__unassigned__" ? selectedPath : "",
      );
      setName("");
    }
    setApproved(false);
    setApprovedHash(null);
    setOpen(true);
  }
  function close() {
    setFresh(false);
    setAccessFresh(false);
    setOpen(false);
  }
  return (
    <div className="case-folder-tools" role="group" aria-label="Folder tools">
      <span className="text-muted" style={{fontSize: 12, marginRight: 4}}>Suite tools</span>
      <IconButton label="Folders" icon="folder" onClick={begin}/>
      {scopeReady && message && <p role="status">{message}</p>}
      <TestCaseFolderCopy
        key={`${projectId}:copy`}
        projectId={projectId}
        selectedPath={selectedPath}
        onSaved={(path) => {
          void list.refetch();
          onSaved(path);
        }}
      />
      <TestCaseFolderRecovery
        key={`${projectId}:recovery`}
        projectId={projectId}
        onSaved={(path) => {
          void list.refetch();
          onSaved(path);
        }}
      />
      {scopeReady && list.isError && (
        <p role="alert">
          Folder access could not be verified. Empty folders are hidden.{" "}
          <button onClick={() => void refreshAccess()}>Retry folders</button>
        </p>
      )}
      <Modal
        open={open}
        onClose={close}
        title="Organize test folders"
        size="wide"
      >
        {pending && (
          <p role="alert">
            An exact approved folder request is retained. Verify the original
            account and workspace to recover its outcome; no replacement request
            has been created.
          </p>
        )}
        {scopeChanged || (isLoaded && !actorReady) ? (
          <p role="alert">
            Folder paths, impact and draft controls are hidden after an account
            or workspace change. Your original draft and exact request are
            retained; return to that verified identity to continue.
          </p>
        ) : !ready ? (
          <div role="status">
            <p>Checking current project access…</p>
            <button disabled={!actorReady} onClick={() => void refreshAccess()}>
              Retry current access
            </button>
          </div>
        ) : !list.data?.canEdit ? (
          <p role="alert">
            A current full editor seat is required to change folders.
          </p>
        ) : (
          <>
            {!prepared ? (
              <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
                <label>
                  Action
                  <select
                    style={control}
                    value={action}
                    onChange={(e) => {
                      const next = e.target.value as Change["action"];
                      setAction(next);
                      if (next === "MOVE")
                        setParent(
                          source.includes("/")
                            ? source.slice(0, source.lastIndexOf("/"))
                            : "",
                        );
                      if (next === "RENAME") setName(leaf);
                    }}
                  >
                    <option value="CREATE">Create folder</option>
                    <option value="RENAME">Rename folder</option>
                    <option value="MOVE">Move folder</option>
                  </select>
                </label>
                {action !== "CREATE" && (
                  <label>
                    Folder
                    <select
                      style={control}
                      value={source}
                      onChange={(e) => {
                        const value = e.target.value;
                        setSource(value);
                        if (action === "MOVE")
                          setParent(
                            value.includes("/")
                              ? value.slice(0, value.lastIndexOf("/"))
                              : "",
                          );
                        if (action === "RENAME")
                          setName(value.slice(value.lastIndexOf("/") + 1));
                      }}
                    >
                      <option value="">Choose a folder…</option>
                      {paths.map((path) => (
                        <option key={path} value={path}>
                          {path.split("/").join(" › ")}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {action !== "MOVE" && (
                  <label>
                    Folder name (required)
                    <input
                      style={control}
                      value={name}
                      maxLength={80}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                )}
                {action !== "RENAME" && (
                  <label>
                    {action === "MOVE"
                      ? "Destination parent folder"
                      : "Parent folder"}
                    <select
                      style={control}
                      value={parent}
                      onChange={(e) => setParent(e.target.value)}
                    >
                      <option value="">Project root</option>
                      {paths
                        .filter(
                          (path) =>
                            action === "CREATE" ||
                            !(path === source || path.startsWith(source + "/")),
                        )
                        .map((path) => (
                          <option key={path} value={path}>
                            {path.split("/").join(" › ")}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                {action === "MOVE" && source && (
                  <p role="status" style={{ overflowWrap: "anywhere" }}>
                    Move <strong>{source.split("/").join(" › ")}</strong> under{" "}
                    <strong>
                      {parent ? parent.split("/").join(" › ") : "Project root"}
                    </strong>
                    . Resulting folder: <strong>{change.toPath}</strong>.
                    {change.fromPath === change.toPath &&
                      " Choose a different destination parent to move this folder."}
                  </p>
                )}
                <p>
                  Empty folders are saved independently of cases. A rename or
                  move includes all descendant cases, including archived cases.
                  Existing case IDs, within-suite order and frozen runs remain
                  unchanged.
                </p>
                <p>Source-derived groups are test-case presentation, not filesystem folders. A reviewed move/rename to a different destination assigns saved suite paths and can create a new saved folder identity; original source paths/files are unchanged. Same-path promotion is not supported. The server review includes hidden, unreviewed and archived descendant cases, not just this page&apos;s visible lane or filters.</p>
                <button
                  className="btn-primary"
                  disabled={
                    disabled ||
                    (!source && action !== "CREATE") ||
                    (!name.trim() && action !== "MOVE") ||
                    (action !== "CREATE" && change.fromPath === change.toPath)
                  }
                  onClick={() => {
                    setFresh(false);
                    setPrepared(change);
                    setReason("");
                    setApproved(false);
                  }}
                >
                  Review change
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
                {preview.isError ? (
                  <p role="alert">
                    {preview.error.message}
                    <button
                      onClick={() =>
                        void preview.refetch().then((r) => {
                          if (
                            !r.isError &&
                            liveScope.current.generation === generation
                          ) {
                            setApproved(false);
                            setApprovedHash(null);
                            setFresh(true);
                            setPreviewGeneration(generation);
                          }
                        })
                      }
                    >
                      Retry review
                    </button>
                  </p>
                ) : !reviewed ? (
                  <p role="status">Loading the complete folder impact…</p>
                ) : (
                  <>
                    <h3>
                      {prepared.action === "CREATE"
                        ? "Create folder"
                        : prepared.action === "MOVE"
                          ? "Move folder"
                          : "Rename folder"}
                    </h3>
                    {reviewed.fromPath && (
                      <p>
                        From:{" "}
                        <strong style={{ overflowWrap: "anywhere" }}>
                          {reviewed.fromPath}
                        </strong>
                      </p>
                    )}
                    <p>
                      To:{" "}
                      <strong style={{ overflowWrap: "anywhere" }}>
                        {reviewed.toPath}
                      </strong>
                    </p>
                    <p>
                      {reviewed.caseCount} cases ({reviewed.archivedCaseCount}{" "}
                      archived) and {reviewed.descendantCount} descendant
                      folders. This is one atomic change; there is no
                      partial-success fallback. No AI credits are used.
                    </p>
                    {!!reviewed.caseCount && (
                      <details>
                        <summary>
                          Review all affected case placements (
                          {reviewed.caseCount})
                        </summary>
                        <div style={{ maxHeight: 260, overflow: "auto" }}>
                          {reviewed.cases.map((c) => (
                            <p key={c.id}>
                              <strong>{c.displayId}</strong>:{" "}
                              {c.fromSuitePath ?? "Source-derived suite"} →{" "}
                              {c.toSuitePath}
                            </p>
                          ))}
                        </div>
                      </details>
                    )}
                    <p>
                      A new procedure version is retained for each moved case.
                      The folder receipt stores old/new placement and version
                      numbers; previous history and run evidence are not
                      rewritten.
                    </p>
                    <label>
                      Reason (required)
                      <textarea
                        style={control}
                        rows={3}
                        disabled={!!pending}
                        value={reason}
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
                      I reviewed the complete folder and case impact.
                    </label>
                  </>
                )}
                {mutation.isError && (
                  <p role="alert">
                    {mutation.error.message}{" "}
                    {pending
                      ? "The outcome may be unconfirmed. Retry the exact approved change; do not create a new request."
                      : "This request was refused. Go back and review a fresh change."}
                  </p>
                )}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    disabled={!!pending}
                    onClick={() => {
                      mutation.reset();
                      setPrepared(null);
                      setApproved(false);
                      setFresh(false);
                    }}
                  >
                    Back
                  </button>
                  <button
                    className="btn-primary"
                    disabled={
                      disabled ||
                      mutation.isPending ||
                      (!pending &&
                        (!reviewed ||
                          !approved ||
                          approvedHash !== reviewed.expectedHash ||
                          !reason.trim()))
                    }
                    onClick={() => {
                      if (
                        disabled ||
                        !liveScope.current.scopeReady ||
                        mutation.isPending
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
                        confirmed: true,
                        requestId: crypto.randomUUID(),
                        reason,
                        expectedScope: {
                          organizationId: origin!.organizationId,
                          clerkActorId: origin!.clerkActorId,
                        },
                      };
                      receipt.current = { input, uncertain: false };
                      setPending(input);
                      mutation.mutate(input);
                    }}
                  >
                    {mutation.isPending
                      ? "Saving…"
                      : pending
                        ? "Retry exact approved change"
                        : "Approve folder change"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        <button onClick={close} style={{ marginTop: 12 }}>
          Close
        </button>
        {ready && list.data?.canEdit && draftStarted && !pending && <button type="button" disabled={mutation.isPending} style={{ marginTop: 12, marginLeft: 8 }} onClick={() => {
          if (mutation.isPending || receipt.current || pending || !liveScope.current.scopeReady) return;
          setDraftStarted(false); setPrepared(null); setApproved(false); setApprovedHash(null); setFresh(false); setReason(""); setName(""); setSource(""); setParent(""); mutation.reset(); setOpen(false);
          setMessage("Editable folder draft explicitly discarded. No saved folder, case placement or uncertain request was changed.");
        }}>Discard editable folder draft</button>}
      </Modal>
    </div>
  );
}
