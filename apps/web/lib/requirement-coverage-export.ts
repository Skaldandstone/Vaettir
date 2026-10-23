import type { RequirementCoverageExport } from "@vaettir/api/src/services/requirementCoverageExportSchema";
import { hasTextControl } from "./control-characters.ts";

export const coverageExportBoundaries = [
  "Complete selected current requirements and explicit direct case relationships, not a frozen approved snapshot, full procedure backup or external access grant.",
  "Requirement numbers identify rows within this report only, not permanent native requirement keys. Titles and public case keys may contain internal information; excerpts are explicitly marked.",
  "A case linked to several requirements repeats its outcomes in several matrix rows. Only the distinct-case summary counts each case's results once. Neither count proves requirement fulfilment.",
  "Current archived cases remain visible. No direct links, no recorded results, only blocked/skipped results and planned manual selections without results remain distinct; none is PASS.",
  "Execution scope uses run-start dates and exact recorded configuration, not result recording time, historical procedure coverage, qualified approval or release readiness.",
  "Raw project/organization/actor/requirement/case/result/run identifiers, source, notes, literal search and defect content are omitted. Plan/run filter presence is disclosed without identifiers; this file cannot reconstruct those selections or the omitted search.",
] as const;
const keys = ["PASS", "FAIL", "FLAKY", "SKIP", "BLOCKED"] as const;
type Outcomes = RequirementCoverageExport["population"]["distinctCaseOutcomes"];
type Cell = string | number;
function refuse(): never {
  throw Error(
    "The complete requirement matrix or scope is inconsistent or unsupported. No partial or zero-substitute export was prepared.",
  );
}
function count(value: number, maximum: number) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
function text(value: string, max = 4000) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    hasTextControl(value) ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
      value,
    )
  )
    return refuse();
  return value;
}
function instant(value: string) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    return refuse();
  return value;
}
function outcomes(value: Outcomes) {
  if (
    !value ||
    Object.keys(value).length !== 7 ||
    !count(value.total, 100000) ||
    keys.some((key) => !count(value[key], 100000)) ||
    keys.reduce((sum, key) => sum + value[key], 0) !== value.total
  )
    return refuse();
  const state = !value.total
    ? "NO_RECORDED_RESULT"
    : !value.PASS && !value.FAIL && !value.FLAKY
      ? "ONLY_SKIPPED_OR_BLOCKED"
      : "RECORDED_OUTCOMES";
  if (state !== value.state) return refuse();
}
/** Pure complete-population validation. Auth/request/revision checks belong to the current UI/server. */
export function requirementCoverageExportPlan(
  value: RequirementCoverageExport,
) {
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.rows) ||
    value.rows.length > 1000 ||
    !value.population ||
    !value.selection ||
    value.selection.mode !== "SEARCH_OR_ALL" ||
    typeof value.searchPresence !== "boolean" ||
    !Array.isArray(value.limits) ||
    value.limits.length > 20
  )
    return refuse();
  instant(value.observedAt);
  instant(value.window?.start);
  instant(value.window?.end);
  if (
    value.window.start > value.window.end ||
    value.window.end > value.observedAt ||
    Date.parse(value.window.end) - Date.parse(value.window.start) >=
      366 * 86400000
  )
    return refuse();
  const p = value.population;
  for (const key of [
    "requirements",
    "unlinkedRequirements",
    "directPairs",
    "distinctCases",
    "archivedCases",
  ] as const)
    if (!count(p[key], 1000)) return refuse();
  if (
    !count(p.distinctCaseResultRecords, 100000) ||
    value.selection.requirementCount !== p.requirements ||
    p.unlinkedRequirements > p.requirements ||
    p.archivedCases > p.distinctCases ||
    value.rows.length !== p.directPairs + p.unlinkedRequirements
  )
    return refuse();
  outcomes(p.distinctCaseOutcomes);
  if (p.distinctCaseResultRecords !== p.distinctCaseOutcomes.total)
    return refuse();
  const requirements = new Map<
    number,
    { title: string; excerpt: boolean; unlinked: boolean }
  >();
  const cases = new Map<string, string>(),
    uniqueCaseRows = new Map<
      string,
      NonNullable<RequirementCoverageExport["rows"][number]["case"]>
    >();
  const pairs = new Set<string>(),
    sums = { PASS: 0, FAIL: 0, FLAKY: 0, SKIP: 0, BLOCKED: 0 };
  let unlinked = 0,
    linked = 0;
  for (const row of value.rows) {
    if (
      !row ||
      !Number.isSafeInteger(row.requirementOrdinal) ||
      row.requirementOrdinal < 1 ||
      row.requirementOrdinal > p.requirements ||
      typeof row.titleIsExcerpt !== "boolean" ||
      !text(row.requirementTitle, 180) ||
      !count(row.plannedWithoutResult, 10000)
    )
      return refuse();
    outcomes(row.outcomes);
    const previous = requirements.get(row.requirementOrdinal);
    if (
      previous &&
      (previous.title !== row.requirementTitle ||
        previous.excerpt !== row.titleIsExcerpt ||
        previous.unlinked ||
        !row.case)
    )
      return refuse();
    requirements.set(row.requirementOrdinal, {
      title: row.requirementTitle,
      excerpt: row.titleIsExcerpt,
      unlinked: !row.case,
    });
    if (!row.case) {
      if (row.outcomes.total || row.plannedWithoutResult) return refuse();
      unlinked++;
      continue;
    }
    const c = row.case;
    if (
      !text(c.displayId, 200) ||
      !text(c.title, 180) ||
      typeof c.archived !== "boolean" ||
      typeof c.titleIsExcerpt !== "boolean"
    )
      return refuse();
    const pair = JSON.stringify([row.requirementOrdinal, c.displayId]);
    if (pairs.has(pair)) return refuse();
    pairs.add(pair);
    linked++;
    const signature = JSON.stringify([
      c,
      row.outcomes,
      row.plannedWithoutResult,
    ]);
    if (cases.has(c.displayId) && cases.get(c.displayId) !== signature)
      return refuse();
    if (!cases.has(c.displayId)) {
      cases.set(c.displayId, signature);
      uniqueCaseRows.set(c.displayId, c);
      for (const key of keys) sums[key] += row.outcomes[key];
    }
  }
  if (
    requirements.size !== p.requirements ||
    cases.size !== p.distinctCases ||
    unlinked !== p.unlinkedRequirements ||
    linked !== p.directPairs ||
    [...uniqueCaseRows.values()].filter((row) => row.archived).length !==
      p.archivedCases ||
    keys.some((key) => sums[key] !== p.distinctCaseOutcomes[key])
  )
    return refuse();
  const headers = [
    "Row kind",
    "Recorded field",
    "Recorded value",
    "Requirement number",
    "Requirement title",
    "Requirement title excerpt",
    "Case key",
    "Case title",
    "Case title excerpt",
    "Case archived",
    "Evidence state",
    ...keys,
    "Result records",
    "Manual selections without result",
  ];
  const rows: Cell[][] = [];
  const add = (kind: string, field: string, entry: Cell) =>
    rows.push([
      kind,
      field,
      typeof entry === "string" ? text(entry) : entry,
      ...Array<Cell>(headers.length - 3).fill(""),
    ]);
  add("Scope", "Format", "Vaettir current requirement matrix CSV v1");
  add("Scope", "Observed UTC", value.observedAt);
  add("Scope", "Run-start window UTC start", value.window.start);
  add("Scope", "Run-start window UTC end", value.window.end);
  const s = value.appliedScope;
  if (
    s &&
    (!Object.keys(s).length ||
      Object.keys(s).some(
        (key) =>
          !["planId", "runId", "platform", "environment", "build"].includes(
            key,
          ),
      ))
  )
    return refuse();
  for (const key of ["platform", "environment", "build"] as const) {
    if (
      s?.[key] !== undefined &&
      !text(s[key], key === "environment" ? 2000 : 300)
    )
      return refuse();
    add("Scope", `Exact recorded ${key}`, s?.[key] ?? "Not filtered");
  }
  for (const key of ["planId", "runId"] as const) {
    if (s?.[key] !== undefined && !text(s[key], 200)) return refuse();
    add(
      "Scope",
      `${key === "planId" ? "Plan" : "Run"} filter`,
      s?.[key] ? "Applied; native identifier omitted" : "Not filtered",
    );
  }
  add(
    "Scope",
    "Requirement title search",
    value.searchPresence ? "Applied; literal text omitted" : "Not applied",
  );
  for (const key of [
    "requirements",
    "unlinkedRequirements",
    "directPairs",
    "distinctCases",
    "archivedCases",
    "distinctCaseResultRecords",
  ] as const)
    add("Distinct population", key, p[key]);
  for (const key of keys)
    add("Distinct-case outcomes", key, p.distinctCaseOutcomes[key]);
  for (const boundary of [...coverageExportBoundaries, ...value.limits])
    add("Evidence boundary", "Limitation", boundary);
  for (const row of value.rows)
    rows.push([
      row.case ? "Direct case relationship" : "Unlinked requirement",
      "",
      "",
      row.requirementOrdinal,
      row.requirementTitle,
      row.titleIsExcerpt ? "Yes" : "No",
      row.case?.displayId ?? "",
      row.case?.title ?? "",
      row.case ? (row.case.titleIsExcerpt ? "Yes" : "No") : "",
      row.case ? (row.case.archived ? "Yes" : "No") : "",
      row.outcomes.state,
      ...keys.map((key) => row.outcomes[key]),
      row.outcomes.total,
      row.plannedWithoutResult,
    ]);
  if (rows.length > 1100) return refuse();
  return { headers, rows };
}
const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escape(value: Cell) {
  return text(String(value)).replace(/[&<>"']/g, (c) => entities[c]!);
}
/** Offline, text-only complete current matrix. No scripts/assets/links/recipient permission. */
export function renderRequirementCoverageHtml(
  value: RequirementCoverageExport,
) {
  const plan = requirementCoverageExportPlan(value),
    p = value.population;
  const scopeRows = plan.rows
    .filter((row) => row[0] === "Scope")
    .map(
      (row) =>
        `<tr><th scope="row">${escape(row[1]!)}</th><td>${escape(row[1] === "Format" ? "Vaettir current requirement matrix HTML v1" : row[2]!)}</td></tr>`,
    )
    .join("");
  const dataRows = plan.rows.filter(
    (row) =>
      row[0] === "Direct case relationship" ||
      row[0] === "Unlinked requirement",
  );
  const result = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Requirement coverage matrix | Vaettir</title><style>body{font:16px/1.5 system-ui;color:#182225;background:white;margin:32px auto;max-width:1280px;padding:0 20px}h1{line-height:1.2}p,li,th,td{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid #c7d0ce;padding:8px;text-align:left;vertical-align:top}.scroll{overflow:auto}.boundary{border-left:4px solid #70957e;background:#edf3ee;padding:16px}thead{display:table-header-group}tr{break-inside:avoid}@media print{body{max-width:none;margin:0;padding:0}.scroll{overflow:visible}table{font-size:10px}th,td{padding:4px}}</style></head><body><header><small>VAETTIR · Complete selected current matrix · Format v1</small><h1>Requirement coverage and recorded outcomes</h1><p>${p.requirements} requirements; ${p.unlinkedRequirements} without explicit case links; ${p.directPairs} direct relationships; ${p.distinctCases} distinct cases (${p.archivedCases} currently archived).</p><p>${p.distinctCaseResultRecords} distinct-case recorded results: ${keys.map((key) => `${key} ${p.distinctCaseOutcomes[key]}`).join(" · ")}. Zero results is not PASS, and an empty selected population is not complete coverage.</p></header><section class="boundary"><h2>Evidence and sharing boundaries</h2><ul>${plan.rows
    .filter((row) => row[0] === "Evidence boundary")
    .map((row) => `<li>${escape(row[2]!)}</li>`)
    .join(
      "",
    )}</ul></section><section><h2>Applied scope</h2><table><tbody>${scopeRows}</tbody></table></section><section><h2>Complete selected matrix</h2><p>Requirement numbers are report-local. Repeated case rows repeat outcomes; they must not be summed into unique result counts. Title excerpts are labelled, with no inferred coverage.</p>${
    !dataRows.length
      ? "<p>No current requirements match this selection. This is not a finding of complete coverage.</p>"
      : `<div class="scroll"><table><thead><tr>${plan.headers
          .slice(3)
          .map((h) => `<th scope="col">${escape(h)}</th>`)
          .join("")}</tr></thead><tbody>${dataRows
          .map(
            (row) =>
              `<tr>${row
                .slice(3)
                .map((cell) => `<td>${escape(cell)}</td>`)
                .join("")}</tr>`,
          )
          .join("")}</tbody></table></div>`
  }</section><footer><p>Read-time export, not an approved frozen report or external delivery. Open this offline file and use browser Print if needed; no PDF has been generated by Vaettir.</p></footer></body></html>`;
  if (new TextEncoder().encode(result).length > 1024 * 1024)
    throw Error(
      "This complete matrix exceeds the supported one MiB portable file. Refine the selected scope; no partial report was prepared.",
    );
  return result;
}
