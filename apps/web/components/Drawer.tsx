"use client";

import type { ReactNode } from "react";
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
  return (
    <DialogFrame
      open={open}
      onClose={onClose}
      className="drawer-panel"
      label={title}
    >
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
