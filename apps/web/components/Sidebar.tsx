"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { trpc, type RouterOutputs } from "../lib/trpc";
import { GlobalSearch } from "./GlobalSearch";

const ORG_LINKS = [{ href: "/projects", label: "Projects" }];
const ORG_ADMIN_LINKS = [
  { href: "/settings/members", label: "Members" },
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
  const [projects, setProjects] = useState<RouterOutputs["project"]["list"]>([]);
  const [currentName, setCurrentName] = useState("");

  useEffect(() => {
    trpc.project.byId
      .query({ id: projectId })
      .then(async (p) => {
        setCurrentName(p.name);
        const list = await trpc.project.list.query({ organizationId: p.organizationId });
        setProjects(list);
      })
      .catch(() => undefined);
  }, [projectId]);

  const links = [
    { href: `/projects/${projectId}`, label: "Overview" },
    { href: `/projects/${projectId}/test-cases`, label: "Test Cases" },
    { href: `/projects/${projectId}/test-plans`, label: "Test Plans" },
    { href: `/projects/${projectId}/requirements`, label: "Requirements" },
    { href: `/projects/${projectId}/compliance`, label: "Compliance" },
    { href: `/projects/${projectId}/audit-log`, label: "Audit Log" },
    { href: `/projects/${projectId}/reverse-engineer`, label: "Reverse Engineer" },
    { href: `/projects/${projectId}/test-strategy`, label: "Test Strategy" },
    { href: `/projects/${projectId}/releases`, label: "Release Readiness" },
  ];

  return (
    <aside className="app-sidebar">
      <div className="sidebar-group">
        <a href="/projects" className="sidebar-back">
          &larr; All projects
        </a>
        <select
          className="sidebar-project-switcher"
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

function SidebarLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  return (
    <a href={href} className={`sidebar-link${active ? " active" : ""}`}>
      {label}
    </a>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const projectId = projectIdFromPath(pathname);

  // /projects itself (the list/switcher's own destination) is org-level,
  // not a specific project -- only /projects/<id>/... enters project scope.
  if (projectId) {
    return <ProjectSidebar projectId={projectId} />;
  }

  return (
    <aside className="app-sidebar">
      <div className="sidebar-group">
        <div className="eyebrow sidebar-group-label">Organization</div>
        {[...ORG_LINKS, ...ORG_ADMIN_LINKS].map((link) => (
          <SidebarLink key={link.href} href={link.href} label={link.label} />
        ))}
      </div>
    </aside>
  );
}
