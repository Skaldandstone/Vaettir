"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { canConfirmNamedAction } from "../lib/usability";

// Mount this only while a target is selected, so its confirmation cannot be reused.
export function ConfirmAction({
  title,
  children,
  requiredText,
  confirmLabel,
  onConfirm,
  onClose,
  busy = false,
  error,
}: {
  title: string;
  children: ReactNode;
  requiredText?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [confirmation, setConfirmation] = useState("");
  return (
    <Modal open title={title} onClose={onClose} dismissible={!busy}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canConfirmNamedAction(requiredText, confirmation, busy))
            onConfirm();
        }}
      >
        <div className="confirmation-description">{children}</div>
        {requiredText !== undefined && (
          <label className="confirmation-label">
            Type the project name to confirm<strong>{requiredText}</strong>
            <input
              aria-label="Project name confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        <div className="review-actions">
          <button
            data-dialog-initial-focus
            className="btn-secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="btn-danger"
            type="submit"
            disabled={!canConfirmNamedAction(requiredText, confirmation, busy)}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
