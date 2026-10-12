import { inspectorLabel } from "@/lib/case-inspector";

const colors = ["var(--frost)", "var(--info)", "var(--warning)", "var(--ember)", "#b79dd6", "#57b3b6", "#ca8da7"];

/** Inventory composition only. A type never implies pass rate or readiness. */
export function TestTypeDistribution({ cases }: { cases: readonly { testType: string }[] }) {
  const counts = new Map<string, number>();
  for (const item of cases) counts.set(item.testType, (counts.get(item.testType) ?? 0) + 1);
  const entries = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return <figure className="test-type-distribution">
    <svg viewBox="0 0 160 160" className="test-type-donut" role="img" aria-label={`Test type distribution: ${entries.map(([type, count]) => `${inspectorLabel(type)} ${count} of ${cases.length}`).join(", ") || "No cases"}`}>
      <circle cx="80" cy="80" r="60" fill="none" stroke="var(--line)" strokeWidth="18" />
      {entries.map(([type, count], index) => {
        const percent = count / cases.length * 100;
        const start = entries.slice(0, index).reduce((sum, [, amount]) => sum + amount, 0) / cases.length * 100;
        return <circle key={type} cx="80" cy="80" r="60" fill="none" stroke={colors[index % colors.length]} strokeWidth="18" pathLength="100" strokeDasharray={`${percent} ${100 - percent}`} strokeDashoffset={-start} transform="rotate(-90 80 80)"><title>{inspectorLabel(type)}: {count} ({Math.round(percent)}%)</title></circle>;
      })}
      <text x="80" y="77" textAnchor="middle" className="test-type-total">{cases.length.toLocaleString()}</text>
      <text x="80" y="98" textAnchor="middle" className="test-type-caption">cases</text>
    </svg>
    <figcaption><ul className="test-type-legend">{entries.map(([type, count], index) => <li key={type}><i style={{ background: colors[index % colors.length] }} aria-hidden="true"/><span>{inspectorLabel(type)}</span><strong>{count.toLocaleString()}</strong><span className="text-muted">{Math.round(count / cases.length * 100)}%</span></li>)}</ul></figcaption>
  </figure>;
}
