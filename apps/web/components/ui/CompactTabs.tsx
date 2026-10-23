"use client";

/** Controlled tab rail. Panels remain owned by the caller so switching is lossless. */
export function CompactTabs<T extends string>({ id, label, tabs, selected, onChange }: { id: string; label: string; tabs: readonly T[]; selected: T; onChange: (tab: T) => void }) {
  return <div className="compact-tabs" role="tablist" aria-label={label}>
    {tabs.map((tab, index) => <button type="button" className="compact-tab" role="tab" key={tab} id={`${id}-tab-${encodeURIComponent(tab)}`} aria-controls={`${id}-panel-${encodeURIComponent(tab)}`} aria-selected={selected === tab} tabIndex={selected === tab ? 0 : -1} onClick={() => onChange(tab)} onKeyDown={event => {
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : null;
      if (nextIndex === null) return;
      const next = tabs[nextIndex]; if (!next) return;
      event.preventDefault(); onChange(next); document.getElementById(`${id}-tab-${encodeURIComponent(next)}`)?.focus();
    }}>{tab}</button>)}
  </div>;
}
