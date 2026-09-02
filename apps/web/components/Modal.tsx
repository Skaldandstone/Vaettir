"use client";

import { useId } from "react";
import type { ReactNode } from "react";
import { DialogFrame } from "./ui/DialogFrame";

// The shared "pop-out module" pattern: quick, focused actions (create X,
// invite someone) that don't need a full page navigation and a round trip
// back. Not for anything with its own deep-linkable state -- a test case's
// full edit form stays a page, this is for short single-purpose forms.
export function Modal({
  open,
  onClose,
  title,
  children,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  dismissible?: boolean;
}) {
  const titleId = useId();
  return (
    <DialogFrame
      open={open}
      onClose={onClose}
      className="modal-panel"
      labelledBy={titleId}
      dismissible={dismissible}
    >
      <div className="modal-header">
        <h2 id={titleId} style={{ margin: 0 }}>
          {title}
        </h2>
        <button
          className="btn-secondary modal-close"
          onClick={onClose}
          type="button"
          aria-label="Close"
          disabled={!dismissible}
        >
          ✕
        </button>
      </div>
      {children}
    </DialogFrame>
  );
}
