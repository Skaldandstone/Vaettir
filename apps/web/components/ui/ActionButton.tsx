"use client";

import {
  Children,
  isValidElement,
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { FloatingTooltip } from "./FloatingTooltip";

/** Short visible labels with an explicit, complete action description. */
function description(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number")
        return String(child);
      if (
        !isValidElement<{
          children?: ReactNode;
          "aria-hidden"?: boolean | "true" | "false";
        }>(child) ||
        child.props["aria-hidden"] === true ||
        child.props["aria-hidden"] === "true"
      )
        return "";
      return description(child.props.children);
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
export const ActionButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { tooltip: ReactNode }
>(function ActionButton(
  {
    tooltip,
    title,
    onPointerEnter,
    onPointerLeave,
    onFocus,
    onBlur,
    onKeyDown,
    onClick,
    children,
    ...props
  },
  ref,
) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [hovered, setHovered] = useState(false),
    [focused, setFocused] = useState(false),
    [dismissed, setDismissed] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function enter() {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
    setHovered(true);
  }
  function leave() {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      setHovered(false);
      leaveTimer.current = null;
    }, 150);
  }
  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    },
    [],
  );
  const visible = Boolean(anchor && !dismissed && (hovered || focused));
  const label = description(children),
    help = description(tooltip);
  // Speech control must be able to address the visible label as well as its
  // complete description. Preserve an explicitly supplied accessible name.
  const accessibleName = help
    .toLocaleLowerCase()
    .includes(label.toLocaleLowerCase())
    ? help
    : `${label}: ${help}`;
  return (
    <>
      <button
        {...props}
        ref={ref}
        aria-label={props["aria-label"] ?? (accessibleName || undefined)}
        aria-describedby={
          [props["aria-describedby"], visible ? id : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
        onPointerEnter={(event) => {
          setAnchor(event.currentTarget);
          enter();
          setDismissed(false);
          onPointerEnter?.(event);
        }}
        onPointerLeave={(event) => {
          leave();
          onPointerLeave?.(event);
        }}
        onFocus={(event) => {
          setAnchor(event.currentTarget);
          setFocused(true);
          setDismissed(false);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && visible) {
            setDismissed(true);
            event.preventDefault();
            event.stopPropagation();
          }
          onKeyDown?.(event);
        }}
        onClick={(event) => {
          setDismissed(true);
          onClick?.(event);
        }}
      >
        {children}
      </button>
      {visible && anchor && (
        <FloatingTooltip
          id={id}
          anchor={anchor}
          onDismiss={() => setDismissed(true)}
          onPointerEnter={enter}
          onPointerLeave={leave}
        >
          {title ?? tooltip}
        </FloatingTooltip>
      )}
    </>
  );
});
