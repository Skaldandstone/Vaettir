"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Native modality keeps background controls inert and contains keyboard focus. */
export function DialogFrame({
  open,
  onClose,
  children,
  className,
  label,
  labelledBy,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className: string;
  label?: string;
  labelledBy?: string;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]")?.focus();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={ref}
      className={`native-dialog ${className}`}
      aria-label={label}
      aria-labelledby={labelledBy}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // Keep Escape local to the topmost dialog, including embedded browsers.
        event.preventDefault();
        event.stopPropagation();
        if (dismissible) onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(event) => {
        if (!dismissible || event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
