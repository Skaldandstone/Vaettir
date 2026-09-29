"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { ConnectionLink, ProviderMark } from "@/components/SourceConnectionChips";
import { ProjectPopulationModal } from "@/components/ProjectPopulationModal";
import { ProjectRepositories } from "@/components/ProjectRepositories";

// P1-15
export default function ProjectOverviewPage() {
  const [populationOpen, setPopulationOpen] = useState(false);
  const { projectId } = useParams<{ projectId: string }>();
  const { canEdit } = useProjectPermissions(projectId);
  const utils = trpcReact.useUtils();

  const projectQuery = trpcReact.project.byId.useQuery({ id: projectId });
  const testCasesQuery = trpcReact.testCases.list.useQuery({ projectId });
  const testPlansQuery = trpcReact.testPlans.list.useQuery({ projectId });
  const requirementsQuery = trpcReact.requirements.list.useQuery({ projectId });
  const pendingReviewQuery = trpcReact.testCases.pendingReview.useQuery({
    projectId,
  });

  const [connectRepoUrl, setConnectRepoUrl] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);

  const connectMutation = trpcReact.project.update.useMutation({
    onSuccess: () => {
      setConnectRepoUrl("");
      void utils.project.byId.invalidate({ id: projectId });
    },
    onError: (e) => setConnectError(e.message),
  });

  function connectRepo() {
    const project = projectQuery.data;
    if (!canEdit || !project || !connectRepoUrl.trim()) return;
    setConnectError(null);
    connectMutation.mutate({
      id: project.id,
      name: project.name,
      repoUrl: connectRepoUrl.trim(),
      defaultBranch: project.defaultBranch,
    });
  }

  // P9-04: routes an inbound PagerDuty incident.triggered webhook to this
  // project - see server.ts's /webhooks/pagerduty and services/
  // pagerdutyWebhook.ts. Configuring it here is what makes that routing
  // possible at all; PagerDuty's own webhook payload carries a service id
  // and nothing else Vaettir-specific to match against.
  const [pagerdutyServiceId, setPagerdutyServiceId] = useState("");
  const [pagerdutyError, setPagerdutyError] = useState<string | null>(null);
  const pagerdutyMutation = trpcReact.project.update.useMutation({
    onSuccess: () => {
      setPagerdutyServiceId("");
      void utils.project.byId.invalidate({ id: projectId });
    },
    onError: (e) => setPagerdutyError(e.message),
  });

  function savePagerdutyServiceId() {
    const project = projectQuery.data;
    if (!canEdit || !project) return;
    setPagerdutyError(null);
    pagerdutyMutation.mutate({
      id: project.id,
      name: project.name,
      defaultBranch: project.defaultBranch,
      pagerdutyServiceId,
    });
  }

  // Seeds the input from the real saved value once it loads, so an
  // untouched Save can't accidentally clear an already-configured id -
  // clearing only happens if the user actually empties the field on
  // purpose.
  useEffect(() => {
    if (projectQuery.data)
      setPagerdutyServiceId(projectQuery.data.pagerdutyServiceId ?? "");
  }, [projectQuery.data]);

  // P9-04 (Datadog half): the tag value this project's Datadog monitors
  // should carry (vaettir_project:<this value>) - see server.ts's
  // /webhooks/datadog and the org settings page for the webhook secret +
  // full payload template this pairs with.
  const [datadogProjectTag, setDatadogProjectTag] = useState("");
  const [datadogError, setDatadogError] = useState<string | null>(null);
  const datadogMutation = trpcReact.project.update.useMutation({
    onSuccess: () => {
      setDatadogProjectTag("");
      void utils.project.byId.invalidate({ id: projectId });
    },
    onError: (e) => setDatadogError(e.message),
  });

  function saveDatadogProjectTag() {
    const project = projectQuery.data;
    if (!canEdit || !project) return;
    setDatadogError(null);
    datadogMutation.mutate({
      id: project.id,
      name: project.name,
      defaultBranch: project.defaultBranch,
      datadogProjectTag,
    });
  }

  useEffect(() => {
    if (projectQuery.data)
      setDatadogProjectTag(projectQuery.data.datadogProjectTag ?? "");
  }, [projectQuery.data]);

  const project = projectQuery.data;
  const testCaseCount = testCasesQuery.data?.length ?? null;
  const testPlanCount = testPlansQuery.data?.length ?? null;
  const requirementCount = requirementsQuery.data?.length ?? null;
  const pendingReviewCount = pendingReviewQuery.data?.length ?? null;
  const error =
    connectError ??
    projectQuery.error?.message ??
    testCasesQuery.error?.message ??
    null;

  if (error) return <p style={{ color: "var(--ember)" }}>{error}</p>;
  if (!project) return <p>Loading…</p>;

  return (
    <div>
      <h1 style={{ marginBottom: 2 }}>{project.name}</h1>
      {canEdit && <button className="btn-secondary" onClick={() => setPopulationOpen(true)}>Update project understanding / Add sources</button>}
      {canEdit && populationOpen && <ProjectPopulationModal projectId={projectId} onClose={() => setPopulationOpen(false)} />}
      <ProjectRepositories projectId={projectId} canEdit={canEdit} />
      <p
        className="text-muted"
        style={{ marginBottom: project.repoUrl ? 24 : 8 }}
      >
        {project.repoUrl ?? "No repo connected"}{" "}
        {project.repoUrl && <>· branch {project.defaultBranch}</>}
      </p>

      <div
        className="project-connection-chips"
        id="project-connections"
        aria-label="Project connections"
      >
        {project.repoUrl && (
          <ConnectionLink href={`/projects/${projectId}/reverse-engineer`} provider="git" label="Repository" status="URL linked · Review and scan" />
        )}
        {canEdit && !project.repoUrl && (
          <details className="connection-chip">
            <summary><ProviderMark id="github" /><span><strong>GitHub</strong><small>Connect repository</small></span></summary>
            <div className="connection-chip-form">
              <strong>Connect a GitHub repo</strong>
              <p
                className="text-muted"
                style={{ fontSize: 13, margin: "4px 0 10px" }}
              >
                Lets you scan the repo to reverse-engineer test cases, run PR
                scanning, and link test cases back to real source files.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={connectRepoUrl}
                  onChange={(e) => setConnectRepoUrl(e.target.value)}
                  placeholder="https://github.com/org/repo"
                  style={{ flex: 1 }}
                />
                <button
                  className="btn-primary"
                  onClick={connectRepo}
                  disabled={connectMutation.isPending || !connectRepoUrl.trim()}
                >
                  {connectMutation.isPending ? "Connecting…" : "Connect"}
                </button>
              </div>
            </div>
          </details>
        )}

        <details className="connection-chip">
          <summary>
            <ProviderMark id="pagerduty" /><span><strong>PagerDuty</strong><small>
            {project.pagerdutyServiceId
              ? "Routing configured"
              : "Set up routing"}</small></span>
          </summary>
          <div className="connection-chip-form">
            <strong>PagerDuty incident linkage</strong>
            <p
              className="text-muted"
              style={{ fontSize: 13, margin: "4px 0 10px" }}
            >
              {project.pagerdutyServiceId
                ? `Connected to PagerDuty service ${project.pagerdutyServiceId}. A triggered incident on that service creates a risk flag on this project's most recently shipped release.`
                : "Paste this project's PagerDuty Service ID to have a triggered incident automatically create a risk flag on the most recently shipped release."}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={pagerdutyServiceId}
                disabled={!canEdit}
                onChange={(e) => setPagerdutyServiceId(e.target.value)}
                placeholder="PXXXXXX"
                style={{ flex: 1 }}
              />
              <button
                className="btn-secondary"
                onClick={savePagerdutyServiceId}
                disabled={!canEdit || pagerdutyMutation.isPending}
              >
                {pagerdutyMutation.isPending
                  ? "Saving…"
                  : project.pagerdutyServiceId
                    ? "Update"
                    : "Connect"}
              </button>
            </div>
            {pagerdutyError && (
              <p style={{ color: "var(--ember)", fontSize: 13, marginTop: 6 }}>
                {pagerdutyError}
              </p>
            )}
            <a href="/settings/integrations">
              Review organization integration setup
            </a>
          </div>
        </details>

        <details className="connection-chip">
          <summary>
            <ProviderMark id="datadog" /><span><strong>Datadog</strong><small>
            {project.datadogProjectTag ? "Routing configured" : "Set up routing"}</small></span>
          </summary>
          <div className="connection-chip-form">
            <strong>Datadog incident linkage</strong>
            <p
              className="text-muted"
              style={{ fontSize: 13, margin: "4px 0 10px" }}
            >
              {project.datadogProjectTag
                ? `Tag Datadog monitors with vaettir_project:${project.datadogProjectTag} to have a triggered alert automatically create a risk flag on this project's most recently shipped release.`
                : "Choose a tag value, then tag this project's Datadog monitors with vaettir_project:<that value> to have a triggered alert automatically create a risk flag."}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={datadogProjectTag}
                disabled={!canEdit}
                onChange={(e) => setDatadogProjectTag(e.target.value)}
                placeholder="e.g. checkout-service"
                style={{ flex: 1 }}
              />
              <button
                className="btn-secondary"
                onClick={saveDatadogProjectTag}
                disabled={!canEdit || datadogMutation.isPending}
              >
                {datadogMutation.isPending
                  ? "Saving…"
                  : project.datadogProjectTag
                    ? "Update"
                    : "Save"}
              </button>
            </div>
            {datadogError && (
              <p style={{ color: "var(--ember)", fontSize: 13, marginTop: 6 }}>
                {datadogError}
              </p>
            )}
            <a href="/settings/integrations">
              Review organization integration setup
            </a>
          </div>
        </details>
      </div>

      <section className="panel" style={{ marginBottom: 20 }}>
        <h2>Testing at a glance</h2>
        <p>
          {project.qualityProfile.objective ||
            "Define your project’s objective, then connect requirements, tests and release evidence."}
        </p>
        {testCasesQuery.isLoading ? (
          <p>Loading test inventory…</p>
        ) : testCaseCount ? (
          <>
            <p>
              Test type distribution across {testCaseCount} cases. This
              describes your inventory, not release readiness.
            </p>
            {Object.entries(
              (testCasesQuery.data ?? []).reduce<Record<string, number>>(
                (counts, test) => {
                  counts[test.testType] = (counts[test.testType] ?? 0) + 1;
                  return counts;
                },
                {},
              ),
            ).map(([type, count]) => (
              <div className="overview-distribution" key={type}>
                <span>{type.replace(/_/g, " ").toLowerCase()}</span>
                <meter
                  min={0}
                  max={testCaseCount}
                  value={count}
                  aria-label={`${type}: ${count} of ${testCaseCount} cases`}
                />
                <span>{count}</span>
              </div>
            ))}
          </>
        ) : (
          <p>
            No test inventory yet. Import existing cases or create the first
            case to begin.
          </p>
        )}
        <p>
          {pendingReviewCount == null
            ? "Review queue loading…"
            : pendingReviewCount > 0
              ? `${pendingReviewCount} drafted cases need human review before use.`
              : "No cases currently awaiting review."}
        </p>
        <a href={`/projects/${projectId}/releases`}>
          Open release readiness and blockers →
        </a>
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        <a
          href={`/projects/${projectId}/test-cases`}
          className="panel"
          style={{ display: "block" }}
        >
          <div className="eyebrow">Test Cases</div>
          <div style={{ fontSize: 28, fontFamily: "Fraunces, serif" }}>
            {testCaseCount}
          </div>
        </a>
        <a
          href={`/projects/${projectId}/test-plans`}
          className="panel"
          style={{ display: "block" }}
        >
          <div className="eyebrow">Test Plans</div>
          <div style={{ fontSize: 28, fontFamily: "Fraunces, serif" }}>
            {testPlanCount}
          </div>
        </a>
        <a
          href={`/projects/${projectId}/requirements`}
          className="panel"
          style={{ display: "block" }}
        >
          <div className="eyebrow">Requirements</div>
          <div style={{ fontSize: 28, fontFamily: "Fraunces, serif" }}>
            {requirementCount}
          </div>
        </a>
        <a
          href={`/projects/${projectId}/test-cases/review`}
          className="panel"
          style={{
            display: "block",
            borderColor: pendingReviewCount ? "var(--ember)" : undefined,
          }}
        >
          <div className="eyebrow">Pending Review</div>
          <div
            style={{
              fontSize: 28,
              fontFamily: "Fraunces, serif",
              color: pendingReviewCount ? "var(--ember)" : undefined,
            }}
          >
            {pendingReviewCount}
          </div>
        </a>
      </div>

      {testCaseCount === 0 && (
        <div className="panel">
          <p style={{ marginBottom: project.repoUrl ? 12 : 0 }}>
            No test cases tracked yet.
          </p>
          {!canEdit ? (
            <p className="text-muted">
              Ask your team owner or an editor to add test cases.
            </p>
          ) : project.repoUrl ? (
            <a
              className="btn-primary"
              href={`/projects/${projectId}/reverse-engineer`}
            >
              Scan {project.repoUrl}
            </a>
          ) : (
            <p className="text-muted" style={{ fontSize: 13 }}>
              Connect a repo above and scan it, or{" "}
              <a href={`/projects/${projectId}/test-cases/new`}>
                author a test case manually
              </a>
              .
            </p>
          )}
        </div>
      )}
    </div>
  );
}
