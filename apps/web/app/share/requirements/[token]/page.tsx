import type { Metadata } from "next";

// Direct request: make the Jira/Linear side of this integration genuinely
// informative, not a bare "N test cases linked" link the way Zephyr's and
// TestRail's own ticket panels typically are. A real Jira Forge app or
// Linear app-panel both need their own developer-account registration to
// ever run live (same category of gap as EAS/Apple/Google elsewhere) - this
// is the version that's genuinely deployable today with zero external app
// registration: paste this page's URL into a Jira or Linear issue and both
// render a rich Open Graph link preview automatically (Jira Smart Links,
// Linear's own link unfurling), and clicking through lands on the same
// real, designed status page a human would want to see anyway.
//
// Public by design (see requirements.getSharedSummary's own comment) - the
// unguessable token in the URL is the entire access control, generated
// only when a human explicitly opts in from the requirements page.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface SharedSummary {
  requirementId: string;
  requirementTitle: string;
  requirementDescription: string | null;
  acceptanceCriteria: { total: number; met: number; pending: number; notMet: number; atRisk: number };
  testCases: { total: number; passing: number; failing: number; neverRun: number; other: number; pendingReview: number };
  failingTestCases: { id: string; title: string; lastRunAt: string | null }[];
  openRiskFlags: { id: string; severity: string; description: string }[];
}

async function fetchSharedSummary(token: string): Promise<SharedSummary | null> {
  try {
    const url = `${API_URL}/trpc/requirements.getSharedSummary?input=${encodeURIComponent(JSON.stringify({ shareToken: token }))}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: { data?: SharedSummary | null } };
    return body.result?.data ?? null;
  } catch {
    return null;
  }
}

function overallLabel(summary: SharedSummary): { text: string; tone: "good" | "warning" | "bad" | "neutral" } {
  if (summary.testCases.total === 0) return { text: "No tests linked yet", tone: "neutral" };
  if (summary.testCases.failing > 0) return { text: "Tests failing", tone: "bad" };
  if (summary.openRiskFlags.some((f) => f.severity === "CRITICAL")) return { text: "Critical risk open", tone: "bad" };
  if (summary.testCases.neverRun > 0 || summary.openRiskFlags.length > 0) return { text: "Needs attention", tone: "warning" };
  return { text: "All tests passing", tone: "good" };
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const summary = await fetchSharedSummary(token);
  if (!summary) {
    return { title: "Test status link expired — Vaettir" };
  }
  const { acceptanceCriteria: ac, testCases: tc } = summary;
  const status = overallLabel(summary);
  const description =
    tc.total > 0
      ? `${status.text} — ${tc.passing}/${tc.total} tests passing, ${ac.met}/${ac.total} acceptance criteria met${
          summary.openRiskFlags.length > 0 ? `, ${summary.openRiskFlags.length} open risk flag(s)` : ""
        }.`
      : `${ac.met}/${ac.total} acceptance criteria met. No test cases linked yet.`;
  return {
    title: `${summary.requirementTitle} — test status`,
    description,
    openGraph: { title: `${summary.requirementTitle} — test status`, description, siteName: "Vaettir", type: "website" },
    twitter: { card: "summary", title: `${summary.requirementTitle} — test status`, description },
  };
}

const TONE_COLORS: Record<string, { fg: string; bg: string }> = {
  good: { fg: "var(--frost)", bg: "var(--frost-dim)" },
  warning: { fg: "var(--warning)", bg: "var(--warning-bg)" },
  bad: { fg: "var(--ember)", bg: "var(--ember-dim)" },
  neutral: { fg: "var(--muted)", bg: "var(--panel-2)" },
};

function StatBar({ passing, failing, other, neverRun }: { passing: number; failing: number; other: number; neverRun: number }) {
  const total = passing + failing + other + neverRun;
  if (total === 0) return null;
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)" }}>
      {passing > 0 && <div style={{ width: seg(passing), background: "var(--frost)" }} title={`${passing} passing`} />}
      {failing > 0 && <div style={{ width: seg(failing), background: "var(--ember)" }} title={`${failing} failing`} />}
      {other > 0 && <div style={{ width: seg(other), background: "var(--warning)" }} title={`${other} flaky/skipped`} />}
      {neverRun > 0 && <div style={{ width: seg(neverRun), background: "var(--line)" }} title={`${neverRun} never run`} />}
    </div>
  );
}

function Legend({ label, count, color }: { label: string; count: number; color: string }) {
  if (count === 0) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)" }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color, display: "inline-block" }} />
      {count} {label}
    </span>
  );
}

export default async function SharedRequirementPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const summary = await fetchSharedSummary(token);

  if (!summary) {
    return (
      <div style={{ maxWidth: 560, margin: "80px auto", padding: "0 20px", textAlign: "center" }}>
        <h1 style={{ fontSize: 20 }}>This link is no longer active</h1>
        <p className="text-muted">The share link may have been revoked or regenerated. Ask whoever shared it for a fresh one.</p>
      </div>
    );
  }

  const status = overallLabel(summary);
  const tone = TONE_COLORS[status.tone]!;
  const { acceptanceCriteria: ac, testCases: tc } = summary;

  return (
    <div style={{ maxWidth: 640, margin: "48px auto", padding: "0 20px 60px" }}>
      <div className="panel" style={{ padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, margin: 0, lineHeight: 1.3 }}>{summary.requirementTitle}</h1>
          <span
            style={{
              flexShrink: 0,
              fontSize: 12,
              fontWeight: 600,
              padding: "4px 10px",
              borderRadius: 999,
              color: tone.fg,
              background: tone.bg,
              whiteSpace: "nowrap",
            }}
          >
            {status.text}
          </span>
        </div>
        {summary.requirementDescription && (
          <p className="text-muted" style={{ fontSize: 14, marginTop: 8 }}>
            {summary.requirementDescription}
          </p>
        )}

        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>Test cases</strong>
            <span className="text-muted" style={{ fontSize: 13 }}>
              {tc.total} total
            </span>
          </div>
          {tc.total > 0 ? (
            <>
              <StatBar passing={tc.passing} failing={tc.failing} other={tc.other} neverRun={tc.neverRun} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
                <Legend label="passing" count={tc.passing} color="var(--frost)" />
                <Legend label="failing" count={tc.failing} color="var(--ember)" />
                <Legend label="flaky/skipped" count={tc.other} color="var(--warning)" />
                <Legend label="never run" count={tc.neverRun} color="var(--line)" />
                <Legend label="pending review" count={tc.pendingReview} color="var(--info)" />
              </div>
            </>
          ) : (
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              No test cases linked to this requirement yet.
            </p>
          )}
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>Acceptance criteria</strong>
            <span className="text-muted" style={{ fontSize: 13 }}>
              {ac.met}/{ac.total} met
            </span>
          </div>
          {ac.total > 0 ? (
            <StatBar passing={ac.met} failing={ac.notMet} other={ac.atRisk} neverRun={ac.pending} />
          ) : (
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              No acceptance criteria defined yet.
            </p>
          )}
        </div>

        {summary.failingTestCases.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <strong style={{ fontSize: 13 }}>Currently failing</strong>
            <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
              {summary.failingTestCases.map((t) => (
                <li
                  key={t.id}
                  style={{
                    fontSize: 13,
                    padding: "6px 10px",
                    marginBottom: 4,
                    borderRadius: 6,
                    background: "var(--ember-dim)",
                    color: "var(--ember)",
                  }}
                >
                  {t.title}
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.openRiskFlags.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <strong style={{ fontSize: 13 }}>Open risk flags on this project</strong>
            <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
              {summary.openRiskFlags.map((f) => (
                <li
                  key={f.id}
                  style={{
                    fontSize: 13,
                    padding: "6px 10px",
                    marginBottom: 4,
                    borderRadius: 6,
                    background: f.severity === "CRITICAL" || f.severity === "HIGH" ? "var(--ember-dim)" : "var(--warning-bg)",
                    color: f.severity === "CRITICAL" || f.severity === "HIGH" ? "var(--ember)" : "var(--warning)",
                  }}
                >
                  <strong style={{ fontWeight: 600 }}>{f.severity}</strong> · {f.description}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <p className="text-muted" style={{ fontSize: 12, textAlign: "center", marginTop: 16 }}>
        Live test status from Vaettir. This page updates automatically as tests run.
      </p>
    </div>
  );
}
