import type { ReactNode } from "react";

export type IconName =
  | "grid"
  | "folder"
  | "cases"
  | "check"
  | "alert"
  | "spark"
  | "release"
  | "arrow"
  | "search"
  | "people"
  | "settings"
  | "book"
  | "branch"
  | "clock";

// Small functional UI glyphs. The product's canonical rune remains unchanged.
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    folder: (
      <path d="M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    ),
    cases: (
      <>
        <rect x="5" y="4" width="15" height="17" rx="2" />
        <path d="M9 4V2h7v2M9 10h7M9 15h7" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    alert: (
      <>
        <path d="m12 3 10 17H2L12 3ZM12 9v4M12 17h.01" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
      </>
    ),
    release: (
      <>
        <path d="m4 16 4 4M7 17l4-4m-4-2 6-6 7-1-1 7-6 6-6-6ZM5 13l-2 5 3 3 5-2" />
        <circle cx="15" cy="9" r="1.5" />
      </>
    ),
    arrow: <path d="M4 12h15m-5-5 5 5-5 5" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6.5" />
        <path d="m15 15 6 6" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-3-5" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="16" cy="17" r="3" />
      </>
    ),
    book: (
      <>
        <path d="M12 5v16M12 5C8 2 4 3 2 4v16c3-1 6-1 10 1 4-2 7-2 10-1V4c-2-1-6-2-10 1Z" />
      </>
    ),
    branch: (
      <>
        <circle cx="6" cy="5" r="2" />
        <circle cx="6" cy="19" r="2" />
        <circle cx="18" cy="5" r="2" />
        <path d="M6 7v10m0-5c8 0 12-1 12-5" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info";
export function StatusPill({
  tone = "neutral",
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return (
    <span className={`status-pill status-${tone}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="workspace-heading">
      <div>
        <p className="workspace-breadcrumb">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="text-muted">{description}</p>
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </header>
  );
}

export function MetricCard({
  icon,
  label,
  value,
  note,
  tone = "neutral",
}: {
  icon: IconName;
  label: string;
  value: number;
  note: string;
  tone?: StatusTone;
}) {
  return (
    <div className="metric-card" role="group" aria-label={label}>
      <div className="metric-top">
        <span>{label}</span>
        <span className={`metric-icon status-${tone}`}>
          <Icon name={icon} />
        </span>
      </div>
      <strong>{value}</strong>
      <span className="metric-note">{note}</span>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="workspace-empty">
      <span className="empty-icon">
        <Icon name="folder" size={24} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
