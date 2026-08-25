"use client";

import { usePathname } from "next/navigation";

const NAV_GROUPS: { label: string; links: { href: string; label: string }[] }[] = [
  {
    label: "Workspace",
    links: [
      { href: "/projects", label: "Projects" },
      { href: "/test-cases", label: "Test Cases" },
      { href: "/test-plans", label: "Test Plans" },
      { href: "/requirements", label: "Requirements" },
    ],
  },
  {
    label: "Intelligence",
    links: [
      { href: "/reverse-engineer", label: "Reverse Engineer" },
      { href: "/risk-analysis", label: "Risk Analysis" },
    ],
  },
  {
    label: "Admin",
    links: [
      { href: "/settings/members", label: "Members" },
      { href: "/settings/organization", label: "Settings" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="app-sidebar">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="sidebar-group">
          <div className="eyebrow sidebar-group-label">{group.label}</div>
          {group.links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <a key={link.href} href={link.href} className={`sidebar-link${active ? " active" : ""}`}>
                {link.label}
              </a>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
