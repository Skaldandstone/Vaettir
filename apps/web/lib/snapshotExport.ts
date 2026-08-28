// Direct user request (2026-08-28): interactive dashboard snapshots that
// can be pasted/embedded into Confluence, Notion, or any wiki - not a
// static screenshot. Two real, self-contained export formats built from
// releases.getSnapshot's data (the same data the live dashboard reads,
// so a snapshot can never show a different number than the page it was
// exported from):
//   - HTML: a genuinely interactive standalone document (native <details>
//     collapsible sections, a real sortable risk-flags table, inline SVG
//     trend charts with hover tooltips) - no external CSS/JS
//     dependencies, so it renders identically whether opened as a file,
//     pasted into Confluence's HTML macro, or embedded via an iframe.
//   - Markdown: GFM tables + <details> blocks, for pasting straight into
//     a Notion/Confluence/generic wiki page as real structured content
//     (Notion in particular doesn't execute arbitrary embedded HTML/JS
//     the way Confluence's HTML macro does, so this is the honest
//     "works everywhere, but less interactive" alternative - not a
//     downgrade snuck in silently, a real different trade-off).

export interface SnapshotData {
  release: { id: string; name: string; status: string; targetDate: string | null; projectId: string };
  projectName: string;
  readiness: {
    score: number;
    label: "READY" | "AT_RISK" | "BLOCKED";
    criteria: { met: number; atRisk: number; notMet: number; pending: number; total: number };
    riskFlags: { critical: number; high: number; medium: number; low: number; openTotal: number };
  };
  testPlans: Array<{
    id: string;
    name: string;
    status: string;
    testPlanType: { id: string; name: string };
    acceptanceCriteria: Array<{ id: string; description: string; status: string; autoComputed: boolean }>;
  }>;
  riskFlags: Array<{
    id: string;
    severity: string;
    source: string;
    description: string;
    relatedFilePath: string | null;
    relatedPrUrl: string | null;
    createdAt: string;
    resolvedAt: string | null;
  }>;
  trend: Array<{
    releaseId: string;
    name: string;
    createdAt: string;
    runCount: number;
    passRate: number | null;
    flakyCount: number;
    coveragePct: number | null;
    meanTimeToGreenMs: number | null;
  }>;
  generatedAt: string;
}

const LABEL_COLOR: Record<string, string> = { READY: "#2f7d4f", AT_RISK: "#b8860b", BLOCKED: "#b13c3c" };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sparklinePath(
  values: (number | null)[],
  width: number,
  height: number,
  pad = 4,
): { path: string; points: { x: number; y: number; v: number; i: number }[] } {
  const real = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (real.length === 0) return { path: "", points: [] };
  const max = Math.max(...real.map((p) => p.v), 1);
  const min = Math.min(...real.map((p) => p.v), 0);
  const range = max - min || 1;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const points = real.map((p) => ({
    x: pad + p.i * step,
    y: height - pad - ((p.v - min) / range) * (height - pad * 2),
    v: p.v,
    i: p.i,
  }));
  const path = points.map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return { path, points };
}

function trendChartSvg(title: string, values: (number | null)[], labels: string[], formatValue: (v: number) => string): string {
  const width = 480;
  const height = 120;
  const { path, points } = sparklinePath(values, width, height);
  if (points.length === 0) {
    return `<div class="chart"><h4>${esc(title)}</h4><p class="muted">No data yet.</p></div>`;
  }
  const circles = points
    .map(
      (p) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" class="pt"><title>${esc(labels[p.i] ?? "")}: ${esc(formatValue(p.v))}</title></circle>`,
    )
    .join("");
  return `<div class="chart">
    <h4>${esc(title)}</h4>
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMidYMid meet">
      <path d="${path}" class="line" />
      ${circles}
    </svg>
  </div>`;
}

function statusBadgeClass(status: string): string {
  const s = status.toUpperCase();
  if (s === "MET" || s === "PASS" || s === "READY") return "badge badge-ok";
  if (s === "AT_RISK" || s === "PENDING" || s === "FLAKY") return "badge badge-warn";
  if (s === "NOT_MET" || s === "FAIL" || s === "BLOCKED") return "badge badge-bad";
  return "badge";
}

export function buildHtmlSnapshot(data: SnapshotData): string {
  const criteriaSections = data.testPlans
    .map((plan) => {
      const rows = plan.acceptanceCriteria
        .map(
          (c) =>
            `<li><span class="${statusBadgeClass(c.status)}">${esc(c.status)}</span> ${esc(c.description)}${c.autoComputed ? ' <span class="muted">(live)</span>' : ""}</li>`,
        )
        .join("");
      return `<details open>
        <summary>${esc(plan.name)} <span class="muted">(${esc(plan.testPlanType.name)}, ${esc(plan.status)})</span></summary>
        <ul class="criteria-list">${rows || '<li class="muted">No acceptance criteria.</li>'}</ul>
      </details>`;
    })
    .join("\n");

  const riskRows = data.riskFlags
    .map(
      (f) =>
        `<tr data-severity="${esc(f.severity)}" data-resolved="${f.resolvedAt ? "1" : "0"}">
          <td><span class="${statusBadgeClass(f.severity === "CRITICAL" || f.severity === "HIGH" ? "NOT_MET" : "AT_RISK")}">${esc(f.severity)}</span></td>
          <td>${esc(f.source)}</td>
          <td>${esc(f.description)}</td>
          <td>${f.relatedFilePath ? esc(f.relatedFilePath) : ""}</td>
          <td>${f.resolvedAt ? "Resolved" : "Open"}</td>
        </tr>`,
    )
    .join("\n");

  const trendLabels = data.trend.map((t) => t.name);
  const passRateChart = trendChartSvg(
    "Pass rate",
    data.trend.map((t) => (t.passRate === null ? null : t.passRate * 100)),
    trendLabels,
    (v) => `${v.toFixed(0)}%`,
  );
  const coverageChart = trendChartSvg(
    "Coverage %",
    data.trend.map((t) => t.coveragePct),
    trendLabels,
    (v) => `${v.toFixed(0)}%`,
  );
  const flakyChart = trendChartSvg(
    "Flaky results",
    data.trend.map((t) => t.flakyCount),
    trendLabels,
    (v) => `${v.toFixed(0)}`,
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(data.release.name)} — Quality Snapshot</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 860px; margin: 0 auto; padding: 32px 20px; color: #1c1c1c; background: #fff; line-height: 1.5; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 17px; margin-top: 32px; border-bottom: 1px solid #e2e2e2; padding-bottom: 6px; }
  h4 { font-size: 13px; margin: 0 0 4px; }
  .muted { color: #767676; font-size: 12px; font-weight: normal; }
  .meta { color: #555; font-size: 13px; margin-bottom: 16px; }
  .score-row { display: flex; align-items: center; gap: 16px; margin: 12px 0 20px; }
  .score { font-size: 40px; font-weight: 700; }
  .label { display: inline-block; padding: 4px 12px; border-radius: 3px; color: #fff; font-weight: 600; font-size: 13px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 600; background: #eee; color: #444; }
  .badge-ok { background: #e2f4e8; color: #2f7d4f; }
  .badge-warn { background: #fdf1d6; color: #8a6708; }
  .badge-bad { background: #fbe4e4; color: #a13030; }
  details { border: 1px solid #e2e2e2; border-radius: 4px; padding: 8px 12px; margin-bottom: 8px; }
  summary { cursor: pointer; font-weight: 600; font-size: 14px; }
  .criteria-list { list-style: none; padding: 0; margin: 8px 0 0; font-size: 13px; }
  .criteria-list li { padding: 4px 0; border-top: 1px solid #f0f0f0; }
  .criteria-list li:first-child { border-top: none; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
  th { cursor: pointer; user-select: none; color: #555; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; }
  th:hover { color: #000; }
  .toolbar { display: flex; gap: 12px; align-items: center; margin: 8px 0; font-size: 13px; }
  .charts { display: flex; flex-wrap: wrap; gap: 24px; margin-top: 12px; }
  .chart { flex: 1; min-width: 220px; }
  .chart svg { overflow: visible; }
  .line { fill: none; stroke: #3a7ca5; stroke-width: 2; }
  .pt { fill: #3a7ca5; cursor: pointer; }
  .pt:hover { fill: #1c1c1c; r: 5; }
  footer { margin-top: 40px; color: #999; font-size: 11px; border-top: 1px solid #eee; padding-top: 10px; }
</style>
</head>
<body>
  <h1>${esc(data.release.name)}</h1>
  <p class="meta">${esc(data.projectName)} · status ${esc(data.release.status)}${data.release.targetDate ? ` · target ${esc(new Date(data.release.targetDate).toLocaleDateString())}` : ""}</p>

  <div class="score-row">
    <div class="score">${data.readiness.score}</div>
    <span class="label" style="background:${LABEL_COLOR[data.readiness.label] ?? "#888"}">${esc(data.readiness.label)}</span>
    <span class="muted">${data.readiness.criteria.met}/${data.readiness.criteria.total} criteria met · ${data.readiness.riskFlags.openTotal} open risk flag(s)</span>
  </div>

  <h2>Acceptance criteria</h2>
  ${criteriaSections || '<p class="muted">No test plans on this release.</p>'}

  <h2>Risk flags</h2>
  <div class="toolbar">
    <label><input type="checkbox" id="showResolved" /> Show resolved</label>
    <span class="muted">Click a column header to sort.</span>
  </div>
  <table id="riskTable">
    <thead><tr><th data-key="0">Severity</th><th data-key="1">Source</th><th data-key="2">Description</th><th data-key="3">File</th><th data-key="4">Status</th></tr></thead>
    <tbody>${riskRows || '<tr><td colspan="5" class="muted">No risk flags.</td></tr>'}</tbody>
  </table>

  <h2>Trend (last ${data.trend.length} releases)</h2>
  <div class="charts">
    ${passRateChart}
    ${coverageChart}
    ${flakyChart}
  </div>

  <footer>Generated by Vaettir on ${esc(new Date(data.generatedAt).toLocaleString())} · a live snapshot, not a static image - reopen the file any time, the numbers won't update after export.</footer>

  <script>
    (function () {
      var table = document.getElementById("riskTable");
      var tbody = table.querySelector("tbody");
      var showResolved = document.getElementById("showResolved");
      function applyFilter() {
        Array.prototype.forEach.call(tbody.rows, function (row) {
          var resolved = row.getAttribute("data-resolved") === "1";
          row.style.display = resolved && !showResolved.checked ? "none" : "";
        });
      }
      showResolved.addEventListener("change", applyFilter);
      applyFilter();

      var sortDir = {};
      Array.prototype.forEach.call(table.querySelectorAll("th"), function (th) {
        th.addEventListener("click", function () {
          var key = parseInt(th.getAttribute("data-key"), 10);
          var dir = sortDir[key] = !sortDir[key];
          var rows = Array.prototype.slice.call(tbody.rows);
          rows.sort(function (a, b) {
            var av = a.cells[key].textContent.trim();
            var bv = b.cells[key].textContent.trim();
            return dir ? av.localeCompare(bv) : bv.localeCompare(av);
          });
          rows.forEach(function (r) { tbody.appendChild(r); });
        });
      });
    })();
  </script>
</body>
</html>`;
}

export function buildMarkdownSnapshot(data: SnapshotData): string {
  const lines: string[] = [];
  lines.push(`# ${data.release.name}`);
  lines.push("");
  lines.push(
    `${data.projectName} · status ${data.release.status}${data.release.targetDate ? ` · target ${new Date(data.release.targetDate).toLocaleDateString()}` : ""}`,
  );
  lines.push("");
  lines.push(`**Readiness: ${data.readiness.score}/100 — ${data.readiness.label}**`);
  lines.push("");
  lines.push(
    `${data.readiness.criteria.met}/${data.readiness.criteria.total} criteria met · ${data.readiness.riskFlags.openTotal} open risk flag(s) (${data.readiness.riskFlags.critical} critical, ${data.readiness.riskFlags.high} high)`,
  );
  lines.push("");
  lines.push("## Acceptance criteria");
  lines.push("");
  for (const plan of data.testPlans) {
    lines.push(`<details open><summary><strong>${plan.name}</strong> (${plan.testPlanType.name}, ${plan.status})</summary>`);
    lines.push("");
    if (plan.acceptanceCriteria.length === 0) {
      lines.push("_No acceptance criteria._");
    } else {
      lines.push("| Status | Criterion |");
      lines.push("|---|---|");
      for (const c of plan.acceptanceCriteria) {
        lines.push(`| ${c.status}${c.autoComputed ? " (live)" : ""} | ${c.description.replace(/\|/g, "\\|")} |`);
      }
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }
  lines.push("## Risk flags");
  lines.push("");
  if (data.riskFlags.length === 0) {
    lines.push("_No risk flags._");
  } else {
    lines.push("| Severity | Source | Description | File | Status |");
    lines.push("|---|---|---|---|---|");
    for (const f of data.riskFlags) {
      lines.push(
        `| ${f.severity} | ${f.source} | ${f.description.replace(/\|/g, "\\|")} | ${f.relatedFilePath ?? ""} | ${f.resolvedAt ? "Resolved" : "Open"} |`,
      );
    }
  }
  lines.push("");
  lines.push(`## Trend (last ${data.trend.length} releases)`);
  lines.push("");
  lines.push("| Release | Runs | Pass rate | Coverage | Flaky | Mean time-to-green |");
  lines.push("|---|---|---|---|---|---|");
  for (const t of data.trend) {
    const passRate = t.passRate === null ? "—" : `${(t.passRate * 100).toFixed(0)}%`;
    const coverage = t.coveragePct === null ? "—" : `${t.coveragePct.toFixed(0)}%`;
    const mttg = t.meanTimeToGreenMs === null ? "—" : `${(t.meanTimeToGreenMs / 3_600_000).toFixed(1)}h`;
    lines.push(`| ${t.name} | ${t.runCount} | ${passRate} | ${coverage} | ${t.flakyCount} | ${mttg} |`);
  }
  lines.push("");
  lines.push(
    `---\n_Generated by Vaettir on ${new Date(data.generatedAt).toLocaleString()} - a point-in-time snapshot, not a live view; reopen this export any time but the numbers won't update. \`<details>\` blocks render as collapsible sections on GitHub and most wikis; Notion converts them to a static block on import - use the HTML export there for real interactivity._`,
  );
  return lines.join("\n");
}
