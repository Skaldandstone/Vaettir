"use client";

import { useEffect, useRef, useState } from "react";
import { trpc, type RouterOutputs } from "../lib/trpc";

type Results = RouterOutputs["search"]["search"];

export function GlobalSearch({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      trpc.search.search
        .query({ projectId, query: q })
        .then((r) => {
          setResults(r);
          setOpen(true);
        })
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [query, projectId]);

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  const hasResults =
    results && (results.testCases.length > 0 || results.testPlans.length > 0 || results.requirements.length > 0);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => query.trim() && setOpen(true)}
        placeholder="Search this project…"
        style={{ width: "100%" }}
      />
      {open && query.trim() && (
        <div
          className="panel"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 50,
            maxHeight: 360,
            overflowY: "auto",
            padding: 8,
          }}
        >
          {!results && <p className="text-muted" style={{ fontSize: 13, margin: 4 }}>Searching…</p>}
          {results && !hasResults && (
            <p className="text-muted" style={{ fontSize: 13, margin: 4 }}>
              No matches for &quot;{query.trim()}&quot;.
            </p>
          )}
          {results && results.testCases.length > 0 && (
            <ResultGroup title="Test Cases">
              {results.testCases.map((tc) => (
                <a key={tc.id} href={`/projects/${projectId}/test-cases/${tc.id}`} className="search-result" onClick={() => setOpen(false)}>
                  {tc.title} <span className="text-muted" style={{ fontSize: 11 }}>[{tc.testType}]</span>
                </a>
              ))}
            </ResultGroup>
          )}
          {results && results.testPlans.length > 0 && (
            <ResultGroup title="Test Plans">
              {results.testPlans.map((p) => (
                <a key={p.id} href={`/projects/${projectId}/test-plans/${p.id}`} className="search-result" onClick={() => setOpen(false)}>
                  {p.name} <span className="text-muted" style={{ fontSize: 11 }}>[{p.status}]</span>
                </a>
              ))}
            </ResultGroup>
          )}
          {results && results.requirements.length > 0 && (
            <ResultGroup title="Requirements">
              {results.requirements.map((r) => (
                <a key={r.id} href={`/projects/${projectId}/requirements`} className="search-result" onClick={() => setOpen(false)}>
                  {r.title}
                </a>
              ))}
            </ResultGroup>
          )}
        </div>
      )}
    </div>
  );
}

function ResultGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div className="eyebrow" style={{ fontSize: 10, margin: "4px 4px 2px" }}>
        {title}
      </div>
      {children}
    </div>
  );
}
