"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { trpcReact } from "@/lib/trpcReact";
import {
  reportCatalogInput,
  reportCatalogKey,
  type ReportCatalogInput,
} from "@vaettir/api/src/services/reportCatalogSchema";
import {
  REPORT_TEMPLATES,
  REPORT_TEMPLATE_IDS,
  type ReportTemplateId,
} from "@/lib/report-templates";
import { readableMetric } from "@/lib/frozen-report";
import {
  ReportSnapshotComparison,
  type SelectedReportSnapshot,
} from "./ReportSnapshotComparison";

export function ReportSnapshotCatalog({ projectId }: { projectId: string }) {
  return <Catalog key={projectId} projectId={projectId} />;
}
function Catalog({ projectId }: { projectId: string }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [originalActor, setOriginalActor] = useState<string | null>(null);
  const actorReady = isLoaded && isSignedIn && !!userId;
  if (!originalActor && actorReady && userId) setOriginalActor(userId);
  const actorMatches = actorReady && originalActor === userId;
  const project = trpcReact.project.byId.useQuery(
    { id: projectId },
    { enabled: actorMatches, retry: false, staleTime: 0 },
  );
  const organizations = trpcReact.organization.mine.useQuery(undefined, {
    enabled: actorMatches,
    retry: false,
    staleTime: 0,
  });
  const organizationId =
    project.data?.id === projectId ? project.data.organizationId : undefined;
  const projectReady =
    actorMatches &&
    !project.error &&
    !project.isFetching &&
    !project.isPaused &&
    project.data?.id === projectId;
  const accessReady =
    projectReady &&
    !organizations.error &&
    !organizations.isFetching &&
    !organizations.isPaused &&
    !!organizations.data?.some((org) => org.id === organizationId);
  const [selected, setSelected] = useState<SelectedReportSnapshot[]>([]);
  const [selectionOrganization, setSelectionOrganization] = useState<
    string | undefined
  >();
  const [compareOpen, setCompareOpen] = useState(false);
  const defaults = (): ReportCatalogInput => ({
    projectId,
    page: 0,
    search: "",
    audience: "all",
    purpose: "all",
    sort: "captured-desc",
  });
  const [filters, setFilters] = useState(defaults),
    [draft, setDraft] = useState(defaults);
  const [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [message, setMessage] = useState("");
  const query = trpcReact.reportSnapshots.catalog.useQuery(filters, {
    staleTime: 0,
    retry: false,
    enabled: accessReady,
  });
  const data =
    accessReady &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.projectId === projectId &&
    query.data.organizationId === organizationId &&
    query.data.requestKey === reportCatalogKey(filters)
      ? query.data
      : null;
  const previousOrganization = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      organizationId &&
      previousOrganization.current &&
      previousOrganization.current !== organizationId
    ) {
      setSelected([]);
      setSelectionOrganization(undefined);
      setCompareOpen(false);
      setMessage("");
      setFilters((current) => ({ ...current, page: 0 }));
      void query.refetch();
    }
    if (organizationId) previousOrganization.current = organizationId;
  }, [organizationId, query.refetch]);
  const currentSelected =
    selectionOrganization === organizationId ? selected : [];
  const missingMembership =
    projectReady &&
    !organizations.error &&
    !organizations.isFetching &&
    !organizations.isPaused &&
    !!organizations.data &&
    !organizations.data.some((org) => org.id === organizationId);
  const wrongIdentity =
    accessReady &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    !!query.data &&
    (query.data.projectId !== projectId ||
      query.data.organizationId !== organizationId ||
      query.data.requestKey !== reportCatalogKey(filters));
  async function refresh() {
    if (!actorMatches) return;
    await Promise.all([
      project.refetch(),
      organizations.refetch(),
      query.refetch(),
    ]);
  }
  function apply() {
    if (!accessReady) return;
    const parsed = reportCatalogInput.safeParse({
      ...draft,
      page: 0,
      capturedInterval: start || end ? { start, end } : undefined,
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Review the search filters.",
      );
      return;
    }
    setMessage("");
    setFilters(parsed.data);
  }
  function sort(next: ReportCatalogInput["sort"]) {
    if (!accessReady) return;
    setDraft({ ...draft, sort: next });
    setFilters({ ...filters, page: 0, sort: next });
  }
  if (!actorMatches) return <p role="status">Report catalog context is retained but hidden until the original account is signed in.</p>;
  return (
    <section aria-label="Approved report catalog" style={{ marginTop: 20 }}>
      <h3>Approved snapshots</h3>
      {compareOpen && actorMatches &&
        selectionOrganization === organizationId &&
        currentSelected.length === 2 && (
          <ReportSnapshotComparison
            projectId={projectId}
            selected={currentSelected}
            onClose={() => setCompareOpen(false)}
          />
        )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "end",
          }}
        >
          <label
            style={{ display: "grid", gap: 6, flex: "1 1 200px", minWidth: 0 }}
          >
            Find a report
            <input
              type="search"
              value={draft.search}
              maxLength={80}
              placeholder="Search report titles"
              onChange={(event) =>
                setDraft({ ...draft, search: event.target.value })
              }
              style={{ width: "100%", boxSizing: "border-box" }}
            />
          </label>
          <button
            type="submit"
            className="btn-secondary"
            disabled={!accessReady || query.isFetching}
          >
            Search
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setDraft(defaults());
              setFilters(defaults());
              setStart("");
              setEnd("");
              setMessage("");
            }}
          >
            Clear filters
          </button>
        </div>
        <details style={{ marginBlock: 12 }}>
          <summary>Filter by audience, purpose or capture date</summary>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit,minmax(min(100%,180px),1fr))",
              gap: 12,
              marginTop: 12,
            }}
          >
            <label style={{ display: "grid", gap: 6 }}>
              Audience
              <select
                value={draft.audience}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    audience: event.target
                      .value as ReportCatalogInput["audience"],
                  })
                }
              >
                <option value="all">All audiences</option>
                {["stakeholders", "engineering", "quality"].map((value) => (
                  <option key={value} value={value}>
                    {readableMetric(value)}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Started from
              <select
                value={draft.purpose}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    purpose: event.target
                      .value as ReportCatalogInput["purpose"],
                  })
                }
              >
                <option value="all">All report purposes</option>
                <option value="custom">Custom / older report</option>
                {REPORT_TEMPLATE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {REPORT_TEMPLATES[id].title}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Captured from (UTC)
              <input
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Captured through (UTC)
              <input
                type="date"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>
          </div>
          <p className="text-muted">
            <small>
              Both capture dates are required when narrowing dates, up to 366
              days. This does not change a report's execution interval.
            </small>
          </p>
          <button
            type="submit"
            className="btn-secondary"
            disabled={!accessReady || query.isFetching}
          >
            Apply filters
          </button>
        </details>
      </form>
      {message && <p role="alert">{message}</p>}
      {project.error ||
      organizations.error ||
      query.error ||
      missingMembership ||
      wrongIdentity ? (
        <div role="alert">
          <p>
            Report catalog unavailable. No cached reports or empty result have
            been substituted.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void refresh()}
          >
            Retry catalog
          </button>
        </div>
      ) : !data ? (
        <p role="status">
          {project.isPaused || organizations.isPaused || query.isPaused
            ? "Waiting for a connection to verify report access…"
            : "Loading current report catalog…"}
        </p>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
            }}
          >
            <p>
              {currentSelected.length} of 2 snapshots selected for comparison.
              Selection stays across catalog pages.
            </p>
            <button
              type="button"
              className="btn-secondary"
              disabled={currentSelected.length !== 2}
              onClick={() => setCompareOpen(true)}
            >
              Compare selected snapshots
            </button>
            {!!currentSelected.length && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelected([])}
              >
                Clear comparison selection
              </button>
            )}
          </div>
          {!!currentSelected.length && (
            <ul>
              {currentSelected.map((row) => (
                <li key={row.id}>
                  {row.title}{" "}
                  <button
                    type="button"
                    className="btn-secondary"
                    aria-label={`Remove ${row.title} from comparison`}
                    onClick={() =>
                      setSelected(
                        currentSelected.filter((item) => item.id !== row.id),
                      )
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <p role="status">
              {!data.total
                ? "No approved snapshots match these filters."
                : !data.items.length
                  ? "No snapshots on this page. Return to the first page or refresh."
                  : `${filters.page * 20 + 1}–${filters.page * 20 + data.items.length} of ${data.total} matching snapshots`}
            </p>
            <label>
              Sort{" "}
              <select
                value={filters.sort}
                onChange={(event) =>
                  sort(event.target.value as ReportCatalogInput["sort"])
                }
              >
                <option value="captured-desc">Newest capture first</option>
                <option value="title-asc">Title A–Z</option>
              </select>
            </label>
          </div>
          {!!data.items.length && (
            <div className="table-scroll">
              <table className="workspace-table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th scope="col">Compare</th>
                    <th
                      scope="col"
                      aria-sort={
                        filters.sort === "title-asc" ? "ascending" : "none"
                      }
                    >
                      Frozen snapshot
                    </th>
                    <th scope="col">Audience / starter</th>
                    <th
                      scope="col"
                      aria-sort={
                        filters.sort === "captured-desc" ? "descending" : "none"
                      }
                    >
                      Captured
                    </th>
                    <th scope="col">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Compare ${row.title}`}
                          checked={currentSelected.some(
                            (item) => item.id === row.id,
                          )}
                          disabled={
                            currentSelected.length === 2 &&
                            !currentSelected.some((item) => item.id === row.id)
                          }
                          onChange={(event) => {
                            setSelectionOrganization(organizationId);
                            setSelected(
                              event.target.checked
                                ? [
                                    ...currentSelected,
                                    {
                                      id: row.id,
                                      title: row.title,
                                      asOf: row.asOf,
                                    },
                                  ]
                                : currentSelected.filter(
                                    (item) => item.id !== row.id,
                                  ),
                            );
                          }}
                        />
                      </td>
                      <th
                        scope="row"
                        style={{
                          whiteSpace: "normal",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {row.title}
                      </th>
                      <td
                        style={{
                          whiteSpace: "normal",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {row.audience
                          ? readableMetric(row.audience)
                          : "Audience unavailable"}
                        <small style={{ display: "block" }}>
                          {row.purpose &&
                          REPORT_TEMPLATE_IDS.includes(
                            row.purpose as ReportTemplateId,
                          )
                            ? REPORT_TEMPLATES[row.purpose as ReportTemplateId]
                                .title
                            : row.purpose
                              ? "Unsupported starter identity"
                              : "Custom / older report"}
                        </small>
                      </td>
                      <td>{new Date(row.asOf).toLocaleString()}</td>
                      <td>
                        <Link
                          href={`/projects/${encodeURIComponent(projectId)}/reports/snapshots/${encodeURIComponent(row.id)}`}
                        >
                          Open report
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}
          >
            <button
              type="button"
              className="btn-secondary"
              disabled={filters.page === 0}
              onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
            >
              Previous snapshots
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={filters.page === 0}
              onClick={() => setFilters({ ...filters, page: 0 })}
            >
              First page
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={!data.hasMore || filters.page >= 24}
              onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
            >
              Next snapshots
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void refresh()}
            >
              Refresh snapshots
            </button>
          </div>
          {data.total > 500 && (
            <p className="text-muted">
              Browsing is bounded to the first 500 matches. Narrow the title,
              purpose, audience or capture dates to reach older snapshots.
            </p>
          )}
          <details style={{ marginTop: 12 }}>
            <summary>Catalog boundaries</summary>
            <ul>
              {data.limitations.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
