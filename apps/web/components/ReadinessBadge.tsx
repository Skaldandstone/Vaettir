const LABEL_STYLE: Record<string, { color: string; background: string }> = {
  READY: { color: "var(--frost)", background: "var(--frost-dim)" },
  AT_RISK: { color: "var(--ember)", background: "transparent" },
  BLOCKED: { color: "var(--ember)", background: "var(--ember-dim)" },
};

export function ReadinessBadge({ score, label }: { score: number; label: string }) {
  const style = LABEL_STYLE[label] ?? LABEL_STYLE.AT_RISK!;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.02em",
        color: style.color,
        background: style.background,
        border: `1px solid ${style.color}`,
      }}
    >
      {score}/100 · {label.replace("_", " ")}
    </span>
  );
}
