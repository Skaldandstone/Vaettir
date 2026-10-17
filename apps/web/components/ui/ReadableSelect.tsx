"use client";

import { useLayoutEffect, useRef, useState, type SelectHTMLAttributes } from "react";

/** Keeps native keyboard/mobile selection and reveals a value only if the
 * browser's one-line control cannot display it completely. */
export function ReadableSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const ref = useRef<HTMLSelectElement>(null);
  const [overflow, setOverflow] = useState("");
  useLayoutEffect(() => {
    const control = ref.current;
    if (!control) return;
    function measure() {
      if (!control) return;
      const text = control.selectedOptions[0]?.textContent ?? "";
      const style = getComputedStyle(control);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return;
      context.font = style.font;
      const available = control.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 28;
      setOverflow(available > 0 && context.measureText(text).width > available ? text : "");
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(control);
    control.addEventListener("change", measure);
    document.fonts?.ready.then(() => { if (control.isConnected) measure(); });
    return () => { observer.disconnect(); control.removeEventListener("change", measure); };
  }, [props.value, props.children]);
  return <span className="readable-select"><select {...props} ref={ref} />{overflow && <span className="readable-select-value" aria-hidden="true">{overflow}</span>}</span>;
}
