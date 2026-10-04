"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { trpcReact } from "@/lib/trpcReact";
import { Modal } from "./Modal";
import { RequirementCoverageExport } from "./RequirementCoverageExport";
import { readableMetric } from "@/lib/frozen-report";
import {
  requirementCoverageInput,
  requirementCoverageRequestKey,
  type RequirementCoverageInput,
} from "@vaettir/api/src/services/requirementCoverageSchema";

const control = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box" as const,
};
const label = { display: "grid", gap: 6, marginBlock: 12, minWidth: 0 };
const table = { width: "100%", minWidth: 620 };
const chip = {
  display: "inline-flex",
  padding: "6px 10px",
  border: "1px solid var(--border)",
  borderRadius: 18,
  overflowWrap: "anywhere" as const,
};
const outcomeKeys = ["PASS", "FAIL", "FLAKY", "SKIP", "BLOCKED"] as const;
function outcomes(value: Record<(typeof outcomeKeys)[number], number>) {
  return outcomeKeys
    .map((key) => `${readableMetric(key)} ${value[key]}`)
    .join(" · ");
}
function initial(projectId: string): RequirementCoverageInput {
  const now = new Date();
  return {
    projectId,
    asOf: now.toISOString(),
    interval: {
      start: new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10),
      end: now.toISOString().slice(0, 10),
    },
  };
}
export function RequirementCoverageMatrix({
  projectId,
}: {
  projectId: string;
}) {
  return <Matrix key={projectId} projectId={projectId} />;
}
function Matrix({ projectId }: { projectId: string }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const project = trpcReact.project.byId.useQuery(
    { id: projectId },
    { staleTime: 0, retry: false },
  );
  const organizations = trpcReact.organization.mine.useQuery(undefined, {
    staleTime: 0,
    retry: false,
  });
  const [originalClerkActorId, setOriginalClerkActorId] = useState<string>();
  const [scope, setScope] = useState<RequirementCoverageInput>(() =>
      initial(projectId),
    ),
    [organizationId, setOrganizationId] = useState<string>(),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [filtersOpen, setFiltersOpen] = useState(false),
    [draft, setDraft] = useState({
      start: scope.interval!.start,
      end: scope.interval!.end,
      planId: "",
      runId: "",
      platform: "",
      environment: "",
      build: "",
    }),
    [filterError, setFilterError] = useState(""),
    [requirementId, setRequirementId] = useState(""),
    [caseOffset, setCaseOffset] = useState(0),
    [caseId, setCaseId] = useState(""),
    [resultOffset, setResultOffset] = useState(0),
    [defectOffset, setDefectOffset] = useState(0);
  const actorReady = isLoaded && !!isSignedIn && !!userId;
  const projectReady =
    !project.error &&
    !project.isFetching &&
    !project.isPaused &&
    project.data?.id === projectId;
  const membershipReady =
    !organizations.error &&
    !organizations.isFetching &&
    !organizations.isPaused &&
    !!organizations.data?.some(
      (row) =>
        row.id === project.data?.organizationId &&
        ["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(
          row.role,
        ) &&
        ["FULL", "READ_ONLY"].includes(row.seatType),
    );
  const originChanged =
    (!!organizationId &&
      projectReady &&
      project.data?.organizationId !== organizationId) ||
    (!!originalClerkActorId && actorReady && originalClerkActorId !== userId);
  const ready =
    actorReady &&
    projectReady &&
    membershipReady &&
    !!organizationId &&
    !!originalClerkActorId &&
    !originChanged;
  useEffect(() => {
    if (
      actorReady &&
      projectReady &&
      membershipReady &&
      !organizationId &&
      !originalClerkActorId
    ) {
      setOrganizationId(project.data!.organizationId);
      setOriginalClerkActorId(userId!);
    }
  }, [
    actorReady,
    projectReady,
    membershipReady,
    organizationId,
    originalClerkActorId,
    project.data,
    userId,
  ]);
  const actorNow = useRef({ actorReady, userId });
  actorNow.current = { actorReady, userId };
  const base = {
    ...scope,
    ...(organizationId ? { originalOrganizationId: organizationId } : {}),
    ...(originalClerkActorId
      ? { expectedClerkActorId: originalClerkActorId }
      : {}),
  };
  const listInput = { ...base, search: search.trim(), offset },
    caseInput = { ...base, requirementId, offset: caseOffset },
    evidenceInput = {
      ...base,
      requirementId,
      caseId,
      resultOffset,
      defectOffset,
    };
  const list = trpcReact.requirementCoverage.list.useQuery(listInput, {
    enabled: ready,
    staleTime: 0,
  });
  const cases = trpcReact.requirementCoverage.cases.useQuery(caseInput, {
    enabled: ready && !!requirementId,
    staleTime: 0,
  });
  const evidence = trpcReact.requirementCoverage.evidence.useQuery(
    evidenceInput,
    { enabled: ready && !!requirementId && !!caseId, staleTime: 0 },
  );
  const options = trpcReact.reportSnapshots.scopeOptions.useQuery(
    { projectId },
    { enabled: ready && filtersOpen, staleTime: 0 },
  );
  const denied =
    originChanged ||
    !!project.error ||
    !!organizations.error ||
    (isLoaded && !actorReady) ||
    [
      list,
      ...(requirementId ? [cases] : []),
      ...(requirementId && caseId ? [evidence] : []),
      ...(filtersOpen ? [options] : []),
    ].some(
      (query) =>
        query.error &&
        ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(
          query.error.data?.code ?? "",
        ),
    );
  const accessPaused =
    project.isPaused ||
    organizations.isPaused ||
    list.isPaused ||
    (!!requirementId && cases.isPaused) ||
    (!!requirementId && !!caseId && evidence.isPaused);
  const catalog =
    ready &&
    !denied &&
    !accessPaused &&
    !list.error &&
    !list.isFetching &&
    !list.isPaused &&
    list.data?.projectId === projectId &&
    list.data.organizationId === organizationId &&
    list.data.actorClerkUserId === originalClerkActorId &&
    list.data.actorClerkUserId === userId &&
    list.data.requested === requirementCoverageRequestKey(listInput)
      ? list.data
      : null;
  const casePage =
    !denied &&
    !accessPaused &&
    !!catalog &&
    !!requirementId &&
    !cases.error &&
    !cases.isFetching &&
    !cases.isPaused &&
    cases.data?.projectId === projectId &&
    cases.data.organizationId === organizationId &&
    cases.data.actorClerkUserId === userId &&
    cases.data.actorClerkUserId === originalClerkActorId &&
    cases.data.requested === requirementCoverageRequestKey(caseInput)
      ? cases.data
      : null;
  const records =
    !denied &&
    !!caseId &&
    !!casePage &&
    !evidence.error &&
    !evidence.isFetching &&
    !evidence.isPaused &&
    evidence.data?.projectId === projectId &&
    evidence.data.organizationId === organizationId &&
    evidence.data.actorClerkUserId === userId &&
    evidence.data.actorClerkUserId === originalClerkActorId &&
    evidence.data.requested === requirementCoverageRequestKey(evidenceInput)
      ? evidence.data
      : null;
  const scopeOptions =
    ready &&
    !denied &&
    !options.error &&
    !options.isFetching &&
    !options.isPaused
      ? options.data
      : null;
  const prefix = `/projects/${encodeURIComponent(projectId)}`;
  function closeCases() {
    setRequirementId("");
    setCaseId("");
    setCaseOffset(0);
    setResultOffset(0);
    setDefectOffset(0);
  }
  function chooseRequirement(id: string) {
    setRequirementId(id);
    setCaseId("");
    setCaseOffset(0);
    setResultOffset(0);
    setDefectOffset(0);
  }
  function chooseCase(id: string) {
    setCaseId(id);
    setResultOffset(0);
    setDefectOffset(0);
  }
  async function recheckAccess(refreshWindow = false) {
    try {
      const [freshProject, freshOrganizations] = await Promise.all([
        project.refetch(),
        organizations.refetch(),
      ]);
      if (
        !originalClerkActorId ||
        !actorNow.current.actorReady ||
        actorNow.current.userId !== originalClerkActorId ||
        freshProject.error ||
        freshProject.isFetching ||
        freshProject.isPaused ||
        freshOrganizations.error ||
        freshOrganizations.isFetching ||
        freshOrganizations.isPaused ||
        freshProject.data?.id !== projectId ||
        !organizationId ||
        freshProject.data.organizationId !== organizationId ||
        !freshOrganizations.data?.some(
          (row) =>
            row.id === organizationId &&
            [
              "OWNER",
              "ADMIN",
              "EDITOR",
              "VIEWER",
              "COMPLIANCE_AUDITOR",
            ].includes(row.role) &&
            ["FULL", "READ_ONLY"].includes(row.seatType),
        )
      )
        return;
      if (refreshWindow) {
        setScope((value) => ({ ...value, asOf: new Date().toISOString() }));
        closeCases();
        return;
      }
      await list.refetch();
      if (requirementId) await cases.refetch();
      if (requirementId && caseId) await evidence.refetch();
      if (filtersOpen) await options.refetch();
    } catch {
      /* Preserve draft filters and selected references; failures do not authorize retained evidence. */
    }
  }
  function apply() {
    const selected = Object.fromEntries(
      (
        ["planId", "runId", "platform", "environment", "build"] as const
      ).flatMap((key) => (draft[key].trim() ? [[key, draft[key].trim()]] : [])),
    );
    const parsed = requirementCoverageInput.safeParse({
      projectId,
      asOf: new Date().toISOString(),
      interval: { start: draft.start, end: draft.end },
      ...(Object.keys(selected).length ? { scope: selected } : {}),
    });
    if (!parsed.success || draft.end > new Date().toISOString().slice(0, 10)) {
      setFilterError(
        "Choose valid past UTC dates within 366 days and bounded exact references.",
      );
      return;
    }
    setScope(parsed.data);
    setOffset(0);
    closeCases();
    setFiltersOpen(false);
    setFilterError("");
  }
  const retry = (query: { refetch: () => unknown }, caption: string) => (
    <button
      type="button"
      className="btn-secondary"
      onClick={() => void query.refetch()}
    >
      {caption}
    </button>
  );
  const pageButtons = (
    position: number,
    more: boolean,
    step: number,
    change: (n: number) => void,
  ) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBlock: 12 }}>
      <button
        type="button"
        className="btn-secondary"
        disabled={!position}
        onClick={() => change(position - step)}
      >
        Previous page
      </button>
      <span>Page {position / step + 1}</span>
      <button
        type="button"
        className="btn-secondary"
        disabled={!more}
        onClick={() => change(position + step)}
      >
        Next page
      </button>
    </div>
  );
  return (
    <section>
      <h1>Requirement coverage</h1>
      <p>
        Explore declared requirement → case relationships and recorded execution
        evidence. No passing result certifies a requirement or release.
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "end",
          gap: 12,
        }}
      >
        <label style={{ ...label, flex: "1 1 240px" }}>
          Find current requirements
          <input
            style={control}
            value={search}
            maxLength={80}
            onChange={(event) => {
              setSearch(event.target.value);
              setOffset(0);
              closeCases();
            }}
          />
        </label>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setFilterError("");
            setFiltersOpen(true);
          }}
        >
          Execution scope
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void recheckAccess(true)}
        >
          Refresh current records
        </button>
        <RequirementCoverageExport
          projectId={projectId}
          input={{ ...base, search: search.trim() }}
          available={!!catalog && ready && !denied && !accessPaused}
          organizationId={organizationId}
          clerkActorId={originalClerkActorId}
          revision={list.dataUpdatedAt}
        />
      </div>
      <p className="text-muted">
        Run-start UTC days: {scope.interval?.start} through{" "}
        {scope.interval?.end}.{" "}
        {scope.scope
          ? Object.entries(scope.scope)
              .map(([key, value]) => `${readableMetric(key)}: ${value}`)
              .join(" · ")
          : "All recorded configurations"}
        .
      </p>
      {denied ? (
        <div role="alert">
          <p>
            Current project access or original record ownership could not be
            verified. Retained tables and chips are hidden.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void recheckAccess()}
          >
            Recheck current access
          </button>
        </div>
      ) : accessPaused ? (
        <p role="status">
          Waiting for a connection to verify access and the active scope.
          Retained tables and chips are hidden.
        </p>
      ) : list.error ? (
        <div role="alert">
          <p>
            The matrix could not be loaded. No empty coverage or zero counts
            have been substituted. {list.error.message}
          </p>
          {retry(list, "Retry requirement matrix")}
        </div>
      ) : !catalog ? (
        <p role="status">
          {list.isPaused
            ? "Waiting for a connection to verify project access…"
            : "Loading current requirements and scoped evidence…"}
        </p>
      ) : (
        <>
          <p>
            {catalog.total} current requirements. Project-wide execution in this
            scope: {catalog.projectExecution.runs} runs;{" "}
            {catalog.projectExecution.resultRecords} result records;{" "}
            {catalog.projectExecution.unmatched} unmatched;{" "}
            {catalog.projectExecution.unavailableCaseReferences}{" "}
            unavailable/foreign case references. These are not requirement
            coverage denominators.
          </p>
          <p className="text-muted">
            Current inventory and outcome records observed{" "}
            {new Date(catalog.observedAt).toLocaleString()}. Run-start bounds{" "}
            {catalog.window.start} – {catalog.window.end}; not a frozen
            historical snapshot.
          </p>
          {!catalog.items.length ? (
            <p>
              No current native requirements match this search. This does not
              imply complete coverage.
            </p>
          ) : (
            <>
              <p className="text-muted">
                Scroll sideways for all table columns.
              </p>
              <div
                className="table-scroll"
                role="region"
                aria-label="Current requirement direct coverage matrix"
                tabIndex={0}
              >
                <table className="workspace-table" style={table}>
                  <thead>
                    <tr>
                      <th scope="col">Requirement</th>
                      <th scope="col">Declared direct cases</th>
                      <th scope="col">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.items.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <Link
                            href={`${prefix}/requirements#requirement-${encodeURIComponent(row.id)}`}
                          >
                            {row.title}
                          </Link>
                          {row.titleIsExcerpt && (
                            <small> · Title excerpt</small>
                          )}
                        </td>
                        <td>
                          {row.directCases
                            ? `${row.directCases} explicit current case links`
                            : "No explicit direct case links"}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => chooseRequirement(row.id)}
                          >
                            Explore cases and outcomes
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {pageButtons(offset, catalog.hasMore, 20, (n) => {
            setOffset(n);
            closeCases();
          })}
          <details>
            <summary>Evidence and scope limitations</summary>
            <ul>
              {catalog.limits.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
          </details>
        </>
      )}
      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Recorded execution scope"
      >
        <p>
          These filters select run-start dates and exact recorded context. They
          do not change current requirement links or infer absent configuration.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(min(220px,100%),1fr))",
            gap: 12,
          }}
        >
          {(
            [
              ["start", "Start UTC day"],
              ["end", "End UTC day"],
            ] as const
          ).map(([key, caption]) => (
            <label style={label} key={key}>
              {caption}
              <input
                type="date"
                style={control}
                value={draft[key]}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, [key]: event.target.value }))
                }
              />
            </label>
          ))}
        </div>
        <label style={label}>
          Recorded plan ID (optional)
          <input
            style={control}
            list="coverage-plans"
            value={draft.planId}
            maxLength={200}
            onChange={(event) =>
              setDraft((value) => ({ ...value, planId: event.target.value }))
            }
          />
        </label>
        <datalist id="coverage-plans">
          {scopeOptions?.plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </datalist>
        <label style={label}>
          Native run ID (optional)
          <input
            style={control}
            list="coverage-runs"
            value={draft.runId}
            maxLength={200}
            onChange={(event) =>
              setDraft((value) => ({ ...value, runId: event.target.value }))
            }
          />
        </label>
        <datalist id="coverage-runs">
          {scopeOptions?.runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.startedAt.toISOString()} · {run.ciProvider}
            </option>
          ))}
        </datalist>
        <details>
          <summary>Exact platform, environment and build</summary>
          {(
            [
              ["platform", 300],
              ["environment", 2000],
              ["build", 300],
            ] as const
          ).map(([key, max]) => (
            <label style={label} key={key}>
              {readableMetric(key)} (optional)
              <input
                style={control}
                value={draft[key]}
                maxLength={max}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, [key]: event.target.value }))
                }
              />
            </label>
          ))}
        </details>
        {options.error ? (
          <p role="alert">
            Recorded suggestions unavailable. Cached choices are hidden; exact
            recorded values can still be entered.
          </p>
        ) : options.isPaused ? (
          <p role="status">
            Suggestions paused until project access is verified.
          </p>
        ) : (
          scopeOptions && (
            <p className="text-muted">
              Suggestions include at most 100 current plans and 100 recent runs
              {scopeOptions.plansLimited || scopeOptions.runsLimited
                ? "; additional records are not listed"
                : ""}
              . Missing metadata is not inferred. Exact older native references
              may be entered.
            </p>
          )
        )}
        {filterError && <p role="alert">{filterError}</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setFiltersOpen(false)}
          >
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={apply}>
            Apply recorded scope
          </button>
        </div>
      </Modal>
      <Modal
        open={!!requirementId}
        onClose={closeCases}
        title="Declared case coverage and evidence"
        size="wide"
      >
        {denied ? (
          <p role="alert">
            Current access or original record ownership could not be verified.
            No retained evidence is displayed.
          </p>
        ) : accessPaused ? (
          <p role="status">
            Waiting for a connection to verify this scope. No retained evidence
            is displayed.
          </p>
        ) : cases.error ? (
          <div role="alert">
            <p>
              The direct case relationships could not be verified; no
              zero-coverage substitute is shown. {cases.error.message}
            </p>
            {retry(cases, "Retry explicit case relationships")}
          </div>
        ) : !casePage ? (
          <p role="status">
            {cases.isPaused
              ? "Waiting for a connection to verify relationships…"
              : "Verifying current direct relationships…"}
          </p>
        ) : (
          <>
            <h3>
              <Link
                href={`${prefix}/requirements#requirement-${encodeURIComponent(casePage.requirement.id)}`}
              >
                {casePage.requirement.title}
              </Link>
            </h3>
            <p>
              {casePage.total} explicitly linked current cases. Archived cases
              stay visible. No links are inferred from acceptance-criterion
              plans.
            </p>
            {!casePage.items.length ? (
              <p>
                No current explicit case links. Use the native requirement or
                case traceability editor to declare what a case tests.
              </p>
            ) : (
              <>
                <p className="text-muted">
                  Scroll sideways for all recorded outcome columns.
                </p>
                <div
                  className="table-scroll"
                  role="region"
                  aria-label="Explicit cases and recorded outcome counts"
                  tabIndex={0}
                >
                  <table
                    className="workspace-table"
                    style={{ ...table, minWidth: 760 }}
                  >
                    <thead>
                      <tr>
                        <th scope="col">Case</th>
                        <th scope="col">Outcomes in scope</th>
                        <th scope="col">Planned, not run</th>
                        <th scope="col">Explore</th>
                      </tr>
                    </thead>
                    <tbody>
                      {casePage.items.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <Link
                              style={chip}
                              href={`${prefix}/test-cases?caseId=${encodeURIComponent(row.id)}`}
                            >
                              {row.displayId}
                            </Link>
                            <div>
                              {row.title}
                              {row.titleIsExcerpt && " · Title excerpt"}
                            </div>
                            {row.archived && (
                              <strong>Currently archived</strong>
                            )}
                          </td>
                          <td>
                            {readableMetric(row.outcomes.state)}
                            <div>{outcomes(row.outcomes)}</div>
                          </td>
                          <td>
                            {row.plannedWithoutResult} manual run selections
                            without a recorded result
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => chooseCase(row.id)}
                            >
                              Runs and defect links
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {pageButtons(caseOffset, casePage.hasMore, 20, (n) => {
              setCaseOffset(n);
              setCaseId("");
            })}
            {caseId && (
              <section
                style={{
                  borderTop: "1px solid var(--border)",
                  marginTop: 16,
                  paddingTop: 16,
                }}
              >
                {evidence.error ? (
                  <div role="alert">
                    <p>
                      Recorded evidence could not be verified. Cached outcomes
                      and native links are withheld. {evidence.error.message}
                    </p>
                    {retry(evidence, "Retry recorded evidence")}
                  </div>
                ) : !records ? (
                  <p role="status">
                    {evidence.isPaused
                      ? "Waiting for a connection to verify evidence…"
                      : "Loading recorded evidence…"}
                  </p>
                ) : (
                  <>
                    <h3>
                      <Link
                        style={chip}
                        href={`${prefix}/test-cases?caseId=${encodeURIComponent(records.selectedCase.id)}`}
                      >
                        {records.selectedCase.displayId}
                      </Link>{" "}
                      · Recorded evidence
                    </h3>
                    <p>
                      {outcomes(records.outcomes)}.{" "}
                      {records.plannedWithoutResult} manual selections with no
                      recorded result. Outcomes are current records joined to
                      current case links, not requirement verification.
                    </p>
                    {!records.results.length ? (
                      <p>
                        No recorded results on this page in the selected
                        run-start scope. This is not PASS. Planned-but-not-run
                        counts remain separate.
                      </p>
                    ) : (
                      <div
                        className="table-scroll"
                        role="region"
                        aria-label="Recorded result references and native runs"
                        tabIndex={0}
                      >
                        <table className="workspace-table" style={table}>
                          <thead>
                            <tr>
                              <th scope="col">Recorded outcome</th>
                              <th scope="col">Result reference</th>
                              <th scope="col">Native run</th>
                              <th scope="col">Run started</th>
                            </tr>
                          </thead>
                          <tbody>
                            {records.results.map((result) => (
                              <tr key={result.id}>
                                <td>{readableMetric(result.status)}</td>
                                <td>
                                  <code>{result.id}</code>
                                  <small>
                                    {" "}
                                    · Result reference, no standalone result
                                    route
                                  </small>
                                </td>
                                <td>
                                  <Link
                                    style={chip}
                                    href={
                                      result.testRun.ciProvider === "manual"
                                        ? `${prefix}/test-runs/manual/${encodeURIComponent(result.testRunId)}`
                                        : `${prefix}/test-runs#run-${encodeURIComponent(result.testRunId)}`
                                    }
                                  >
                                    {result.testRun.ciProvider} ·{" "}
                                    {result.testRunId}
                                  </Link>
                                  <div>
                                    Run state:{" "}
                                    {readableMetric(result.testRun.status)}
                                    {result.testRun.providerIsExcerpt &&
                                      " · Provider label excerpt"}
                                  </div>
                                </td>
                                <td>
                                  {new Date(
                                    result.testRun.startedAt,
                                  ).toLocaleString()}
                                  <small>
                                    {" "}
                                    · Run-start time, not result-recorded time
                                  </small>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {pageButtons(
                      resultOffset,
                      records.hasMoreResults,
                      20,
                      setResultOffset,
                    )}
                    <h4>Explicit current native defect relationships</h4>
                    <p className="text-muted">
                      Not filtered by run date/configuration; a case link is not
                      evidence that a specific run tested or resolved the
                      defect. No tracker closure is interpreted as runtime
                      resolution.
                    </p>
                    {!records.defects.items.length ? (
                      <p>
                        No explicit retained native defect links on this page.
                      </p>
                    ) : (
                      <div style={{ display: "grid", gap: 8 }}>
                        {records.defects.items.map((defect) => (
                          <div key={defect.linkId}>
                            {defect.available && defect.nativeId ? (
                              <Link
                                style={chip}
                                href={`${prefix}/defect-map#defect-${encodeURIComponent(defect.nativeId)}`}
                              >
                                {defect.title}
                              </Link>
                            ) : (
                              <span style={chip}>
                                {defect.title} · Unavailable cluster (no native
                                link)
                              </span>
                            )}
                            <div>
                              {readableMetric(defect.sourceState)}
                              {defect.sourceObservedAt &&
                                ` · Source snapshot ${new Date(defect.sourceObservedAt).toLocaleString()}`}
                              {defect.titleIsExcerpt && " · Title excerpt"}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {pageButtons(
                      defectOffset,
                      records.defects.hasMore,
                      10,
                      setDefectOffset,
                    )}
                  </>
                )}
              </section>
            )}
            <details>
              <summary>Temporal and coverage limits</summary>
              <ul>
                {casePage.limits.map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
            </details>
          </>
        )}
      </Modal>
    </section>
  );
}
