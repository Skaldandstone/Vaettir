import type { RouterOutputs } from "./trpcReact";
type Summary = RouterOutputs["qualityRiskOverview"]["summary"];
type Counts = Summary["population"];
export type RiskAggregateFilter = {
  search: string;
  likelihood?: string;
  consequence?: string;
  review: string;
  disposition: string;
  evidence: string;
  mitigation: string;
};
const categories = {
  likelihood: ["UNKNOWN", "RARE", "POSSIBLE", "FREQUENT"],
  consequence: ["UNKNOWN", "MINOR", "SIGNIFICANT", "SEVERE"],
  review: ["NO_REVIEW", "VERSION_MATCHING_REVIEW", "BASELINE_CHANGED"],
  disposition: [
    "NOT_RECORDED",
    "FURTHER_ACTION",
    "REVIEW_RECORDED",
    "HUMAN_ACCEPTANCE_RECORDED",
  ],
  evidence: [
    "NO_REVIEW",
    "NONE_RECORDED",
    "ALL_REFERENCES_AVAILABLE",
    "SOME_REFERENCES_UNAVAILABLE",
    "ALL_REFERENCES_UNAVAILABLE",
  ],
  mitigation: [
    "NO_LINKS",
    "ALL_REFERENCES_AVAILABLE",
    "SOME_REFERENCES_UNAVAILABLE",
    "ALL_REFERENCES_UNAVAILABLE",
  ],
} as const;
type Dimension = keyof typeof categories;
export const riskAggregateBoundaries = [
  "Read-time full and filtered population aggregates, not an approved frozen report, complete register backup or external recipient access grant.",
  "Manual qualitative categories and latest ordinary decisions only. No calibrated score, risk reduction, verified effectiveness, safety qualification or regulatory acceptance.",
  "Version matching checks the risk entry only; later case procedures, requirements and result statuses are not automatically reverified.",
  "Evidence availability resolves current same-project identities, not verified outcomes. References may repeat across entries; captured statuses remain historical.",
  "No per-entry rows, risk titles, components, notes, raw project/organization/actor/case/result IDs or literal search text are exported. Search text omission prevents full filter reconstruction.",
] as const;
function refuse(): never {
  throw Error(
    "Complete risk aggregate counts or scope are inconsistent. No partial or zero-substitute export was prepared.",
  );
}
const count = (value: number, max: number) =>
  Number.isSafeInteger(value) && value >= 0 && value <= max;
function validateCounts(value: Counts) {
  if (!value || !count(value.entries, 1000)) return refuse();
  for (const [dimension, keys] of Object.entries(categories) as [
    Dimension,
    readonly string[],
  ][]) {
    const recorded = value[dimension] as Record<string, number>;
    if (
      !recorded ||
      Object.keys(recorded).length !== keys.length ||
      keys.some((key) => !count(recorded[key]!, value.entries)) ||
      keys.reduce((sum, key) => sum + recorded[key]!, 0) !== value.entries
    )
      return refuse();
  }
  const references = value.evidenceReferences;
  if (
    !references ||
    Object.keys(references).length !== 3 ||
    !count(references.total, value.entries * 20) ||
    !count(references.available, references.total) ||
    !count(references.unavailable, references.total) ||
    references.total !== references.available + references.unavailable ||
    value.review.NO_REVIEW !== value.evidence.NO_REVIEW ||
    value.review.NO_REVIEW !== value.disposition.NOT_RECORDED
  )
    return refuse();
  if (
    (!references.total &&
      (value.evidence.ALL_REFERENCES_AVAILABLE ||
        value.evidence.SOME_REFERENCES_UNAVAILABLE ||
        value.evidence.ALL_REFERENCES_UNAVAILABLE)) ||
    (!references.available &&
      (value.evidence.ALL_REFERENCES_AVAILABLE ||
        value.evidence.SOME_REFERENCES_UNAVAILABLE)) ||
    (!references.unavailable &&
      (value.evidence.ALL_REFERENCES_UNAVAILABLE ||
        value.evidence.SOME_REFERENCES_UNAVAILABLE))
  )
    return refuse();
  if (
    references.available <
      value.evidence.ALL_REFERENCES_AVAILABLE +
        value.evidence.SOME_REFERENCES_UNAVAILABLE ||
    references.unavailable <
      value.evidence.ALL_REFERENCES_UNAVAILABLE +
        value.evidence.SOME_REFERENCES_UNAVAILABLE
  )
    return refuse();
}
/** Only aggregates leave this function. The caller uses the shared bounded CSV encoder. */
export function qualityRiskAggregateCsvPlan(
  value: Pick<Summary, "observedAt" | "population" | "filtered" | "limits">,
  filters: RiskAggregateFilter,
) {
  validateCounts(value.population);
  validateCounts(value.filtered);
  if (
    value.filtered.entries > value.population.entries ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    new Date(value.observedAt).toISOString() !== value.observedAt ||
    !Array.isArray(value.limits) ||
    value.limits.length > 20 ||
    value.limits.some(
      (item) => typeof item !== "string" || item.length > 4000,
    ) ||
    typeof filters.search !== "string" ||
    filters.search.length > 80
  )
    return refuse();
  for (const [dimension, keys] of Object.entries(categories) as [
    Dimension,
    readonly string[],
  ][]) {
    const selected = filters[dimension];
    if (
      selected !== undefined &&
      selected !== "" &&
      selected !== "ANY" &&
      !keys.includes(selected)
    )
      return refuse();
    if (
      keys.some(
        (key) =>
          (value.filtered[dimension] as Record<string, number>)[key]! >
          (value.population[dimension] as Record<string, number>)[key]!,
      )
    )
      return refuse();
  }
  if (
    (["total", "available", "unavailable"] as const).some(
      (key) =>
        value.filtered.evidenceReferences[key] >
        value.population.evidenceReferences[key],
    )
  )
    return refuse();
  const unfiltered =
    !filters.search &&
    (Object.keys(categories) as Dimension[]).every(
      (key) => !filters[key] || filters[key] === "ANY",
    );
  if (
    unfiltered &&
    (value.filtered.entries !== value.population.entries ||
      (Object.entries(categories) as [Dimension, readonly string[]][]).some(
        ([dimension, keys]) =>
          keys.some(
            (key) =>
              (value.filtered[dimension] as Record<string, number>)[key] !==
              (value.population[dimension] as Record<string, number>)[key],
          ),
      ) ||
      (["total", "available", "unavailable"] as const).some(
        (key) =>
          value.filtered.evidenceReferences[key] !==
          value.population.evidenceReferences[key],
      ))
  )
    return refuse();
  const rows: Array<Array<string | number>> = [
    ["Scope", "Format", "Read-time human risk aggregates", "Vaettir CSV v1"],
    ["Scope", "Observed UTC", "Response observation time", value.observedAt],
    [
      "Scope",
      "Search",
      "Literal text omitted",
      filters.search ? "Applied search; text not exported" : "No search filter",
    ],
  ];
  for (const dimension of Object.keys(categories) as Dimension[])
    rows.push([
      "Scope",
      "Applied filter",
      dimension,
      filters[dimension] || "ANY",
    ]);
  for (const [cohort, counts] of [
    ["Full project population", value.population],
    ["Filtered cohort", value.filtered],
  ] as const) {
    rows.push([cohort, "Population", "Entries", counts.entries]);
    for (const [dimension, keys] of Object.entries(categories) as [
      Dimension,
      readonly string[],
    ][])
      for (const key of keys)
        rows.push([
          cohort,
          dimension,
          key,
          (counts[dimension] as Record<string, number>)[key]!,
        ]);
    for (const key of ["total", "available", "unavailable"] as const)
      rows.push([
        cohort,
        "Latest-review evidence references",
        key,
        counts.evidenceReferences[key],
      ]);
  }
  for (const boundary of [...riskAggregateBoundaries, ...value.limits])
    rows.push(["Evidence boundary", "", "", boundary]);
  return {
    headers: [
      "Cohort or scope",
      "Recorded dimension",
      "Category or meaning",
      "Value",
    ],
    rows,
  };
}
