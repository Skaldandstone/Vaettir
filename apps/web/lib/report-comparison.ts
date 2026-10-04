import type { ApprovedReportComparison } from "@vaettir/api/src/services/reportComparison";
export function renderReportComparisonHtml(value: ApprovedReportComparison) {
  const escape = (text: string | number) =>
    String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  const number = (count: number | null) =>
    count === null ? "Unavailable" : escape(count);
  const change = (delta: number | null) =>
    delta === null ? "Unavailable" : `${delta > 0 ? "+" : ""}${delta}`;
  const capture = (label: string, row: ApprovedReportComparison["baseline"]) =>
    `<section><h2>${label}</h2><p>${escape(row.title)}</p><p>Captured ${escape(row.asOf)}</p><p>Execution (UTC): ${escape(row.windowStart)} through ${escape(row.windowEnd)} (inclusive recorded run-start bounds).</p></section>`;
  const notes = (title: string, values: string[]) =>
    `<section><h2>${title}</h2><ul>${values.map((note) => `<li>${escape(note)}</li>`).join("")}</ul></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reviewed snapshot comparison</title><style>body{font-family:system-ui,sans-serif;max-width:1100px;margin:24px auto;padding:16px;color:#17202a}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #bcc7cb;text-align:left;padding:8px;overflow-wrap:anywhere}small{display:block;font-weight:normal}section{margin-block:20px}@media print{body{margin:0}tr{break-inside:avoid}}</style></head><body><h1>Reviewed snapshot comparison</h1><p>${escape(value.scopeDescription)}. ${value.sameExecutionWindow ? "Same original execution window." : "Different original execution windows; counts are not directly equivalent."}</p>${capture("Earlier baseline", value.baseline)}${capture("Later capture", value.target)}<p>Active case identities: ${value.cohort.common} in both, ${value.cohort.added} added, ${value.cohort.removed} no longer active in the later cohort. No case identities are exported.</p><table><thead><tr><th scope="col">Recorded metric</th><th scope="col">Baseline</th><th scope="col">Later capture</th><th scope="col">Count change</th></tr></thead><tbody>${value.rows.map((row) => `<tr><th scope="row">${escape(row.section)} · ${escape(row.label)}<small>${escape(row.note)}</small></th><td>${number(row.baseline)}</td><td>${number(row.target)}</td><td>${change(row.delta)}</td></tr>`).join("")}</tbody></table>${notes("Comparison boundaries", value.limitations)}${notes("Earlier baseline boundaries", value.sourceLimitations.baseline)}${notes("Later capture boundaries", value.sourceLimitations.target)}</body></html>`;
}
