"use client";

import {useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode} from "react";
import {Icon, type IconName} from "./Workspace";
import { FloatingTooltip } from "./FloatingTooltip";

/** Secondary tools stay compact without losing their name or keyboard help. */
export function IconButton({label, icon, tooltip, className = "", onClick, onFocus, onBlur, onKeyDown, ...props}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label" | "title"> & {label: string; icon: IconName; tooltip?: ReactNode}) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelLeave = () => { if (leaveTimer.current !== null) { clearTimeout(leaveTimer.current); leaveTimer.current = null; } };
  useEffect(() => () => { if (leaveTimer.current !== null) clearTimeout(leaveTimer.current); }, []);
  const visible = !dismissed && (hovered || focused);
  return <span className="icon-action" onPointerEnter={event => {cancelLeave(); setAnchor(event.currentTarget); setHovered(true); setDismissed(false);}} onPointerLeave={() => {
    cancelLeave();
    // Allow diagonal pointer travel across the gap to a viewport-shifted tooltip.
    if (anchor) leaveTimer.current = setTimeout(() => { leaveTimer.current = null; setHovered(false); }, 150);
    else setHovered(false);
  }}>
    <button {...props} type={props.type ?? "button"} className={`ui-icon-button ${className}`} aria-label={label} aria-describedby={[props["aria-describedby"], visible ? id : undefined].filter(Boolean).join(" ") || undefined}
      onFocus={event => {setAnchor(event.currentTarget ?? null); setFocused(true); setDismissed(false); onFocus?.(event);}}
      onBlur={event => {setFocused(false); onBlur?.(event);}}
      onClick={event => {
        if (onClick || (props.type && props.type !== "button")) {
          setDismissed(true); onClick?.(event);
        } else {
          // Help-only controls need an explicit touch activation, not just hover.
          event.currentTarget?.focus();
          setAnchor(event.currentTarget ?? null); setFocused(true); setDismissed(false);
        }
      }}
      onKeyDown={event => {if (event.key === "Escape" && visible) {setDismissed(true); event.preventDefault(); event.stopPropagation();} onKeyDown?.(event);}}>
      <Icon name={icon}/>
    </button>
    {visible && (anchor ? <FloatingTooltip id={id} anchor={anchor} onDismiss={() => setDismissed(true)}>{tooltip ?? label}</FloatingTooltip> : <span id={id} className="icon-action-tooltip" role="tooltip">{tooltip ?? label}</span>)}
  </span>;
}
