"use client";

import Link from "next/link";
import { trpcReact } from "@/lib/trpcReact";
import { Icon, PageHeading, StatusPill } from "@/components/ui/Workspace";

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

  if (orgsQuery.isPending || healthQuery.isPending) return <p>Loading…</p>;
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
        : "Not connected",
      href: "/settings/organization",
      action: health.slack.configured ? "Review Slack" : "Connect Slack",
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
      href: "/settings/organization",
      action:
        health.webhooks.endpointCount > 0 ? "Manage endpoints" : "Add endpoint",
    },
    {
      name: "Jira",
      purpose:
        "Link requirements and defects to test evidence, with inbound status updates.",
      scope: "Organization",
      configured: health.jira.configured,
      detail: health.jira.configured
        ? `${health.jira.linkedRequirementCount} requirement(s) linked · webhook ${health.jira.webhookConfigured ? "configured" : "not configured"} · last sync ${relativeTime(health.jira.lastSyncedAt)}`
        : "Not connected",
      href: "/settings/organization",
      action: health.jira.configured ? "Review Jira" : "Connect Jira",
    },
    {
      name: "Linear",
      purpose:
        "Connect product requirements to test coverage and delivery evidence.",
      scope: "Organization",
      configured: health.linear.configured,
      detail: health.linear.configured
        ? `${health.linear.linkedRequirementCount} requirement(s) linked · webhook ${health.linear.webhookConfigured ? "configured" : "not configured"} · last sync ${relativeTime(health.linear.lastSyncedAt)}`
        : "Not connected",
      href: "/settings/organization",
      action: health.linear.configured ? "Review Linear" : "Connect Linear",
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
      href: "/projects",
      action:
        health.pagerduty.projectsConfigured > 0
          ? "Review projects"
          : "Choose project",
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
      href: "/projects",
      action:
        health.datadog.projectsConfigured > 0
          ? "Review projects"
          : "Choose project",
    },
  ];

  return (
    <div className="quality-workspace integrations-workspace">
      <PageHeading
        eyebrow="SETTINGS / CONNECTIONS"
        title="Integrations"
        description="Connect delivery, incident, and collaboration systems so readiness is based on real evidence rather than manual status chasing."
      />
      <div className="integration-summary" role="status">
        <strong>{rows.filter((row) => row.configured).length}</strong>
        <span>of {rows.length} integration types configured</span>
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
                <Icon name="branch" size={20} />
              </span>
              <div>
                <h2>{row.name}</h2>
                <span>{row.scope}</span>
              </div>
              <StatusPill tone={row.configured ? "success" : "neutral"}>
                {row.configured ? "Connected" : "Not connected"}
              </StatusPill>
            </div>
            <p>{row.purpose}</p>
            <div className="integration-detail">{row.detail}</div>
            <Link
              className={row.configured ? "btn-secondary" : "btn-primary"}
              href={row.href}
            >
              {row.action} <Icon name="arrow" size={14} />
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
