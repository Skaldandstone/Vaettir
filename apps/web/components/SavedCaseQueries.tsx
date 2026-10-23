"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact } from "@/lib/trpcReact";
import { retainSavedQueryRequest } from "@/lib/saved-case-query-recovery";
import {
  savedCaseQueryDefinition,
  type SavedCaseQueryValue,
  type SavedCaseQueryWriteInput,
  type SavedCaseQueryWriteResponse,
  savedCaseQueryCatalogKey,
  type SavedCaseQueryCatalogFilters,
} from "@vaettir/api/src/services/savedCaseQuerySchema";
import { type CaseQuery } from "@vaettir/api/src/services/caseQuerySchema";
import {
  savedQueryCatalogEchoMatches,
  reachableSavedQueryPage,
} from "@/lib/saved-query-catalog";

type Columns = string[];
const control = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box" as const,
};
const label = { display: "grid", gap: 6, minWidth: 0 };

// Hook state belongs to the still-mounted explorer, not its conditional dialog
// children: closing/reopening the module retains an uncertain write exactly.
export function useSavedCaseQueries({
  projectId,
  organizationId,
  enabled,
  query,
  columns,
  onLoad,
}: {
  projectId: string;
  organizationId: string | undefined;
  enabled: boolean;
  query: CaseQuery;
  columns: Columns;
  onLoad: (query: CaseQuery, columns: Columns) => void;
}) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const actorReady = isLoaded && isSignedIn && !!userId;
  const [origin, setOrigin] = useState<{
    projectId: string;
    organizationId: string;
    clerkActorId: string;
  } | null>(null);
  useEffect(() => {
    if (!origin && enabled && organizationId && actorReady)
      setOrigin({ projectId, organizationId, clerkActorId: userId! });
  }, [origin, enabled, organizationId, actorReady, projectId, userId]);
  const scopeReady =
    enabled &&
    actorReady &&
    !!origin &&
    origin.projectId === projectId &&
    origin.organizationId === organizationId &&
    origin.clerkActorId === userId;
  const scopeChanged =
    !!origin &&
    ((actorReady && origin.clerkActorId !== userId) ||
      (!!organizationId && origin.organizationId !== organizationId) ||
      origin.projectId !== projectId);
  const [offset, setOffset] = useState(0),
    [selected, setSelected] = useState(""),
    [baseline, setBaseline] = useState<SavedCaseQueryValue | null>(null),
    [name, setName] = useState(""),
    [visibility, setVisibility] = useState<"PRIVATE" | "SHARED">("PRIVATE"),
    [deleteConfirmed, setDeleteConfirmed] = useState(false),
    [pendingRequest, setPendingRequest] =
      useState<SavedCaseQueryWriteInput | null>(null),
    [message, setMessage] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogFilters, setCatalogFilters] =
    useState<SavedCaseQueryCatalogFilters>({
      search: "",
      collection: "ALL",
      sort: "NAME_ASC",
    });
  const catalogKey = savedCaseQueryCatalogKey(catalogFilters);
  const catalog = trpcReact.caseQueries.savedList.useQuery(
    {
      projectId,
      offset,
      catalog: catalogFilters,
      ...(origin
        ? {
            expectedScope: {
              organizationId: origin.organizationId,
              clerkActorId: origin.clerkActorId,
            },
          }
        : {}),
    },
    { enabled: scopeReady, staleTime: 0, retry: false },
  );
  const current = trpcReact.caseQueries.savedById.useQuery(
    {
      projectId,
      id: selected || "unselected",
      ...(origin
        ? {
            expectedScope: {
              organizationId: origin.organizationId,
              clerkActorId: origin.clerkActorId,
            },
          }
        : {}),
    },
    { enabled: scopeReady && !!selected, staleTime: 0, retry: false },
  );
  const write = trpcReact.caseQueries.savedWrite.useMutation();
  const readyCatalog =
    scopeReady &&
    !catalog.error &&
    !catalog.isFetching &&
    !catalog.isPaused &&
    catalog.data?.projectId === projectId &&
    catalog.data.organizationId === origin?.organizationId &&
    catalog.data.clerkActorId === userId &&
    catalog.data.offset === offset &&
    savedQueryCatalogEchoMatches(
      catalog.data,
      origin,
      offset,
      catalogFilters,
      catalogKey,
    )
      ? catalog.data
      : null;
  const readyCurrent =
    scopeReady &&
    !!selected &&
    !current.error &&
    !current.isFetching &&
    !current.isPaused &&
    current.data?.projectId === projectId &&
    current.data.organizationId === origin?.organizationId &&
    current.data.clerkActorId === userId &&
    current.data.value.id === selected
      ? current.data
      : null;
  const freshWrite = !!readyCatalog?.canWrite;
  // A current catalog seat does not reauthorize a previously loaded private body.
  // Preserve the draft, but hide its controls until the selected body is fresh.
  const draftReady = freshWrite && (!selected || !!readyCurrent);
  const reviewedCurrent =
    !!baseline &&
    readyCurrent?.value.id === baseline.id &&
    readyCurrent.value.version === baseline.version &&
    !!readyCurrent.canEdit;
  const busy = write.isPending;
  const frozen = busy || !!pendingRequest;
  function applyCatalog(next: SavedCaseQueryCatalogFilters) {
    if (!scopeReady || frozen) return;
    setCatalogFilters(next);
    setOffset(0);
    // Catalog navigation never erases the loaded human draft or exact request.
  }
  function clearSelection() {
    setSelected("");
    setBaseline(null);
    setDeleteConfirmed(false);
    setName("");
    setVisibility("PRIVATE");
  }
  async function submit(input: SavedCaseQueryWriteInput, recovering = false) {
    if (busy || !freshWrite || !scopeReady) return;
    if (!pendingRequest && !draftReady) return;
    if (!pendingRequest)
      input = {
        ...input,
        expectedScope: {
          organizationId: origin!.organizationId,
          clerkActorId: origin!.clerkActorId,
        },
      };
    const captured = pendingRequest ?? structuredClone(input);
    setPendingRequest(captured);
    setMessage("");
    let receipt: SavedCaseQueryWriteResponse;
    try {
      receipt = await write.mutateAsync(captured);
      if (
        receipt.requestId !== captured.requestId ||
        receipt.operation !== captured.operation ||
        receipt.value.projectId !== projectId
      )
        throw Error("Unexpected saved-query receipt");
    } catch (error) {
      const retain = retainSavedQueryRequest(recovering, error);
      if (!retain) setPendingRequest(null);
      setMessage(
        retain
          ? "Could not confirm this query change. Its exact request is retained. Retry it before making a different change."
          : "This query change was not accepted. Refresh and load the current definition before reviewing another change.",
      );
      return;
    }
    // An accepted receipt is distinct from subsequent read/access recovery.
    // Catalog failures cannot turn this ACK into another uncertain write.
    setPendingRequest(null);
    setDeleteConfirmed(false);
    setBaseline(null);
    if (receipt.value.deleted) clearSelection();
    else setSelected(receipt.value.id);
    const acknowledgement = `${receipt.operation === "DELETE" ? "Deleted" : "Saved"} query version ${receipt.value.version}. This receipt does not freeze its result rows. Load the current definition before another edit.`;
    setMessage(acknowledgement);
    void Promise.all([
      catalog.refetch({ throwOnError: true }),
      ...(receipt.value.id === selected && !receipt.value.deleted
        ? [current.refetch({ throwOnError: true })]
        : []),
    ]).catch(() =>
      setMessage(
        `${acknowledgement} Current saved definitions could not be refreshed; the accepted change was not retried.`,
      ),
    );
  }
  function save(operation: "CREATE" | "UPDATE") {
    if (!draftReady || frozen) return;
    const parsed = savedCaseQueryDefinition.safeParse({
      name,
      visibility,
      query,
      columns,
    });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? "Review the saved query.");
      return;
    }
    if (operation === "UPDATE" && (!baseline || !reviewedCurrent)) return;
    void submit(
      operation === "CREATE"
        ? {
            operation,
            projectId,
            requestId: crypto.randomUUID(),
            definition: parsed.data,
          }
        : {
            operation,
            projectId,
            requestId: crypto.randomUUID(),
            id: baseline!.id,
            expectedVersion: baseline!.version,
            definition: parsed.data,
          },
    );
  }
  return (
    <details style={{ marginBlock: 16 }}>
      <summary>Saved queries and column layouts</summary>
      <p className="text-muted">
        Personal definitions belong to their creator. Shared definitions are
        visible to current project members. A full editor seat is required to
        save changes. Loading never changes cases or existing table selection.
      </p>
      {scopeReady && (
        <fieldset
          disabled={frozen}
          style={{ display: "grid", gap: 12, minWidth: 0 }}
        >
          <legend>Find saved queries</legend>
          <label style={label}>
            Query name contains (literal, case-insensitive)
            <input
              style={control}
              value={catalogSearch}
              maxLength={80}
              onChange={(event) => setCatalogSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyCatalog({ ...catalogFilters, search: catalogSearch });
                }
              }}
            />
          </label>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              applyCatalog({ ...catalogFilters, search: catalogSearch })
            }
          >
            Search saved queries
          </button>
          <label style={label}>
            Collection
            <select
              style={control}
              value={catalogFilters.collection}
              onChange={(event) =>
                applyCatalog({
                  ...catalogFilters,
                  collection: event.target
                    .value as SavedCaseQueryCatalogFilters["collection"],
                })
              }
            >
              <option value="ALL">Personal and shared</option>
              <option value="PERSONAL">Personal only</option>
              <option value="SHARED">Shared only</option>
              <option value="MINE">Created by me (personal or shared)</option>
            </select>
          </label>
          <label style={label}>
            Sort
            <select
              style={control}
              value={catalogFilters.sort}
              onChange={(event) =>
                applyCatalog({
                  ...catalogFilters,
                  sort: event.target
                    .value as SavedCaseQueryCatalogFilters["sort"],
                })
              }
            >
              <option value="NAME_ASC">Name A–Z</option>
              <option value="NAME_DESC">Name Z–A</option>
              <option value="UPDATED_DESC">Recently edited</option>
            </select>
          </label>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setCatalogSearch("");
              applyCatalog({ search: "", collection: "ALL", sort: "NAME_ASC" });
            }}
          >
            Clear catalog filters
          </button>
          <p className="text-muted">
            Name search treats %, _ and backslashes as ordinary characters, not
            wildcards. Loaded criteria and your save draft are retained when
            catalog filters change.
          </p>
        </fieldset>
      )}
      {scopeReady && message && <p role="status">{message}</p>}
      {pendingRequest && (
        <div role="alert">
          <p>
            Unconfirmed saved-query request. Name, scope, columns and version
            remain fixed, including after this module is closed.
          </p>
          {!scopeReady && (
            <p>
              The original account/workspace request is retained privately.
              Return to that identity and verified access before retrying; it
              will not be submitted as another actor.
            </p>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !freshWrite || !scopeReady}
            onClick={() => void submit(pendingRequest, true)}
          >
            Retry exact saved-query change
          </button>
        </div>
      )}
      {scopeChanged || (isLoaded && !actorReady) ? (
        <p role="alert">
          Saved-query names, loaded criteria and draft controls are hidden after
          an account or workspace change. Your original draft and exact request
          are retained; return to the original identity to continue this module.
        </p>
      ) : catalog.error ||
        (scopeReady &&
          !!catalog.data &&
          !catalog.isFetching &&
          !catalog.isPaused &&
          !readyCatalog) ? (
        <div role="alert">
          <p>
            Saved queries unavailable. Cached permission or definitions cannot
            authorize changes.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void catalog.refetch()}
            disabled={!scopeReady || catalog.isFetching || catalog.isPaused}
          >
            Retry saved queries
          </button>
        </div>
      ) : !readyCatalog ? (
        <p role="status">
          {catalog.isPaused
            ? "Waiting for a connection to verify saved queries…"
            : "Checking saved queries and current access…"}
        </p>
      ) : (
        <>
          <label style={label}>
            Saved query
            <select
              style={control}
              value={selected}
              disabled={frozen}
              onChange={(event) => {
                setSelected(event.target.value);
                setBaseline(null);
                setDeleteConfirmed(false);
                setMessage("");
              }}
            >
              <option value="">Choose a personal or shared query…</option>
              {selected &&
                !readyCatalog.items.some((item) => item.id === selected) && (
                  <option value={selected}>
                    Selected query (load its current definition)
                  </option>
                )}
              {readyCatalog.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ·{" "}
                  {item.visibility === "SHARED" ? "Shared" : "Personal"}
                  {item.mine ? " · Yours" : ""}
                </option>
              ))}
            </select>
          </label>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBlock: 8,
            }}
          >
            <button
              type="button"
              className="btn-secondary"
              disabled={frozen || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Previous saved queries
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={
                frozen ||
                !reachableSavedQueryPage(readyCatalog.nextOffset, offset)
              }
              onClick={() => {
                if (reachableSavedQueryPage(readyCatalog.nextOffset, offset))
                  setOffset(readyCatalog.nextOffset!);
              }}
            >
              Next saved queries
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                void catalog.refetch();
                if (selected) void current.refetch();
              }}
            >
              Refresh saved definitions
            </button>
          </div>
          <p role="status">
            Catalog page {Math.floor(offset / 50) + 1} of at most 4 ·{" "}
            {readyCatalog.items.length} definitions shown
            {catalogFilters.search
              ? ` · Name contains “${catalogFilters.search}”`
              : ""}
            .
          </p>
          <p className="text-muted">{readyCatalog.limitation}</p>
          {readyCatalog.catalogTruncated && (
            <p role="status">
              More matching definitions exist beyond this bounded four-page
              window. Narrow the name or collection to find them; no unreachable
              next page will be requested.
            </p>
          )}
          {!readyCatalog.items.length && (
            <p>No saved queries on this catalog page.</p>
          )}
          {selected &&
            (current.error ||
            (!!current.data &&
              !current.isFetching &&
              !current.isPaused &&
              !readyCurrent) ? (
              <div role="alert">
                <p>
                  The selected query is unavailable. No cached definition has
                  been substituted.
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void current.refetch()}
                >
                  Retry selected definition
                </button>
              </div>
            ) : !readyCurrent ? (
              <p role="status">
                {current.isPaused
                  ? "Waiting for the current definition…"
                  : "Checking the selected definition…"}
              </p>
            ) : (
              <>
                <p>
                  {readyCurrent.value.name} · Version{" "}
                  {readyCurrent.value.version} ·{" "}
                  {readyCurrent.value.visibility === "SHARED"
                    ? "Shared with current project members"
                    : "Personal"}
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={frozen}
                  onClick={() => {
                    const value = structuredClone(readyCurrent.value);
                    setBaseline(value);
                    setName(value.name);
                    setVisibility(value.visibility);
                    setDeleteConfirmed(false);
                    onLoad(value.query, value.columns);
                    setMessage(
                      "Loaded current criteria and column order. Run the query to read current cases.",
                    );
                  }}
                >
                  Load query and columns
                </button>
                {baseline &&
                  baseline.version !== readyCurrent.value.version && (
                    <p role="alert">
                      The saved definition changed since you loaded it. Your
                      current criteria have not been overwritten; load the
                      current version explicitly before saving.
                    </p>
                  )}
              </>
            ))}
          {draftReady ? (
            <fieldset disabled={frozen} style={{ marginTop: 16, minWidth: 0 }}>
              <legend>Save current criteria and columns</legend>
              <label style={label}>
                Query name
                <input
                  style={control}
                  value={name}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label style={{ ...label, marginBlock: 12 }}>
                Visibility
                <select
                  style={control}
                  value={visibility}
                  onChange={(event) =>
                    setVisibility(event.target.value as "PRIVATE" | "SHARED")
                  }
                >
                  <option value="PRIVATE">Personal</option>
                  <option value="SHARED">Shared with this project</option>
                </select>
              </label>
              {visibility === "SHARED" && (
                <p>
                  Other current project members can load these conditions and
                  column labels. Do not put secrets or restricted source text in
                  them. Full editors can edit shared definitions; only their
                  creator can make them personal.
                </p>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!name.trim()}
                  onClick={() => save("CREATE")}
                >
                  Save new query
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={
                    !name.trim() ||
                    !reviewedCurrent ||
                    (visibility === "PRIVATE" && !readyCurrent?.canMakePrivate)
                  }
                  onClick={() => save("UPDATE")}
                >
                  Update loaded query
                </button>
              </div>
              {reviewedCurrent && (
                <details style={{ marginTop: 16 }}>
                  <summary>Delete loaded definition</summary>
                  <p>
                    Deletes the saved definition only. Test cases, runs and
                    existing table views are unchanged. Its retry receipt
                    remains retained.
                  </p>
                  <label style={{ display: "flex", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={deleteConfirmed}
                      onChange={(event) =>
                        setDeleteConfirmed(event.target.checked)
                      }
                    />
                    Confirm deletion of {baseline!.name}, version{" "}
                    {baseline!.version}
                  </label>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!deleteConfirmed}
                    onClick={() =>
                      void submit({
                        operation: "DELETE",
                        projectId,
                        requestId: crypto.randomUUID(),
                        id: baseline!.id,
                        expectedVersion: baseline!.version,
                      })
                    }
                  >
                    Delete saved query
                  </button>
                </details>
              )}
            </fieldset>
          ) : freshWrite ? (
            <p role="status">
              Your draft is retained privately. Verify the selected definition
              before showing its draft controls or reviewing another change.
            </p>
          ) : (
            <p>
              Saved definitions are read-only for your current seat. Loading and
              running visible queries remains available.
            </p>
          )}
        </>
      )}
    </details>
  );
}
