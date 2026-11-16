"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { FloatingTooltip } from "./FloatingTooltip";

function linkText(value: ReactNode): string {
  return Children.toArray(value).map(child => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (!isValidElement<{ children?: ReactNode; "aria-hidden"?: boolean | "true" | "false" }>(child)
      || child.props["aria-hidden"] === true || child.props["aria-hidden"] === "true") return "";
    return linkText(child.props.children);
  }).join(" ").replace(/\s+/g, " ").trim();
}

function HelpTarget({ element, ...props }: HTMLAttributes<HTMLElement> & {
  element: ReactElement<HTMLAttributes<HTMLElement>>;
}) {
  return cloneElement(element, props);
}

// Add help to the original link rather than replacing navigation with a click
// handler. Its href, ref, target, download, router props and default action stay.
export function ActionHelp({ children, tooltip }: {
  children: ReactElement<HTMLAttributes<HTMLElement>>;
  tooltip: ReactNode;
}) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false), [dismissed, setDismissed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function enter() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHovered(true);
  }
  function leave() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setHovered(false); timer.current = null; }, 150);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const props = children.props, visible = Boolean(anchor && !dismissed && (hovered || focused));
  const label = linkText(props.children), help = linkText(tooltip);
  const name = help.toLocaleLowerCase().includes(label.toLocaleLowerCase()) ? help : `${label}: ${help}`;
  return <>
    <HelpTarget element={children}
      aria-label={props["aria-label"] ?? (name || undefined)}
      aria-describedby={[props["aria-describedby"], visible ? id : null].filter(Boolean).join(" ") || undefined}
      onPointerEnter={event => { setAnchor(event.currentTarget); enter(); setDismissed(false); props.onPointerEnter?.(event); }}
      onPointerLeave={event => { leave(); props.onPointerLeave?.(event); }}
      onFocus={event => { setAnchor(event.currentTarget); setFocused(true); setDismissed(false); props.onFocus?.(event); }}
      onBlur={event => { setFocused(false); props.onBlur?.(event); }}
      onKeyDown={event => {
        if (event.key === "Escape" && visible) { setDismissed(true); event.preventDefault(); event.stopPropagation(); }
        props.onKeyDown?.(event);
      }}
      onClick={event => { setDismissed(true); props.onClick?.(event); }}
    />
    {visible && anchor && <FloatingTooltip id={id} anchor={anchor} onDismiss={() => setDismissed(true)} onPointerEnter={enter} onPointerLeave={leave}>{tooltip}</FloatingTooltip>}
  </>;
}
