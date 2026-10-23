"use client";

import Link from "next/link";
import { useState } from "react";
import { trpcReact } from "@/lib/trpcReact";
import { Icon, PageHeading, StatusPill } from "@/components/ui/Workspace";
import { Modal } from "@/components/Modal";
import { ProviderMark, SourceConnectionChips } from "@/components/SourceConnectionChips";
import { ProductionSignalChips } from "@/components/ProductionSignalChips";
import { integrationStatus } from "@/lib/integration-status";

// P9-00: the "connection-health view" this ticket calls for - one place
// to see every integration's real state (Slack, generic webhooks, Jira,
// Linear, PagerDuty, Datadog) instead of clicking through six separate
// settings sections to piece it together. Purely a read-only view over
// each integration's own existing config - see organization.ts's
// integrationsHealth query and its own comment on why a generic shared
// config layer isn't attempted here.

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export default function IntegrationsHealthPage() {
  const orgsQuery = trpcReact.organization.mine.useQuery();
  const orgId = orgsQuery.data?.[0]?.id ?? null;
  const healthQuery = trpcReact.organization.integrationsHealth.useQuery(
    { organizationId: orgId ?? "" },
    { enabled: orgId !== null },
  );
  const health = healthQuery.data;
  const [active, setActive] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const projectScoped = ["Jira", "Linear", "PagerDuty", "Datadog"].includes(active ?? "");
  const projectsQuery = trpcReact.project.list.useQuery(
    { organizationId: orgId ?? "" },
    { enabled: Boolean(orgId && active && projectScoped) },
  );
  const selectedProject = projectsQuery.isSuccess ? projectsQuery.data?.find(project => project.id === projectId) : undefined;

  if (orgsQuery.isPending || orgId && healthQuery.isPending) return <p>Loading…</p>;
  if (orgsQuery.error) return <p role="alert">Could not load workspace access: {orgsQuery.error.message}</p>;
  if (!orgId) return <p role="status">Choose or join a workspace before configuring integrations.</p>;
  if (!health)
    return (
      <p style={{ color: "var(--ember)" }}>
        {healthQuery.error?.message ?? "Could not load integration status."}
      </p>
    );

  const rows = [
    {
      name: "Slack",
      purpose:
        "Send release decisions, risk changes, and scheduled readiness digests to your team.",
      scope: "Organization",
      configured: health.slack.configured,
      detail: health.slack.configured
        ? `${health.slack.eventTypesSubscribed} event type(s) subscribed · digest ${health.slack.digestEnabled ? "on" : "off"} · last digest ${relativeTime(health.slack.lastDigestSentAt)}`
        : "No organization webhook configured",
      status: integrationStatus({ configured: health.slack.configured, kind: "slack", observedAt: health.slack.lastDigestSentAt }),
      action: "Review Slack setup",
    },
    {
      name: "Outbound webhooks",
      purpose:
        "Deliver signed quality events to internal systems and automation endpoints.",
      scope: "Organization",
      configured: health.webhooks.endpointCount > 0,
      detail:
        health.webhooks.endpointCount > 0
          ? `${health.webhooks.enabledCount}/${health.webhooks.endpointCount} enabled · last delivery ${relativeTime(health.webhooks.lastDeliveryAt)}${
              health.webhooks.lastDeliverySuccess === false ? " (failed)" : ""
            }`
          : "No endpoints configured",
      action: "Review webhook setup",
      status: integrationStatus({ configured: health.webhooks.endpointCount > 0, kind: "webhook", observedAt: health.webhooks.lastDeliveryAt, deliverySucceeded: health.webhooks.lastDeliverySuccess }),
    },
    {
      name: "Jira",
      purpose:
        "Link requirements and defects to test evidence, with inbound status updates.",
      scope: "Organization",
      configured: health.jira.configured,
      detail: health.jira.configured
        ? `${health.jira.linkedRequirementCount} requirement(s) linked · webhook ${health.jira.webhookConfigured ? "configured" : "not configured"} · last sync ${relativeTime(health.jira.lastSyncedAt)}`
        : "No legacy organization credentials configured",
      status: integrationStatus({ configured: health.jira.configured, kind: "tickets", observedAt: health.jira.lastSyncedAt }),
      action: "Connect Jira to a project",
    },
    {
      name: "Linear",
      purpose:
        "Connect product requirements to test coverage and delivery evidence.",
      scope: "Organization",
      configured: health.linear.configured,
      detail: health.linear.configured
        ? `${health.linear.linkedRequirementCount} requirement(s) linked · webhook ${health.linear.webhookConfigured ? "configured" : "not configured"} · last sync ${relativeTime(health.linear.lastSyncedAt)}`
        : "No legacy organization credentials configured",
      status: integrationStatus({ configured: health.linear.configured, kind: "tickets", observedAt: health.linear.lastSyncedAt }),
      action: "Connect Linear to a project",
    },
    {
      name: "PagerDuty",
      purpose:
        "Turn production incidents into release risk signals for the affected project.",
      scope: "Per project",
      configured: health.pagerduty.projectsConfigured > 0,
      detail:
        health.pagerduty.projectsConfigured > 0
          ? `${health.pagerduty.projectsConfigured} project(s) linked`
          : "No project configured with a PagerDuty service ID",
      action:
        health.pagerduty.projectsConfigured > 0
          ? "Review projects"
          : "Choose project",
      status: integrationStatus({ configured: health.pagerduty.projectsConfigured > 0, kind: "signal" }),
    },
    {
      name: "Datadog",
      purpose:
        "Route monitor alerts into the release risk view using project tags.",
      scope: "Per project",
      configured: health.datadog.projectsConfigured > 0,
      detail:
        health.datadog.projectsConfigured > 0
          ? `${health.datadog.projectsConfigured} project(s) tagged · webhook ${health.datadog.webhookConfigured ? "configured" : "not configured"}`
          : "No project tagged for Datadog",
      action:
        health.datadog.projectsConfigured > 0
          ? "Review projects"
          : "Choose project",
      status: integrationStatus({ configured: health.datadog.projectsConfigured > 0, kind: "signal", webhookRequired: health.datadog.projectsConfigured > 0 && !health.datadog.webhookConfigured }),
    },
  ];

  return (
    <div className="quality-workspace integrations-workspace">
      <PageHeading
        eyebrow="SETTINGS / CONNECTIONS"
        title="Integrations"
        description="Connect delivery, incident, and collaboration systems so readiness is based on real evidence rather than manual status chasing."
      />
      <p><Link className="btn-secondary" href="/settings/integrations/repositories">Manage repository applications</Link> <span className="text-muted">Workspace administrators only; members connect inside their project.</span></p>
      <div className="integration-summary" role="status">
        <strong>{rows.filter((row) => row.configured).length}</strong>
        <span>of {rows.length} legacy integration types configured; saved setup is not verified access</span>
        <div className="integration-summary-track" aria-hidden="true">
          <span
            style={{
              width: `${(rows.filter((row) => row.configured).length / rows.length) * 100}%`,
            }}
          />
        </div>
      </div>
      <div className="integration-grid">
        {rows.map((row) => (
          <article key={row.name} className="integration-card">
            <div className="integration-card-heading">
              <span className="integration-icon">
                {["Jira", "Linear", "PagerDuty", "Datadog"].includes(row.name) ? <ProviderMark id={row.name.toLowerCase()} /> : <Icon name="branch" size={20} />}
              </span>
              <div>
                <h2>{row.name}</h2>
                <span>{row.scope}</span>
              </div>
              <StatusPill tone={row.status.tone}>
                {row.status.label}
              </StatusPill>
            </div>
            <p>{row.purpose}</p>
            <div className="integration-detail">{row.detail}</div>
            <button type="button"
              className={row.configured ? "btn-secondary" : "btn-primary"}
              style={{ alignSelf: "flex-start", textAlign: "left" }}
              onClick={() => { setProjectId(null); setActive(row.name); }}
            >
              {row.action} <Icon name="arrow" size={14} />
            </button>
          </article>
        ))}
      </div>
      <p className="text-muted">This summary covers existing organization settings. Project-scoped connections are reviewed inside each project and are not included in the legacy counts above.</p>
      <Modal open={Boolean(active)} title={`${active ?? "Integration"} setup`} onClose={() => { setActive(null); setProjectId(null); }}>
        {active && projectScoped ? selectedProject ? <>
          <p role="status">Project: <strong>{selectedProject.name}</strong></p>
          {active === "Jira" || active === "Linear" ? <SourceConnectionChips projectId={selectedProject.id} only={[active.toLowerCase()]} /> : <ProductionSignalChips projectId={selectedProject.id} />}
          <button type="button" className="btn-secondary" onClick={() => setProjectId(null)}>Choose another project</button>
        </> : <>
          <h3>Which project should use {active}?</h3>
          <p>Choose the destination before authorizing access or saving routing. No provider is contacted by this project picker.</p>
          {projectsQuery.isPending && <p role="status">Loading accessible projects…</p>}
          {projectsQuery.error && <><p role="alert">Could not load projects: {projectsQuery.error.message}</p><button type="button" className="btn-secondary" onClick={() => void projectsQuery.refetch()}>Try again</button></>}
          {projectsQuery.isSuccess && !projectsQuery.data?.length && <p role="status">No accessible projects in this workspace. Create a project before connecting its sources.</p>}
          <div className="source-chip-list" role="group" aria-label="Integration destination project">{projectsQuery.isSuccess && projectsQuery.data?.map(project => <button key={project.id} type="button" className="source-connection-chip" style={{textAlign:"left",maxWidth:"100%"}} onClick={() => setProjectId(project.id)}><Icon name="folder" /><span style={{overflowWrap:"anywhere"}}><strong>{project.name}</strong><small>Open {active} options</small></span><span aria-hidden="true">→</span></button>)}</div>
        </> : active ? <>
          <h3>{rows.find(row => row.name === active)?.status.label}</h3>
          <p>{rows.find(row => row.name === active)?.detail}</p>
          <p>{active === "Slack" ? "Slack uses an incoming webhook tied to your chosen channel. A saved URL does not establish delivery. Review the webhook and subscribed events in organization settings; no message is sent from this dialog." : "Outbound webhooks use signed event deliveries. Review endpoint URLs, enabled events and delivery history in organization settings. A successful previous delivery does not establish current endpoint health."}</p>
          <p className="text-muted">Full Owner or Admin access is required to change organization configuration. This dialog only reviews setup; it does not write settings.</p>
          <Link className="btn-secondary" href="/settings/organization">Open organization configuration</Link>
        </> : null}
      </Modal>
    </div>
  );
}
