"use client";

import { trpcReact } from "@/lib/trpcReact";

// P9-00: the "connection-health view" this ticket calls for - one place
// to see every integration's real state (Slack, generic webhooks, Jira,
// Linear, PagerDuty, Datadog) instead of clicking through six separate
// settings sections to piece it together. Purely a read-only view over
// each integration's own existing config - see organization.ts's
// integrationsHealth query and its own comment on why a generic shared
// config layer isn't attempted here.

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: 999,
        background: ok ? "var(--frost)" : "var(--muted-dim)",
        marginRight: 8,
      }}
    />
  );
}

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
  const healthQuery = trpcReact.organization.integrationsHealth.useQuery({ organizationId: orgId ?? "" }, { enabled: orgId !== null });
  const health = healthQuery.data;

  if (orgsQuery.isPending || healthQuery.isPending) return <p>Loading…</p>;
  if (!health) return <p style={{ color: "var(--ember)" }}>{healthQuery.error?.message ?? "Could not load integration status."}</p>;

  const rows = [
    {
      name: "Slack",
      configured: health.slack.configured,
      detail: health.slack.configured
        ? `${health.slack.eventTypesSubscribed} event type(s) subscribed · digest ${health.slack.digestEnabled ? "on" : "off"} · last digest ${relativeTime(health.slack.lastDigestSentAt)}`
        : "Not connected",
      href: "/settings/organization",
    },
    {
      name: "Outbound webhooks",
      configured: health.webhooks.endpointCount > 0,
      detail:
        health.webhooks.endpointCount > 0
          ? `${health.webhooks.enabledCount}/${health.webhooks.endpointCount} enabled · last delivery ${relativeTime(health.webhooks.lastDeliveryAt)}${
              health.webhooks.lastDeliverySuccess === false ? " (failed)" : ""
            }`
          : "No endpoints configured",
      href: "/settings/organization",
    },
    {
      name: "Jira",
      configured: health.jira.configured,
      detail: health.jira.configured
        ? `${health.jira.linkedRequirementCount} requirement(s) linked · webhook ${health.jira.webhookConfigured ? "configured" : "not configured"} · last sync ${relativeTime(health.jira.lastSyncedAt)}`
        : "Not connected",
      href: "/settings/organization",
    },
    {
      name: "Linear",
      configured: health.linear.configured,
      detail: health.linear.configured
        ? `${health.linear.linkedRequirementCount} requirement(s) linked · webhook ${health.linear.webhookConfigured ? "configured" : "not configured"} · last sync ${relativeTime(health.linear.lastSyncedAt)}`
        : "Not connected",
      href: "/settings/organization",
    },
    {
      name: "PagerDuty",
      configured: health.pagerduty.projectsConfigured > 0,
      detail:
        health.pagerduty.projectsConfigured > 0
          ? `${health.pagerduty.projectsConfigured} project(s) linked`
          : "No project configured with a PagerDuty service ID",
      href: "/projects",
    },
    {
      name: "Datadog",
      configured: health.datadog.projectsConfigured > 0,
      detail:
        health.datadog.projectsConfigured > 0
          ? `${health.datadog.projectsConfigured} project(s) tagged · webhook ${health.datadog.webhookConfigured ? "configured" : "not configured"}`
          : "No project tagged for Datadog",
      href: "/projects",
    },
  ];

  return (
    <div style={{ maxWidth: 720 }}>
      <h1>Integrations</h1>
      <p className="text-muted" style={{ marginBottom: 20 }}>
        Real status for every third-party connection this org has - or hasn&apos;t - set up. Each row links to where
        it&apos;s configured.
      </p>
      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        {rows.map((row, i) => (
          <a
            key={row.name}
            href={row.href}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 18px",
              borderTop: i === 0 ? "none" : "1px solid var(--line)",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center" }}>
              <StatusDot ok={row.configured} />
              <strong style={{ fontSize: 14 }}>{row.name}</strong>
            </div>
            <span className="text-muted" style={{ fontSize: 13, textAlign: "right" }}>
              {row.detail}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
