"use client";

import {useId, useState, type ButtonHTMLAttributes} from "react";
import {Icon, type IconName} from "./Workspace";

/** Secondary tools stay compact without losing their name or keyboard help. */
export function IconButton({label, icon, className = "", onFocus, onBlur, onKeyDown, ...props}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label" | "title"> & {label: string; icon: IconName}) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const visible = !dismissed && (hovered || focused);
  return <span className="icon-action" onPointerEnter={() => {setHovered(true); setDismissed(false);}} onPointerLeave={() => setHovered(false)}>
    <button {...props} type={props.type ?? "button"} className={`ui-icon-button ${className}`} aria-label={label} aria-describedby={[props["aria-describedby"], visible ? id : undefined].filter(Boolean).join(" ") || undefined}
      onFocus={event => {setFocused(true); setDismissed(false); onFocus?.(event);}}
      onBlur={event => {setFocused(false); onBlur?.(event);}}
      onKeyDown={event => {if (event.key === "Escape" && visible) {setDismissed(true); event.preventDefault(); event.stopPropagation();} onKeyDown?.(event);}}>
      <Icon name={icon}/>
    </button>
    {visible && <span id={id} className="icon-action-tooltip" role="tooltip">{label}</span>}
  </span>;
}
