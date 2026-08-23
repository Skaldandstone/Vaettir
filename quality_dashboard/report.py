"""Renders one self-contained HTML dashboard from real metrics + risk data.

No external JS/CSS -- everything needed to view the report is inlined, so the
output file can be opened directly, emailed, or published as a static artifact.
"""

from __future__ import annotations

from datetime import datetime, timezone
from html import escape

from quality_dashboard.git_risk import RiskEntry
from quality_dashboard.metrics import JobMetrics, days_since_last_green


def _status_class(pass_rate: float) -> str:
    if pass_rate >= 0.9:
        return "good"
    if pass_rate >= 0.7:
        return "warn"
    return "bad"


def _risk_class(score: float) -> str:
    if score >= 0.66:
        return "bad"
    if score >= 0.33:
        return "warn"
    return "good"


def _run_dots(job: JobMetrics) -> str:
    dots = []
    for run in reversed(job.runs):  # oldest -> newest, left to right
        cls = "pass" if run.passed else "fail"
        title = f"{run.head_sha[:7]} — {run.conclusion or run.status}"
        dots.append(f'<span class="dot {cls}" title="{escape(title)}"></span>')
    return "".join(dots)


def _pass_rate_chart(job_metrics: list[JobMetrics]) -> str:
    if not job_metrics:
        return ""
    row_h = 34
    gap = 10
    label_w = 90
    bar_area_w = 560
    height = len(job_metrics) * (row_h + gap) - gap + 20
    width = label_w + bar_area_w + 60
    bars = []
    for i, job in enumerate(job_metrics):
        y = i * (row_h + gap) + 10
        bar_w = max(job.pass_rate * bar_area_w, 2)
        cls = _status_class(job.pass_rate)
        bars.append(f"""
      <text x="{label_w - 10}" y="{y + row_h * 0.65:.0f}" text-anchor="end" class="chart-label">{escape(job.job_name)}</text>
      <rect x="{label_w}" y="{y}" width="{bar_area_w}" height="{row_h}" class="bar-track" rx="6"></rect>
      <rect x="{label_w}" y="{y}" width="{bar_w:.1f}" height="{row_h}" class="bar-fill {cls}" rx="6"></rect>
      <text x="{label_w + bar_area_w + 12}" y="{y + row_h * 0.65:.0f}" class="chart-value {cls}">{job.pass_rate * 100:.0f}%</text>""")
    return f"""
    <figure class="chart-figure">
      <svg viewBox="0 0 {width} {height}" role="img" aria-label="Pass rate per CI job over the last rolling window">
        {''.join(bars)}
      </svg>
      <figcaption>Rolling pass rate per job, last {job_metrics[0].total_runs if job_metrics else 0} runs</figcaption>
    </figure>"""


def _risk_chart(risk_entries: list[RiskEntry]) -> str:
    if not risk_entries:
        return ""
    row_h = 26
    gap = 8
    label_w = 260
    bar_area_w = 380
    height = len(risk_entries) * (row_h + gap) - gap + 20
    width = label_w + bar_area_w + 70
    max_score = max(e.risk_score for e in risk_entries) or 1.0
    bars = []
    for i, entry in enumerate(risk_entries):
        y = i * (row_h + gap) + 10
        bar_w = max((entry.risk_score / max_score) * bar_area_w, 2)
        cls = _risk_class(entry.risk_score)
        short_path = entry.path if len(entry.path) <= 34 else "…" + entry.path[-33:]
        bars.append(f"""
      <text x="{label_w - 10}" y="{y + row_h * 0.68:.0f}" text-anchor="end" class="chart-label mono">{escape(short_path)}</text>
      <rect x="{label_w}" y="{y}" width="{bar_area_w}" height="{row_h}" class="bar-track" rx="5"></rect>
      <rect x="{label_w}" y="{y}" width="{bar_w:.1f}" height="{row_h}" class="bar-fill {cls}" rx="5"></rect>
      <text x="{label_w + bar_area_w + 12}" y="{y + row_h * 0.68:.0f}" class="chart-value {cls}">{entry.risk_score:.2f}</text>""")
    return f"""
    <figure class="chart-figure">
      <svg viewBox="0 0 {width} {height}" role="img" aria-label="Risk score per file, highest first">
        {''.join(bars)}
      </svg>
      <figcaption>Risk score = change frequency × (1 − test confidence) — top {len(risk_entries)} files</figcaption>
    </figure>"""


def _job_card(job: JobMetrics) -> str:
    status_cls = _status_class(job.pass_rate)
    last_run = job.last_run_at.strftime("%Y-%m-%d %H:%M UTC") if job.last_run_at else "—"
    return f"""
    <article class="card job-card {status_cls}">
      <header class="job-card-head">
        <h3>{escape(job.job_name)}</h3>
        <span class="pill {status_cls}">{job.pass_rate * 100:.0f}%</span>
      </header>
      <p class="metric-line">
        <span class="metric-value">{job.pass_rate * 100:.0f}%</span>
        <span class="metric-label">pass rate · last {job.total_runs} runs</span>
      </p>
      <div class="run-dots" aria-label="Run history, oldest to newest">{_run_dots(job)}</div>
      <dl class="job-facts">
        <div><dt>Flakiness</dt><dd>{job.flakiness_score * 100:.0f}%</dd></div>
        <div><dt>Last run</dt><dd>{escape(last_run)}</dd></div>
        <div><dt>Last result</dt><dd class="{status_cls}">{escape(job.last_conclusion or "unknown")}</dd></div>
      </dl>
    </article>"""


def _risk_row(entry: RiskEntry, rank: int) -> str:
    cls = _risk_class(entry.risk_score)
    test_label = entry.matched_test or "none found"
    confidence_pct = f"{entry.test_confidence * 100:.0f}%"
    return f"""
      <tr>
        <td class="rank">{rank}</td>
        <td class="path"><code>{escape(entry.path)}</code></td>
        <td class="num">{entry.change_count}</td>
        <td class="num"><span class="pill {cls}">{confidence_pct}</span></td>
        <td class="test-cell">{escape(test_label)}</td>
        <td class="num risk-cell"><span class="pill {cls}">{entry.risk_score:.2f}</span></td>
      </tr>"""


def render_dashboard(
    repo: str,
    job_metrics: list[JobMetrics],
    risk_entries: list[RiskEntry],
    generated_at: datetime | None = None,
) -> str:
    generated_at = generated_at or datetime.now(timezone.utc)
    gap = days_since_last_green(job_metrics)
    if gap is None:
        headline_value, headline_cls = "no green run found", "bad"
    elif gap < 1:
        headline_value, headline_cls = "green right now", "good"
    else:
        headline_value = f"{gap:.1f} days"
        headline_cls = "good" if gap < 2 else ("warn" if gap < 7 else "bad")

    overall_pass_rate = (
        sum(j.pass_rate for j in job_metrics) / len(job_metrics) if job_metrics else 0.0
    )

    job_cards = "\n".join(_job_card(j) for j in job_metrics) or "<p class='empty'>No CI job history found.</p>"
    risk_rows = "\n".join(_risk_row(e, i + 1) for i, e in enumerate(risk_entries)) or (
        "<tr><td colspan='6' class='empty'>No churn detected in the lookback window.</td></tr>"
    )

    return f"""<title>Quality Intelligence — {escape(repo)}</title>
<style>
  :root {{
    --bg: #f6f5f1;
    --surface: #ffffff;
    --surface-2: #edece6;
    --border: #dcdad2;
    --text: #1f1d18;
    --text-dim: #6b6a62;
    --accent: #3d5a80;
    --accent-soft: #e3ebf3;
    --good: #2e7d55;
    --good-bg: #e3f3ea;
    --warn: #9a6b16;
    --warn-bg: #faf0d9;
    --bad: #b23a3a;
    --bad-bg: #fbe6e6;
    --mono: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
    --display: "Fraunces", Georgia, serif;
    --body-font: "Inter", -apple-system, "Segoe UI", sans-serif;
  }}
  @media (prefers-color-scheme: dark) {{
    :root:not([data-theme="light"]) {{
      --bg: #14161a;
      --surface: #1c1f24;
      --surface-2: #23262c;
      --border: #33373f;
      --text: #eceae4;
      --text-dim: #9a9a94;
      --accent: #8fb4d9;
      --accent-soft: #23303c;
      --good: #6fcf97;
      --good-bg: #1c2e24;
      --warn: #e3b341;
      --warn-bg: #332a15;
      --bad: #e07070;
      --bad-bg: #362020;
    }}
  }}
  :root[data-theme="dark"] {{
    --bg: #14161a;
    --surface: #1c1f24;
    --surface-2: #23262c;
    --border: #33373f;
    --text: #eceae4;
    --text-dim: #9a9a94;
    --accent: #8fb4d9;
    --accent-soft: #23303c;
    --good: #6fcf97;
    --good-bg: #1c2e24;
    --warn: #e3b341;
    --warn-bg: #332a15;
    --bad: #e07070;
    --bad-bg: #362020;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    background: var(--bg);
    color: var(--text);
    font-family: var(--body-font);
    margin: 0;
    padding: 2.5rem 1.5rem 4rem;
    line-height: 1.5;
  }}
  .wrap {{ max-width: 1080px; margin: 0 auto; }}
  header.top {{
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 2rem;
  }}
  header.top h1 {{
    font-family: var(--display);
    font-size: 2rem;
    margin: 0;
    text-wrap: balance;
  }}
  header.top .repo {{
    color: var(--accent);
    font-family: var(--mono);
  }}
  .generated {{ color: var(--text-dim); font-size: 0.85rem; }}
  .headline {{
    display: flex;
    align-items: center;
    gap: 1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 2rem;
  }}
  .headline .label {{
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
  }}
  .headline .value {{
    font-family: var(--display);
    font-size: 1.9rem;
    font-variant-numeric: tabular-nums;
  }}
  .headline .value.good {{ color: var(--good); }}
  .headline .value.warn {{ color: var(--warn); }}
  .headline .value.bad {{ color: var(--bad); }}
  .headline .overall {{
    margin-left: auto;
    text-align: right;
  }}
  section {{ margin-bottom: 2.5rem; }}
  section > h2 {{
    font-family: var(--display);
    font-size: 1.3rem;
    margin: 0 0 1rem;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.5rem;
  }}
  .job-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: 1rem;
  }}
  .card {{
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.1rem 1.2rem;
  }}
  .job-card-head {{
    display: flex;
    justify-content: space-between;
    align-items: center;
  }}
  .job-card-head h3 {{
    margin: 0;
    font-family: var(--mono);
    font-size: 1rem;
    text-transform: none;
  }}
  .pill {{
    display: inline-block;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }}
  .pill.good {{ background: var(--good-bg); color: var(--good); }}
  .pill.warn {{ background: var(--warn-bg); color: var(--warn); }}
  .pill.bad {{ background: var(--bad-bg); color: var(--bad); }}
  .metric-line {{ margin: 0.75rem 0 0.5rem; }}
  .metric-value {{
    font-family: var(--display);
    font-size: 1.8rem;
    font-variant-numeric: tabular-nums;
  }}
  .metric-label {{
    display: block;
    color: var(--text-dim);
    font-size: 0.78rem;
  }}
  .run-dots {{ margin: 0.6rem 0; line-height: 1; }}
  .dot {{
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 3px;
  }}
  .dot.pass {{ background: var(--good); }}
  .dot.fail {{ background: var(--bad); }}
  .job-facts {{
    margin: 0.75rem 0 0;
    display: grid;
    gap: 0.3rem;
    font-size: 0.85rem;
  }}
  .job-facts > div {{ display: flex; justify-content: space-between; gap: 1rem; }}
  .job-facts dt {{ color: var(--text-dim); }}
  .job-facts dd {{ margin: 0; font-variant-numeric: tabular-nums; }}
  .job-facts dd.good {{ color: var(--good); }}
  .job-facts dd.warn {{ color: var(--warn); }}
  .job-facts dd.bad {{ color: var(--bad); }}
  table.risk {{
    width: 100%;
    border-collapse: collapse;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
  }}
  .table-scroll {{ overflow-x: auto; }}
  table.risk th, table.risk td {{
    padding: 0.6rem 0.8rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
    font-size: 0.88rem;
  }}
  table.risk th {{
    background: var(--surface-2);
    color: var(--text-dim);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }}
  table.risk td.num {{ font-variant-numeric: tabular-nums; text-align: right; }}
  table.risk td.rank {{ color: var(--text-dim); text-align: right; }}
  table.risk code {{ font-family: var(--mono); font-size: 0.85rem; }}
  table.risk tr:last-child td {{ border-bottom: none; }}
  .test-cell {{ color: var(--text-dim); font-family: var(--mono); font-size: 0.8rem; }}
  .empty {{ color: var(--text-dim); padding: 1rem; text-align: center; }}
  .chart-figure {{
    margin: 0 0 1.5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1rem 1.2rem 0.7rem;
  }}
  .chart-figure svg {{ width: 100%; height: auto; display: block; }}
  .chart-figure figcaption {{
    color: var(--text-dim);
    font-size: 0.78rem;
    margin-top: 0.5rem;
  }}
  .chart-label {{ fill: var(--text-dim); font-size: 12px; font-family: var(--body-font); }}
  .chart-label.mono {{ font-family: var(--mono); font-size: 11px; }}
  .chart-value {{ font-size: 12px; font-variant-numeric: tabular-nums; font-family: var(--mono); }}
  .bar-track {{ fill: var(--surface-2); }}
  .bar-fill.good {{ fill: var(--good); }}
  .bar-fill.warn {{ fill: var(--warn); }}
  .bar-fill.bad {{ fill: var(--bad); }}
  .chart-value.good {{ fill: var(--good); }}
  .chart-value.warn {{ fill: var(--warn); }}
  .chart-value.bad {{ fill: var(--bad); }}
  footer {{
    color: var(--text-dim);
    font-size: 0.8rem;
    border-top: 1px solid var(--border);
    padding-top: 1rem;
  }}
  footer a {{ color: var(--accent); }}
</style>
<div class="wrap">
  <header class="top">
    <div>
      <h1>Quality Intelligence</h1>
      <div class="repo">{escape(repo)}</div>
    </div>
    <div class="generated">Generated {generated_at.strftime("%Y-%m-%d %H:%M UTC")}</div>
  </header>

  <div class="headline">
    <div>
      <div class="label">Days since last fully-green run</div>
      <div class="value {headline_cls}">{headline_value}</div>
    </div>
    <div class="overall">
      <div class="label">Overall pass rate</div>
      <div class="value {_status_class(overall_pass_rate)}">{overall_pass_rate * 100:.0f}%</div>
    </div>
  </div>

  <section>
    <h2>CI job health</h2>
    {_pass_rate_chart(job_metrics)}
    <div class="job-grid">
      {job_cards}
    </div>
  </section>

  <section>
    <h2>Risk footprint — top {len(risk_entries)} highest-risk files</h2>
    {_risk_chart(risk_entries)}
    <div class="table-scroll">
      <table class="risk">
        <thead>
          <tr>
            <th>#</th>
            <th>Path</th>
            <th>Changes (90d)</th>
            <th>Test confidence</th>
            <th>Matched test</th>
            <th>Risk score</th>
          </tr>
        </thead>
        <tbody>
          {risk_rows}
        </tbody>
      </table>
    </div>
  </section>

  <footer>
    Pass rate is a rolling window over the last 20 completed runs per job.
    Risk score = change_frequency × (1 − test_coverage_confidence), where
    confidence is a presence heuristic (no test file found → 0%, a plausibly
    matching file found → 40–100%) pending real coverage.json/JUnit export.
    See QUALITY_INTELLIGENCE.md for the full methodology.
  </footer>
</div>
"""
