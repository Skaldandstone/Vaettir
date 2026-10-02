"use client";

export function safeEvidenceHref(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function ProviderMark({ provider }: { provider: string }) {
  const name = provider.toLowerCase();
  if (name === "asana")
    return (
      <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
        <g fill="currentColor">
          <circle cx="10" cy="5" r="4" />
          <circle cx="5" cy="14" r="4" />
          <circle cx="15" cy="14" r="4" />
        </g>
      </svg>
    );
  if (name === "linear")
    return (
      <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="8" fill="currentColor" />
        <path
          d="M3 7l10 10M2 11l7 7M7 2l11 11"
          stroke="var(--panel,#20292e)"
          strokeWidth="2"
        />
      </svg>
    );
  if (name === "jira")
    return (
      <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
        <path fill="currentColor" d="M10 1l9 9-9 9-9-9zm0 5l-4 4 4 4 4-4z" />
      </svg>
    );
  return (
    <span
      aria-hidden="true"
      style={{ fontWeight: 700, fontSize: 12, width: 16, textAlign: "center" }}
    >
      {name === "notion"
        ? "N"
        : name === "wiki"
          ? "W"
          : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function EvidenceLinkChip({
  provider,
  label,
  href,
  status = "reference",
  onReview,
  disabled = false,
}: {
  provider: string;
  label: string;
  href?: string | null;
  status?: "confirmed" | "suggested" | "reference";
  onReview?: () => void;
  disabled?: boolean;
}) {
  const url = safeEvidenceHref(href);
  const caption =
    status === "confirmed"
      ? "Confirmed"
      : status === "suggested"
        ? "Suggested"
        : "Reference";
  const style = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    minWidth: 0,
    padding: "5px 9px",
    borderRadius: 999,
    border: `1px ${status === "suggested" ? "dashed" : "solid"} ${status === "confirmed" ? "var(--sage)" : "var(--line)"}`,
    background: "var(--panel)",
    color: "var(--text)",
    fontSize: 12,
    textDecoration: "none",
    lineHeight: 1.4,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    textAlign: "left",
  } as const;
  const content = (
    <>
      <ProviderMark provider={provider} />
      <span>
        {provider.replace(/^./, (first) => first.toUpperCase())} · {label}
      </span>
      <small style={{ color: "var(--muted)" }}>{caption}</small>
    </>
  );
  if (onReview)
    return (
      <button
        type="button"
        style={style}
        disabled={disabled}
        onClick={onReview}
        aria-label={`Review ${caption.toLowerCase()} ${provider} link: ${label}`}
      >
        {content}
      </button>
    );
  if (url && !disabled)
    return (
      <a
        style={style}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${caption.toLowerCase()} ${provider} reference: ${label}`}
      >
        {content}
      </a>
    );
  return (
    <span
      style={style}
      aria-label={`${caption} ${provider} reference: ${label}${url ? "" : "; source link unavailable"}`}
    >
      {content}
    </span>
  );
}
