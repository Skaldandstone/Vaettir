"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DialogFrame } from "./ui/DialogFrame";
import { detailsPanelWidth } from "../lib/workbench-navigation";

function layoutWidth() {
  return (
    document.documentElement.getBoundingClientRect().width || window.innerWidth
  );
}

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
  const [viewport, setViewport] = useState(() =>
    typeof window === "undefined" ? 1920 : layoutWidth(),
  );
  const [requestedWidth, setRequestedWidth] = useState(760);
  const width = detailsPanelWidth(requestedWidth, viewport);
  const resize = (value: number) =>
    setRequestedWidth(detailsPanelWidth(value, layoutWidth()));
  useEffect(() => {
    const updateViewport = () => setViewport(layoutWidth());
    // Scrollbars can change usable width without a window resize event.
    const observer = new ResizeObserver(updateViewport);
    observer.observe(document.documentElement);
    window.addEventListener("resize", updateViewport);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateViewport);
    };
  }, []);
  return (
    <DialogFrame
      open={open}
      onClose={onClose}
      className="drawer-panel"
      label={title}
      style={{ width: `min(${width}px, 100vw)`, maxWidth: "100vw" }}
    >
      <div
        className="drawer-resizer"
        role="separator"
        aria-label="Resize details panel"
        aria-orientation="vertical"
        aria-valuemin={Math.min(360, viewport)}
        aria-valuemax={viewport}
        aria-valuenow={width}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            resize(width + (event.key === "ArrowLeft" ? 40 : -40));
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            resize(event.key === "Home" ? 360 : viewport);
          }
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            resize(layoutWidth() - event.clientX);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      />
      <button
        className="btn-secondary drawer-close"
        onClick={onClose}
        type="button"
        aria-label="Close"
        data-dialog-initial-focus
      >
        ✕
      </button>
      {children}
    </DialogFrame>
  );
}
