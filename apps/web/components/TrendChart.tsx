// P7-07: a small dependency-free SVG line chart -- the data here is a
// handful of points per project (one per release), nowhere near enough to
// justify pulling in a charting library.
export function TrendChart({
  points,
  formatValue,
  color = "var(--frost)",
  height = 100,
}: {
  points: { label: string; value: number | null }[];
  formatValue: (v: number) => string;
  color?: string;
  height?: number;
}) {
  const known = points.filter((p): p is { label: string; value: number } => p.value !== null);
  if (known.length === 0) {
    return (
      <p className="text-muted" style={{ fontSize: 12 }}>
        Not enough data yet.
      </p>
    );
  }

  const width = Math.max(points.length * 60, 120);
  const padding = 16;
  const max = Math.max(...known.map((p) => p.value), 0.0001);
  const min = Math.min(...known.map((p) => p.value), 0);
  const range = max - min || 1;

  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  const step = points.length > 1 ? usableWidth / (points.length - 1) : 0;

  const coords = points.map((p, i) => ({
    x: padding + step * i,
    y: p.value === null ? null : padding + usableHeight - ((p.value - min) / range) * usableHeight,
    point: p,
  }));

  const linePath = coords
    .filter((c) => c.y !== null)
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`)
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible" }}>
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} />
      {coords.map((c, i) =>
        c.y === null ? null : (
          <g key={i}>
            <circle cx={c.x} cy={c.y} r={3} fill={color} />
            <title>
              {c.point.label}: {formatValue(c.point.value!)}
            </title>
          </g>
        ),
      )}
    </svg>
  );
}
