"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

// The other half of the "pop-out module, not a page hop" pattern (see
// Modal.tsx) -- a slide-over panel from the right edge for viewing/lightly
// editing something without leaving the list you came from. This is how
// TestRail and Qase's own test case repositories work: clicking a case
// opens a side panel, not a full page navigation. Use Modal for short,
// single-purpose forms (create X); use Drawer for "look at / triage this
// existing thing while keeping the list visible."
export function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="btn-secondary drawer-close" onClick={onClose} type="button" aria-label="Close">
          ✕
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
