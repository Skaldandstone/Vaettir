"use client";
import { useId, type ReactNode } from "react";
import { Icon } from "./Workspace";

/** Keep editors mounted so collapsing never discards local media/draft state. */
export function ProcedureStep({ number, title, open, onToggle, tools, children }: { number: number; title: string; open: boolean; onToggle: () => void; tools?: ReactNode; children: ReactNode }) {
  const id = useId();
  return <div className="procedure-step" role="listitem">
    <div className="procedure-step-header">
      <button type="button" className="procedure-step-toggle" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <Icon name="chevron" size={14} /><span className="procedure-step-number">{String(number).padStart(2, "0")}</span>
        <span className="procedure-step-title" title={title}>{title || "Untitled step"}</span>
      </button>
      {tools && <div className="procedure-step-tools" hidden={!open}>{tools}</div>}
    </div>
    <div id={id} className="procedure-step-body" hidden={!open}>{children}</div>
  </div>;
}
