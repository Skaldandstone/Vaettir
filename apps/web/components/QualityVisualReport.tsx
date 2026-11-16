import type { QualityVisualReport as Model } from "@vaettir/core";

/** Same Vaettir chart model used by approved integration responses. */
export function QualityVisualReport({ model }: { model: Model }) {
  return (
    <div className="quality-visual-report">
      {model.charts.map((chart) => {
        const total = chart.rows.reduce((sum, row) => sum + row.value, 0);
        const max = Math.max(1, ...chart.rows.map((row) => row.value));
        let offset = 0;
        return (
          <figure
            key={chart.id}
            className="quality-visual"
            aria-label={chart.title}
          >
            <figcaption>
              <h3>{chart.title}</h3>
            </figcaption>
            {chart.kind === "donut" ? (
              <svg
                viewBox="0 0 240 220"
                role="img"
                aria-label={
                  total
                    ? `${chart.title}: ${chart.rows.map((r) => `${r.label} ${r.value}`).join(", ")}`
                    : chart.empty
                }
              >
                <circle
                  cx="120"
                  cy="106"
                  r="76"
                  fill="none"
                  stroke="var(--line, #dce2ea)"
                  strokeWidth="24"
                />
                {chart.rows.map((row) => {
                  const length = total ? (row.value / total) * 100 : 0;
                  const start = offset;
                  offset += length;
                  return (
                    <circle
                      key={row.label}
                      cx="120"
                      cy="106"
                      r="76"
                      fill="none"
                      stroke={row.color}
                      strokeWidth="24"
                      pathLength="100"
                      strokeDasharray={`${length} ${100 - length}`}
                      strokeDashoffset={-start}
                      transform="rotate(-90 120 106)"
                    />
                  );
                })}
                <text
                  x="120"
                  y="108"
                  textAnchor="middle"
                  fill="currentColor"
                  fontSize="32"
                  fontWeight="650"
                >
                  {total ? total.toLocaleString() : "—"}
                </text>
                <text
                  x="120"
                  y="132"
                  textAnchor="middle"
                  fill="currentColor"
                  fontSize="12"
                >
                  {total ? chart.unit : "No data"}
                </text>
              </svg>
            ) : (
              <svg
                viewBox={`0 0 400 ${Math.max(150, chart.rows.length * 52)}`}
                role="img"
                aria-label={chart.title}
              >
                {chart.rows.map((row, i) => (
                  <g key={row.label} transform={`translate(0 ${i * 52})`}>
                    <text x="0" y="15" fill="currentColor" fontSize="13">
                      {row.label}
                    </text>
                    <text
                      x="398"
                      y="15"
                      textAnchor="end"
                      fill="currentColor"
                      fontSize="13"
                    >
                      {row.value}
                    </text>
                    <rect
                      x="0"
                      y="24"
                      width="400"
                      height="13"
                      rx="6"
                      fill="var(--line, #dce2ea)"
                    />
                    <rect
                      x="0"
                      y="24"
                      width={(row.value / max) * 400}
                      height="13"
                      rx="6"
                      fill={row.color}
                    />
                  </g>
                ))}
              </svg>
            )}
            {total ? (
              <ul className="quality-visual-legend">
                {chart.rows.map((row) => (
                  <li key={row.label}>
                    <span>
                      <i style={{ background: row.color }} />
                      {row.label}
                    </span>
                    <strong>{row.value.toLocaleString()}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{chart.empty}</p>
            )}
            <p className="text-muted">
              <small>{chart.note}</small>
            </p>
          </figure>
        );
      })}
    </div>
  );
}
