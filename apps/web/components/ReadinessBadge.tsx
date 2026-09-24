export function ReadinessBadge({
  score,
  label,
}: {
  score: number;
  label: string;
}) {
  const boundedScore = Math.min(100, Math.max(0, score));
  const tone =
    label === "READY" ? "success" : label === "BLOCKED" ? "danger" : "warning";
  return (
    <span
      className={`readiness-meter readiness-${tone}`}
      aria-label={`${label.replace("_", " ")}: ${score} out of 100`}
    >
      <span className="readiness-meter-copy">
        <strong>{label.replace("_", " ")}</strong>
        <span>{score}/100</span>
      </span>
      <span className="readiness-meter-track" aria-hidden="true">
        <span style={{ width: `${boundedScore}%` }} />
      </span>
    </span>
  );
}
