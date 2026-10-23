"use client";
import { useId, useState } from "react";
import { ReadableSelect } from "./ui/ReadableSelect";

type Element = { id: string; label: string; kind: string; from?: string; to?: string };
/** Draw only extracted explicit relations, never imported SVG markup or inferred edges. */
export function ArchitectureMap({ elements, reviewedLinks }: { elements: readonly Element[]; reviewedLinks: ReadonlyMap<string, number> }) {
  const [selection, setSelection] = useState("");
  const markerId = useId().replace(/:/g, "");
  const components = elements.filter(element => element.kind === "COMPONENT");
  const selected = components.find(element => element.id === selection) ?? components[0];
  if (!selected) return <p className="text-muted">This document contains labels but no explicit component relationships. Review the extracted text below.</p>;
  const edges = elements.filter(element => element.kind === "INTERACTION" && (element.from === selected.id || element.to === selected.id));
  const neighborIds = new Set(edges.flatMap(edge => [edge.from, edge.to]).filter((id): id is string => !!id && id !== selected.id));
  const neighbors = components.filter(element => neighborIds.has(element.id));
  const height = Math.max(180, neighbors.length * 100 + 60);
  const centerY = height / 2;
  const yFor = (id: string) => id === selected.id ? centerY : 70 + neighbors.findIndex(node => node.id === id) * 100;
  const validEdges = edges.filter(edge => (edge.from === selected.id || neighbors.some(node => node.id === edge.from)) && (edge.to === selected.id || neighbors.some(node => node.id === edge.to)));
  const node = (element: Element, x: number, y: number) => <g key={element.id} role="img" aria-label={`${element.label}: ${reviewedLinks.get(element.id) ?? 0} confirmed test links`}>
    <title>{element.label}</title><rect x={x} y={y - 28} width={210} height={56} rx={5} fill="var(--panel)" stroke={element.id === selected.id ? "var(--focus)" : "var(--control-line)"}/>
    <text x={x + 12} y={y - 4} fill="var(--fg)" fontSize={13}>{element.label.length > 27 ? `${element.label.slice(0, 26)}…` : element.label}</text>
    <text x={x + 12} y={y + 15} fill="var(--muted)" fontSize={11}>{reviewedLinks.get(element.id) ?? 0} confirmed test links</text>
  </g>;
  return <figure className="architecture-map">
    <div className="architecture-map-toolbar"><label>Focus component<ReadableSelect value={selected.id} onChange={event => setSelection(event.target.value)}>{components.map(element => <option key={element.id} value={element.id}>{element.label}</option>)}</ReadableSelect></label><span>{components.length} components · {validEdges.length} explicit relations in this view</span></div>
    <div className="architecture-map-canvas" tabIndex={0} role="region" aria-label="Extracted architecture connections">
      <svg viewBox={`0 0 720 ${height}`} style={{ width: "100%", minWidth: 600, height }} role="img" aria-label={`Explicit relationships for ${selected.label}. Confirmed links are traceability, not passing tests.`}>
        <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="var(--link)"/></marker></defs>
        {validEdges.map(edge => { const outgoing = edge.from === selected.id; const startY = yFor(edge.from!), endY = yFor(edge.to!); return <path key={edge.id} d={edge.from === edge.to ? `M150 ${centerY - 28} C100 ${centerY - 90},250 ${centerY - 90},200 ${centerY - 28}` : outgoing ? `M250 ${startY} C350 ${startY},350 ${endY},440 ${endY}` : `M440 ${startY} C350 ${startY},350 ${endY},250 ${endY}`} fill="none" stroke="var(--link)" strokeWidth="1.5" markerEnd={`url(#${markerId})`}><title>{edge.label}</title></path>; })}
        {node(selected, 40, centerY)}{neighbors.map(element => node(element, 440, yFor(element.id)))}
      </svg>
    </div>
    <figcaption>{validEdges.length ? "Extracted relationships only. Confirmed test links do not imply execution or coverage." : "No explicit relationships for this component were extracted. No connections have been inferred."}</figcaption>
  </figure>;
}
