"use client";

import { useEffect, useRef, type ReactNode, type CSSProperties } from "react";
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
  style,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className: string;
  label?: string;
  labelledBy?: string;
  dismissible?: boolean;
  style?: CSSProperties;
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
      style={style}
      className={`native-dialog ${className}`}
      aria-label={label}
      aria-labelledby={labelledBy}
      onKeyDown={(event) => {
        // Portalled nested dialogs bubble through React ancestors. Only the
        // dialog which owns the focused control may handle its navigation.
        if (
          event.target instanceof Element &&
          event.target.closest("dialog") !== event.currentTarget
        )
          return;
        if (event.key === "Tab") {
          // Native modality keeps the background inert. Explicit endpoint
          // wrapping also keeps focus in the dialog across browser variants.
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button, [href], input, select, textarea, summary, iframe, audio[controls], video[controls], [tabindex]",
            ),
          ).filter(
            (control) =>
              control.tabIndex >= 0 &&
              !control.matches(":disabled") &&
              control.getClientRects().length > 0 &&
              !control.closest('[hidden], [inert], [aria-hidden="true"]'),
          );
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (!first || !last) {
            event.preventDefault();
            event.currentTarget.focus();
          } else if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === event.currentTarget)
          ) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
          return;
        }
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
