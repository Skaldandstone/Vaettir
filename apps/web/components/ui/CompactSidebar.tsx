"use client";
import { useId, useRef, type CSSProperties, type ReactNode } from "react";
import { DEFAULT_SIDEBAR, sidebarPreference } from "@/lib/workbench-layout";
import { useLayoutPreference } from "./useLayoutPreference";
import { IconButton } from "./IconButton";

export function CompactSidebar({ scope, title, sidebar, children }: { scope: string | null; title: string; sidebar: ReactNode; children: ReactNode }) {
  const [layout, setLayout] = useLayoutPreference(scope, title, DEFAULT_SIDEBAR, sidebarPreference);
  const id = useId();
  const drag = useRef<{ x: number; width: number } | null>(null);
  const resize = (width: number) => setLayout(previous => sidebarPreference({ ...previous, width }));
  return <div className="compact-sidebar-layout" data-collapsed={layout.collapsed} style={{ "--sidebar-width": `${layout.width}px` } as CSSProperties}>
    <aside className="compact-sidebar" aria-label={title}>
      <div className="compact-sidebar-header">
        {!layout.collapsed && <h2>{title}</h2>}
        {!layout.collapsed && <IconButton icon="reset" label={`Reset ${title.toLowerCase()} layout`} onClick={() => setLayout(DEFAULT_SIDEBAR)} />}
        <IconButton icon="sidebar" label={`${layout.collapsed ? "Expand" : "Collapse"} ${title.toLowerCase()}`} aria-expanded={!layout.collapsed} aria-controls={id} onClick={() => setLayout(previous => ({ ...previous, collapsed: !previous.collapsed }))} />
      </div>
      <div className="compact-sidebar-body" id={id} hidden={layout.collapsed}>{sidebar}</div>
    </aside>
    <div className="sidebar-resizer" role="separator" aria-label={`Resize ${title.toLowerCase()}`} aria-orientation="vertical" aria-valuemin={152} aria-valuemax={320} aria-valuenow={layout.width} tabIndex={layout.collapsed ? -1 : 0}
      onKeyDown={event => { const widths: Record<string, number> = { ArrowLeft: layout.width - 16, ArrowRight: layout.width + 16, Home: 152, End: 320 }; const width = widths[event.key]; if (width !== undefined) { event.preventDefault(); resize(width); } }}
      onPointerDown={event => { if (event.button !== 0) return; drag.current = { x: event.clientX, width: layout.width }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (drag.current) resize(drag.current.width + event.clientX - drag.current.x); }}
      onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} />
    <div className="compact-sidebar-main">{children}</div>
  </div>;
}
