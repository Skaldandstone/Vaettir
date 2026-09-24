import type { CSSProperties, ReactNode } from "react";

type VisualTone = "success" | "warning" | "danger" | "neutral" | "info";

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function ScoreRing({
  value,
  label,
  size = "regular",
}: {
  value: number;
  label: string;
  size?: "compact" | "regular";
}) {
  const score = clampPercent(value);
  const tone: VisualTone =
    score >= 80 ? "success" : score >= 55 ? "warning" : "danger";
  const ringStyle = { "--score": `${score * 3.6}deg` } as CSSProperties;

  return (
    <div
      className={`score-ring score-ring-${size} score-ring-${tone}`}
      style={ringStyle}
      role="img"
      aria-label={`${label}: ${Math.round(score)} out of 100`}
    >
      <div className="score-ring-center">
        <strong>{Math.round(score)}</strong>
        <span>/100</span>
      </div>
    </div>
  );
}

export type DistributionSegment = {
  label: string;
  value: number;
  tone: VisualTone;
};

export function DistributionBar({
  segments,
  label,
  compact = false,
}: {
  segments: DistributionSegment[];
  label: string;
  compact?: boolean;
}) {
  const total = segments.reduce(
    (sum, segment) => sum + Math.max(0, segment.value),
    0,
  );

  return (
    <div
      className={`distribution-visual${compact ? " distribution-compact" : ""}`}
    >
      <div
        className="distribution-bar"
        role="img"
        aria-label={`${label}: ${segments.map((segment) => `${segment.label} ${segment.value}`).join(", ")}`}
      >
        {total > 0 ? (
          segments
            .filter((segment) => segment.value > 0)
            .map((segment) => (
              <span
                key={segment.label}
                className={`distribution-segment distribution-${segment.tone}`}
                style={{ flexGrow: segment.value }}
                title={`${segment.label}: ${segment.value}`}
              />
            ))
        ) : (
          <span
            className="distribution-segment distribution-neutral"
            style={{ flexGrow: 1 }}
          />
        )}
      </div>
      {!compact && (
        <div className="distribution-legend" aria-hidden="true">
          {segments.map((segment) => (
            <span key={segment.label}>
              <i className={`distribution-${segment.tone}`} />
              {segment.label} <strong>{segment.value}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function RiskMeter({
  score,
  severity,
  children,
}: {
  score: number;
  severity: string;
  children?: ReactNode;
}) {
  const value = clampPercent(score);
  const normalizedSeverity = severity.toUpperCase();
  const tone: VisualTone =
    normalizedSeverity === "CRITICAL" || value >= 80
      ? "danger"
      : normalizedSeverity === "HIGH" || value >= 60
        ? "warning"
        : normalizedSeverity === "MEDIUM" || value >= 35
          ? "info"
          : "success";

  return (
    <div
      className="risk-meter"
      role="img"
      aria-label={`Risk ${severity.toLowerCase()}, ${Math.round(value)} out of 100`}
    >
      <div className="risk-meter-heading">
        <strong className={`risk-severity risk-${tone}`}>
          {severity.replaceAll("_", " ")}
        </strong>
        <span>{Math.round(value)}/100</span>
      </div>
      <div className="risk-meter-track" aria-hidden="true">
        <span
          className={`risk-meter-fill risk-${tone}`}
          style={{ width: `${value}%` }}
        />
        <i className="risk-threshold risk-threshold-medium" />
        <i className="risk-threshold risk-threshold-high" />
        <i className="risk-threshold risk-threshold-critical" />
      </div>
      {children}
    </div>
  );
}
