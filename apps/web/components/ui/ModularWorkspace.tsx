"use client";
import { useId, useState, type ReactNode } from "react";
import { panelPreference } from "@/lib/workbench-layout";
import { moveListItem } from "@/lib/move-list-item";
import { IconButton } from "./IconButton";
import { useLayoutPreference } from "./useLayoutPreference";

export type WorkspacePanel = { id: string; title: string; content: ReactNode; wide?: boolean };
export function ModularWorkspace({ scope, name, panels }: { scope: string | null; name: string; panels: WorkspacePanel[] }) {
  const ids = panels.map(panel => panel.id);
  const defaults = panelPreference(null, ids, panels.filter(panel => panel.wide).map(panel => panel.id));
  const [saved, setLayout] = useLayoutPreference(scope, name, defaults, raw => panelPreference(raw, ids, defaults.wide));
  const layout = panelPreference(saved, ids, defaults.wide);
  const [editing, setEditing] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const prefix = useId();
  const toggle = (field: "collapsed" | "wide", id: string) => setLayout({ ...layout, [field]: layout[field].includes(id) ? layout[field].filter(value => value !== id) : [...layout[field], id] });
  return <section aria-label={name}>
    <div className="modular-toolbar">
      {editing && <><span className="text-muted">Your layout only</span><IconButton icon="reset" label="Reset layout" onClick={() => { setLayout(defaults); setAnnouncement("Default layout restored."); }} /></>}
      <button className="btn-secondary" type="button" aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? "Done" : "Edit layout"}</button>
    </div>
    <div className="modular-grid" data-editing={editing}>
      {layout.order.map((id, index) => { const panel = panels.find(item => item.id === id)!; const collapsed = layout.collapsed.includes(id); const bodyId = `${prefix}-${id}`;
        return <section className="layout-panel" key={id} data-wide={layout.wide.includes(id)} aria-labelledby={`${bodyId}-title`}>
          <div className="layout-panel-header"><h2 className="layout-panel-title" id={`${bodyId}-title`}>{panel.title}</h2>
            {editing && <>
              <IconButton icon="up" label={`Move ${panel.title} earlier`} disabled={index === 0} onClick={() => { setLayout({ ...layout, order: moveListItem(layout.order, index, index - 1) }); setAnnouncement(`${panel.title} moved to position ${index}.`); }} />
              <IconButton icon="down" label={`Move ${panel.title} later`} disabled={index === layout.order.length - 1} onClick={() => { setLayout({ ...layout, order: moveListItem(layout.order, index, index + 1) }); setAnnouncement(`${panel.title} moved to position ${index + 2}.`); }} />
              <IconButton icon="expand" label={`${layout.wide.includes(id) ? "Half" : "Full"} width: ${panel.title}`} aria-pressed={layout.wide.includes(id)} onClick={() => toggle("wide", id)} />
            </>}
            <IconButton icon={collapsed ? "expand" : "collapse"} label={`${collapsed ? "Expand" : "Collapse"} ${panel.title}`} aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => toggle("collapsed", id)} />
          </div><div className="layout-panel-body" id={bodyId} hidden={collapsed}>{panel.content}</div>
        </section>;
      })}
    </div><span role="status" className="sr-only">{announcement}</span>
  </section>;
}
