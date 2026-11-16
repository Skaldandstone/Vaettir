"use client";

import { useId, useState } from "react";
import { filterComplianceOptions, type ComplianceOption } from "@/lib/compliance-catalog";

// Native checkbox/radio controls keep keyboard and touch selection equivalent.
// Filtering is a view only: it never removes selected values or makes API calls.
export function CompliancePicker({
  label, options, selected, onSelect, multiple = false, disabled = false,
}: {
  label: string;
  options: readonly ComplianceOption[];
  selected: readonly string[];
  onSelect: (id: string) => void;
  multiple?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const categories = [...new Set(options.map((option) => option.category))];
  const visible = filterComplianceOptions(options, query, category);
  const hiddenSelected = options.filter((option) => selected.includes(option.id) && !visible.includes(option));
  return (
    <fieldset disabled={disabled} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, minWidth: 0 }}>
      <legend>{label}</legend>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <label style={{ flex: "1 1 200px", minWidth: 0 }}>
          Search options
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, topic or version" style={{ width: "100%", boxSizing: "border-box" }} />
        </label>
        <label style={{ flex: "1 1 180px", minWidth: 0 }}>
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value)} style={{ width: "100%" }}>
            <option value="">All categories</option>
            {categories.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <p role="status" style={{ fontSize: 12, margin: "6px 0" }}>{visible.length} of {options.length} options · {selected.length} selected</p>
      {hiddenSelected.length > 0 && <p style={{ fontSize: 12 }}>Selected outside this filter: {hiddenSelected.map((option) => option.name).join(", ")}</p>}
      {(query || category) && <button type="button" className="btn-secondary" onClick={() => { setQuery(""); setCategory(""); }}>Clear filters</button>}
      {visible.length === 0 && <p>No matching options. Clear the filters to browse the full catalog.</p>}
      <div style={{ display: "grid", gap: 8, maxHeight: 300, overflowY: "auto", padding: 4, marginTop: 8 }}>
        {visible.map((option) => (
          <div key={option.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, overflowWrap: "anywhere" }}>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", minHeight: 28 }}>
              <input type={multiple ? "checkbox" : "radio"} name={id} checked={selected.includes(option.id)}
                onChange={() => onSelect(option.id)} style={{ marginTop: 4, flexShrink: 0 }} />
              <span><strong>{option.name}</strong>{option.version && <span> · {option.version}</span>}</span>
            </label>
            <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0 24px" }}>{option.summary}</p>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
