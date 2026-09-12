"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import { GlobalSearch } from "./GlobalSearch";
import { Icon, type IconName } from "./ui/Workspace";
import { isNavigationActive } from "../lib/usability";

// Ported 2026-09-11 from codex/private-beta-readiness: functional icons per
// link, exact matching for the overview links so "/projects/x" isn't
// active on every sub-page, aria-current, and the workspace header.
const LINK_ICONS: Record<string, IconName> = {
  Dashboard: "grid",
  Projects: "folder",
  Members: "people",
  "Access Review": "check",
  Settings: "settings",
  "Example workspace": "grid",
  Overview: "grid",
  "Test Cases": "cases",
  "Test Plans": "book",
  "Test Runs": "check",
  Requirements: "cases",
  Compliance: "check",
  "Audit Log": "clock",
  "Reverse Engineer": "spark",
  "Live App Generation": "spark",
  Import: "folder",
  "Test Strategy": "branch",
  "Release Readiness": "release",
};

const ORG_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
];
const ORG_ADMIN_LINKS = [
  { href: "/settings/members", label: "Members" },
  { href: "/settings/access-review", label: "Access Review" },
  { href: "/settings/billing", label: "Billing" },
  { href: "/settings/organization", label: "Settings" },
];

// Mirrors TestRail/Qase: a project-scoped sidebar with a switcher at the
// top, not a flat global list of pages that all happen to take a
// ?projectId= param. See STYLE_GUIDE.md-adjacent decision: this file
// replaces its own content based on route rather than stacking a second
// sidebar alongside the org one -- that's what the real tools do too.
function projectIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/([^/]+)/);
  return match?.[1] ?? null;
}

function ProjectSidebar({ projectId }: { projectId: string }) {
  const router = useRouter();
  // P1-15: project.byId is shared with every page under /projects/[id] via
  // the react-query cache, so the sidebar no longer issues its own copy of
  // that request on every navigation.
  const projectQuery = trpcReact.project.byId.useQuery({ id: projectId });
  const organizationId = projectQuery.data?.organizationId;
  const listQuery = trpcReact.project.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: organizationId !== undefined },
  );
  const projects = listQuery.data ?? [];
  const currentName = projectQuery.data?.name ?? "";

  const links = [
    { href: `/projects/${projectId}`, label: "Overview" },
    { href: `/projects/${projectId}/test-cases`, label: "Test Cases" },
    { href: `/projects/${projectId}/test-plans`, label: "Test Plans" },
    { href: `/projects/${projectId}/test-runs`, label: "Test Runs" },
    { href: `/projects/${projectId}/requirements`, label: "Requirements" },
    { href: `/projects/${projectId}/compliance`, label: "Compliance" },
    { href: `/projects/${projectId}/audit-log`, label: "Audit Log" },
    { href: `/projects/${projectId}/reverse-engineer`, label: "Reverse Engineer" },
    { href: `/projects/${projectId}/live-app-generation`, label: "Live App Generation" },
    { href: `/projects/${projectId}/import`, label: "Import" },
    { href: `/projects/${projectId}/test-strategy`, label: "Test Strategy" },
    { href: `/projects/${projectId}/releases`, label: "Release Readiness" },
  ];

  return (
    <aside className="app-sidebar">
      <div className="sidebar-group">
        <Link href="/projects" className="sidebar-back">
          &larr; All projects
        </Link>
        <select
          className="sidebar-project-switcher"
          aria-label="Switch project"
          value={projectId}
          onChange={(e) => router.push(`/projects/${e.target.value}`)}
        >
          {!projects.some((p) => p.id === projectId) && <option value={projectId}>{currentName || "…"}</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="sidebar-group">
        <GlobalSearch projectId={projectId} />
      </div>
      <div className="sidebar-group">
        <div className="eyebrow sidebar-group-label">Project</div>
        {links.map((link) => (
          <SidebarLink key={link.href} href={link.href} label={link.label} exact={link.label === "Overview"} />
        ))}
      </div>
      <div className="sidebar-group">
        <div className="eyebrow sidebar-group-label">Organization</div>
        {ORG_ADMIN_LINKS.map((link) => (
          <SidebarLink key={link.href} href={link.href} label={link.label} />
        ))}
      </div>
    </aside>
  );
}

function SidebarLink({ href, label, exact = false }: { href: string; label: string; exact?: boolean }) {
  const pathname = usePathname();
  const active = isNavigationActive(pathname, href, exact);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`sidebar-link${active ? " active" : ""}`}>
      <Icon name={LINK_ICONS[label] ?? "folder"} size={17} />
      {label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const projectId = projectIdFromPath(pathname);

  // /projects itself (the list/switcher's own destination) is org-level,
  // not a specific project -- only /projects/<id>/... enters project scope.
  if (projectId) {
    return <ProjectSidebar key={projectId} projectId={projectId} />;
  }

  return (
    <aside className="app-sidebar">
      <div className="sidebar-workspace">
        <span className="workspace-monogram">v</span>
        <div>
          <strong>Quality workspace</strong>
          <small>vaettir private beta</small>
        </div>
      </div>
      <div className="sidebar-group">
        <div className="eyebrow sidebar-group-label">Workspace</div>
        <SidebarLink href="/" label="Example workspace" exact />
        {ORG_LINKS.map((link) => (
          <SidebarLink key={link.href} href={link.href} label={link.label} />
        ))}
      </div>
      <div className="sidebar-group">
        <div className="eyebrow sidebar-group-label">Organization</div>
        {ORG_ADMIN_LINKS.map((link) => (
          <SidebarLink key={link.href} href={link.href} label={link.label} />
        ))}
      </div>
    </aside>
  );
}
