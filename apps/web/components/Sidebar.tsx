"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { trpcReact } from "@/lib/trpcReact";
import { GlobalSearch } from "./GlobalSearch";
import { Icon, type IconName } from "./ui/Workspace";
import { isNavigationActive } from "../lib/usability";
import {
  projectNavigationForExperience,
  navigationGroupIsActive,
  hiddenActiveProjectLinks,
} from "../lib/workbench-navigation";
import styles from "./WorkbenchNavigation.module.css";
import { QualityExperienceWizard } from "./QualityExperienceWizard";

// Ported 2026-09-11 from codex/private-beta-readiness: functional icons per
// link, exact matching for the overview links so "/projects/x" isn't
// active on every sub-page, aria-current, and the workspace header.
const LINK_ICONS: Record<string, IconName> = {
  Dashboard: "grid",
  Projects: "folder",
  "Example workspace": "grid",
  Overview: "grid",
  "Test Cases": "cases",
  "Test Plans": "book",
  "Test Runs": "check",
  Reports: "grid",
  Requirements: "cases",
  "Requirement baselines": "clock",
  "Requirement coverage": "check",
  "Recorded run comparison": "branch",
  Compliance: "check",
  "Quality risks": "branch",
  "Audit Log": "clock",
  "Reverse Engineer": "spark",
  "Live App Generation": "spark",
  "Production Signals": "spark",
  Import: "folder",
  "Test Strategy": "branch",
  "Release Readiness": "release",
};

const ORG_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
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

function SidebarFrame({
  label,
  detail,
  children,
}: {
  label: string;
  detail: string;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <aside className={`app-sidebar${mobileOpen ? " mobile-open" : ""}`}>
      <button
        className="sidebar-mobile-toggle"
        type="button"
        aria-expanded={mobileOpen}
        aria-controls="workspace-navigation"
        onClick={() => setMobileOpen((open) => !open)}
      >
        <span className="sidebar-mobile-identity">
          <Icon name="grid" size={17} />
          <span>
            <strong>{label}</strong>
            <small>{detail}</small>
          </span>
        </span>
        <span className="sidebar-mobile-action" aria-hidden="true">
          {mobileOpen ? "Close" : "Menu"}
        </span>
      </button>
      <div
        className="sidebar-content"
        id="workspace-navigation"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setMobileOpen(false);
        }}
      >
        {children}
      </div>
    </aside>
  );
}

function ProjectSidebar({ projectId }: { projectId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  // P1-15: project.byId is shared with every page under /projects/[id] via
  // the react-query cache, so the sidebar no longer issues its own copy of
  // that request on every navigation.
  const projectQuery = trpcReact.project.byId.useQuery({ id: projectId });
  const projectAccessible = projectQuery.isSuccess && !projectQuery.isError;
  const organizationId = projectAccessible
    ? projectQuery.data.organizationId
    : undefined;
  const listQuery = trpcReact.project.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: organizationId !== undefined },
  );
  const projects =
    projectAccessible && !listQuery.isError ? (listQuery.data ?? []) : [];
  const currentName = projectAccessible ? projectQuery.data.name : "";
  const [toolsOpen, setToolsOpen] = useState(false);
  const experienceQuery = trpcReact.project.experience.useQuery(
    { projectId },
    { enabled: projectQuery.isSuccess && !projectQuery.isError },
  );
  const navigation = projectNavigationForExperience(
    experienceQuery.isSuccess && !experienceQuery.isError
      ? experienceQuery.data.experience?.offerings
      : null,
    experienceQuery.isSuccess && !experienceQuery.isError
      ? experienceQuery.data.experience?.enabledTools
      : undefined,
  );
  const hiddenActive = hiddenActiveProjectLinks(
    pathname,
    projectId,
    navigation,
  );

  return (
    <SidebarFrame
      label={currentName || "Project workspace"}
      detail="Project navigation"
    >
      <div className="sidebar-group">
        <Link href="/projects" className="sidebar-back">
          &larr; All projects
        </Link>
        <select
          className="sidebar-project-switcher"
          aria-label="Switch project"
          disabled={!projectAccessible || listQuery.isPending}
          value={projectId}
          onChange={(e) => router.push(`/projects/${e.target.value}`)}
        >
          {!projects.some((p) => p.id === projectId) && (
            <option value={projectId}>{currentName || "…"}</option>
          )}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {projectQuery.isSuccess && !projectQuery.isError && (
        <div className="sidebar-group">
          <GlobalSearch projectId={projectId} />
        </div>
      )}
      {projectQuery.isSuccess && !projectQuery.isError ? (
        <nav aria-label="Project">
          {hiddenActive.length > 0 && (
            <div className="sidebar-group" role="status">
              <small>
                This tool is hidden from navigation for this project. Existing
                evidence remains available.
              </small>
              {hiddenActive.map((link) => (
                <SidebarLink
                  key={link.path}
                  href={`/projects/${projectId}${link.path}`}
                  label={link.label}
                />
              ))}
            </div>
          )}
          {navigation.map((group) => {
            const links = group.links.map((link) => (
              <SidebarLink
                key={link.path}
                href={`/projects/${projectId}${link.path}`}
                label={link.label}
                exact={link.path === ""}
              />
            ));
            return group.collapsible ? (
              <details
                key={group.label}
                className={styles.group}
                open={navigationGroupIsActive(pathname, projectId, group.links)}
              >
                <summary>{group.label}</summary>
                <div className={styles.links}>{links}</div>
              </details>
            ) : (
              <div key={group.label} className={styles.group}>
                <div className={`eyebrow sidebar-group-label ${styles.label}`}>
                  {group.label}
                </div>
                {links}
              </div>
            );
          })}
          <button
            type="button"
            className="sidebar-link"
            onClick={() => setToolsOpen(true)}
          >
            Customize project tools
          </button>
        </nav>
      ) : (
        <div
          className="sidebar-group"
          role={projectQuery.isError ? "alert" : "status"}
        >
          {projectQuery.isError
            ? "Project navigation unavailable. Return to All projects to choose a project you can access."
            : "Loading project navigation…"}
        </div>
      )}
      <QualityExperienceWizard
        projectId={projectId}
        open={toolsOpen && projectAccessible}
        onClose={() => setToolsOpen(false)}
      />
    </SidebarFrame>
  );
}

function SidebarLink({
  href,
  label,
  exact = false,
}: {
  href: string;
  label: string;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = isNavigationActive(pathname, href, exact);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`sidebar-link${active ? " active" : ""}`}
    >
      <Icon name={LINK_ICONS[label] ?? "folder"} size={17} />
      {label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [exampleVisible, setExampleVisible] = useState(true);

  useEffect(() => {
    // The server cannot read browser storage; reconcile this browser-only preference after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExampleVisible(
      localStorage.getItem("vaettir:hide-example-workspace") !== "1",
    );
  }, []);

  function setExampleWorkspaceVisible(visible: boolean) {
    setExampleVisible(visible);
    if (visible) localStorage.removeItem("vaettir:hide-example-workspace");
    else localStorage.setItem("vaettir:hide-example-workspace", "1");
  }

  // /share is a public, unauthenticated preview surface (see middleware.ts) -
  // an org-scoped sidebar would either render nothing useful or attempt
  // authed tRPC calls that fail for a visitor with no session at all.
  if (
    pathname.startsWith("/share") ||
    pathname.startsWith("/beta-guide") ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/onboarding")
  )
    return null;

  const projectId = projectIdFromPath(pathname);

  // /projects itself (the list/switcher's own destination) is org-level,
  // not a specific project -- only /projects/<id>/... enters project scope.
  if (projectId) {
    return <ProjectSidebar key={projectId} projectId={projectId} />;
  }

  return (
    <SidebarFrame label="Quality workspace" detail="Private beta">
      <div className="sidebar-workspace">
        <span className="workspace-monogram">v</span>
        <div>
          <strong>Quality workspace</strong>
          <small>vaettir private beta</small>
        </div>
      </div>
      <div className="sidebar-group">
        <div className="eyebrow sidebar-group-label">Workspace</div>
        {exampleVisible ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              alignItems: "center",
            }}
          >
            <SidebarLink href="/" label="Example workspace" exact />
            <button
              type="button"
              className="btn-secondary"
              aria-label="Hide example workspace"
              title="Hide example workspace"
              onClick={() => setExampleWorkspaceVisible(false)}
              style={{ padding: "2px 7px", marginRight: 6, fontSize: 14 }}
            >
              ×
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="sidebar-link"
            onClick={() => setExampleWorkspaceVisible(true)}
            style={{
              width: "100%",
              border: 0,
              background: "transparent",
              cursor: "pointer",
            }}
          >
            <Icon name="grid" size={17} />
            Show example workspace
          </button>
        )}
        {ORG_LINKS.map((link) => (
          <SidebarLink key={link.href} href={link.href} label={link.label} />
        ))}
      </div>
    </SidebarFrame>
  );
}
