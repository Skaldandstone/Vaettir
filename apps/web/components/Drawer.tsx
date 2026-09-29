"use client";

import { useState, type ReactNode } from "react";
import { DialogFrame } from "./ui/DialogFrame";

// The other half of the "pop-out module, not a page hop" pattern (see
// Modal.tsx) -- a slide-over panel from the right edge for viewing/lightly
// editing something without leaving the list you came from. This is how
// TestRail and Qase's own test case repositories work: clicking a case
// opens a side panel, not a full page navigation. Use Modal for short,
// single-purpose forms (create X); use Drawer for "look at / triage this
// existing thing while keeping the list visible."
export function Drawer({
  open,
  onClose,
  children,
  title = "Details",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}) {
  const [width, setWidth] = useState(760);
  const resize = (value: number) => setWidth(Math.max(360, Math.min(window.innerWidth, value)));
  return (
    <DialogFrame
      open={open}
      onClose={onClose}
      className="drawer-panel"
      label={title}
      style={{ width: `min(${width}px, 100vw)` }}
    >
      <div className="drawer-resizer" role="separator" aria-label="Resize details panel"
        aria-orientation="vertical" aria-valuemin={360} aria-valuemax={typeof window === "undefined" ? 1920 : window.innerWidth}
        aria-valuenow={width} tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault(); resize(width + (event.key === "ArrowLeft" ? 40 : -40));
          }
        }}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(window.innerWidth - event.clientX); }}
        onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      />
      <button
        className="btn-secondary drawer-close"
        onClick={onClose}
        type="button"
        aria-label="Close"
      >
        ✕
      </button>
      {children}
    </DialogFrame>
  );
}
