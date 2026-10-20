"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Escape clipping sidebars and keep tooltip copy inside the viewport. */
export function FloatingTooltip({ id, anchor, children }: { id: string; anchor: HTMLElement; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const update = () => {
      const rect = anchor.getBoundingClientRect(), tip = ref.current?.getBoundingClientRect();
      if (!tip) return;
      const left = Math.max(8, Math.min(innerWidth - tip.width - 8, rect.left + rect.width / 2 - tip.width / 2));
      const below = rect.bottom + 8;
      const top = Math.max(8, below + tip.height > innerHeight - 8 ? rect.top - tip.height - 8 : below);
      setPosition(previous => previous.left === left && previous.top === top ? previous : { left, top });
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(anchor); if (ref.current) observer.observe(ref.current);
    window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [anchor]);
  return createPortal(<span ref={ref} id={id} className="icon-action-tooltip floating-tooltip" role="tooltip" style={position}>{children}</span>, anchor.closest('[role="dialog"], dialog') ?? document.body);
}
