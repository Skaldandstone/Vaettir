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
  | "clock"
  | "filter" | "more" | "copy" | "undo" | "help" | "close" | "back" | "external" | "plus"
  | "up" | "down" | "delete" | "drag" | "edit"
  | "chevron" | "collapse" | "expand" | "sidebar" | "pin" | "reset"
  | "sun" | "moon" | "image" | "video" | "link" | "refresh" | "save";

// Small functional UI glyphs. The product's canonical rune remains unchanged.
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    chevron: <path d="m9 5 7 7-7 7" />,
    collapse: <><path d="m6 3 6 5 6-5M6 21l6-5 6 5M5 12h14" /></>,
    expand: <><path d="m5 10 7-7 7 7M5 14l7 7 7-7" /></>,
    sidebar: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></>,
    pin: <path d="m9 3 9 9-3 1-3 5-3-3-6 6 6-6-3-3 5-3 1-3Z" />,
    reset: <><path d="M3 10a9 9 0 1 1 2 9M3 4v6h6"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></>,
    moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z" />,
    image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></>,
    video: <><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3Z"/></>,
    link: <><path d="m9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/></>,
    refresh: <><path d="M20 9a8 8 0 0 0-14-4L3 8m0-5v5h5M4 15a8 8 0 0 0 14 4l3-3m0 5v-5h-5"/></>,
    save: <><path d="M4 3h13l4 4v14H3V3ZM7 3v6h9V3M7 21v-8h10v8"/></>,
    drag: <><circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/></>,
    edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2.1 2.1 0 0 0-4-4L5 15l-1 5Z"/></>,
    up: <path d="M12 20V4m-6 6 6-6 6 6" />,
    down: <path d="M12 4v16m-6-6 6 6 6-6" />,
    delete: <path d="M4 7h16M9 7V3h6v4M6 7l1 14h10l1-14M10 11v6M14 11v6" />,
    filter: <><path d="M4 6h16M7 12h10M10 18h4"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/></>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/></>,
    undo: <><path d="M4 10h10a6 6 0 0 1 0 12M4 10l5-5M4 10l5 5"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2M12 17h.01"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    back: <path d="M20 12H4m6-6-6 6 6 6"/>,
    external: <><path d="M14 3h7v7m0-7L10 14"/><path d="M11 3H3v18h18v-8"/></>,
    plus: <path d="M12 4v16M4 12h16"/>,
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
