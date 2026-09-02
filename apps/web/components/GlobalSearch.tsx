"use client";

import { useEffect, useId, useRef, useState } from "react";
import { trpc, type RouterOutputs } from "../lib/trpc";
import { isCurrentSearch } from "../lib/usability";

type Results = RouterOutputs["search"]["search"];

export function GlobalSearch({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<{
    projectId: string;
    query: string;
    results: Results | null;
    error: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const resultsId = useId();
  const current = isCurrentSearch(response, projectId, query) ? response : null;
  const results = current?.results ?? null;

  useEffect(() => {
    const q = query.trim();
    let active = true;
    setResponse(null);
    if (!q) {
      return;
    }
    const t = setTimeout(() => {
      trpc.search.search
        .query({ projectId, query: q })
        .then((r) => {
          if (active)
            setResponse({ projectId, query: q, results: r, error: false });
        })
        .catch(() => {
          if (active)
            setResponse({ projectId, query: q, results: null, error: true });
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query, projectId, attempt]);

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      )
        setOpen(false);
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
    results &&
    (results.testCases.length > 0 ||
      results.testPlans.length > 0 ||
      results.requirements.length > 0);

  return (
    <div
      ref={containerRef}
      style={{ position: "relative" }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <input
        aria-label="Search this project"
        aria-controls={open && query.trim() ? resultsId : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => query.trim() && setOpen(true)}
        placeholder="Search this project…"
        style={{ width: "100%" }}
      />
      {open && query.trim() && (
        <div
          id={resultsId}
          role="region"
          aria-label="Project search results"
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
          {!results && !current?.error && (
            <p
              role="status"
              className="text-muted"
              style={{ fontSize: 13, margin: 4 }}
            >
              Searching…
            </p>
          )}
          {current?.error && (
            <div role="alert">
              <p>
                Search is unavailable. Check your connection or sign in again.
              </p>
              <button
                className="btn-secondary"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Retry search
              </button>
            </div>
          )}
          {results && !hasResults && (
            <p className="text-muted" style={{ fontSize: 13, margin: 4 }}>
              No matches for &quot;{query.trim()}&quot;.
            </p>
          )}
          {results && results.testCases.length > 0 && (
            <ResultGroup title="Test Cases">
              {results.testCases.map((tc) => (
                <a
                  key={tc.id}
                  href={`/projects/${projectId}/test-cases/${tc.id}`}
                  className="search-result"
                  onClick={() => setOpen(false)}
                >
                  {tc.title}{" "}
                  <span className="text-muted" style={{ fontSize: 11 }}>
                    [{tc.testType}]
                  </span>
                </a>
              ))}
            </ResultGroup>
          )}
          {results && results.testPlans.length > 0 && (
            <ResultGroup title="Test Plans">
              {results.testPlans.map((p) => (
                <a
                  key={p.id}
                  href={`/projects/${projectId}/test-plans/${p.id}`}
                  className="search-result"
                  onClick={() => setOpen(false)}
                >
                  {p.name}{" "}
                  <span className="text-muted" style={{ fontSize: 11 }}>
                    [{p.status}]
                  </span>
                </a>
              ))}
            </ResultGroup>
          )}
          {results && results.requirements.length > 0 && (
            <ResultGroup title="Requirements">
              {results.requirements.map((r) => (
                <a
                  key={r.id}
                  href={`/projects/${projectId}/requirements`}
                  className="search-result"
                  onClick={() => setOpen(false)}
                >
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

function ResultGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div className="eyebrow" style={{ fontSize: 10, margin: "4px 4px 2px" }}>
        {title}
      </div>
      {children}
    </div>
  );
}
