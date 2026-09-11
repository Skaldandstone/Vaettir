"use client";

import { useState } from "react";
import Link from "next/link";
import { Drawer } from "./Drawer";
import { ConfirmAction } from "./ConfirmAction";
import {
  EmptyState,
  Icon,
  MetricCard,
  PageHeading,
  StatusPill,
  type StatusTone,
} from "./ui/Workspace";
import {
  exampleCases,
  exampleReviews,
  filterExampleCases,
  type ExampleCase,
} from "../lib/workspace-example";

const views = [
  "Overview",
  "Test library",
  "AI reviews",
  "Release readiness",
] as const;
type View = (typeof views)[number];
const tones: Record<ExampleCase["status"], StatusTone> = {
  Passed: "success",
  Failed: "danger",
  "Not run": "neutral",
};

export function WorkspacePreview() {
  const [view, setView] = useState<View>("Overview");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All results");
  const [selected, setSelected] = useState<ExampleCase | null>(null);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const cases = filterExampleCases(query, status);
  const pending = exampleReviews.filter((item) => !reviewed.includes(item.id));
  const passed = exampleCases.filter((item) => item.status === "Passed").length;
  const failed = exampleCases.filter((item) => item.status === "Failed").length;
  const notRun = exampleCases.length - passed - failed;

  function changeView(next: View) {
    setView(next);
    setSelected(null);
    setNotice("");
  }

  return (
    <div className="quality-workspace">
      {resetOpen && (
        <ConfirmAction
          title="Reset the example workspace?"
          confirmLabel="Reset example"
          onClose={() => setResetOpen(false)}
          onConfirm={() => {
            setReviewed([]);
            setQuery("");
            setStatus("All results");
            setSelected(null);
            setNotice("Example workspace reset. No project data was changed.");
            setResetOpen(false);
          }}
        >
          <p>
            This restores the sample reviews and clears your filters. Your real
            workspace is not affected.
          </p>
        </ConfirmAction>
      )}
      <div className="preview-notice">
        <span>
          <Icon name="grid" size={15} />
          <strong>Example workspace</strong>
          <span className="preview-notice-detail">
            Explore with sample data. Nothing here affects your projects.
          </span>
        </span>
        <div className="preview-actions">
          <button
            className="text-button"
            type="button"
            onClick={() => setResetOpen(true)}
          >
            Reset example
          </button>
          <Link href="/dashboard">
            Open your workspace <Icon name="arrow" size={14} />
          </Link>
        </div>
      </div>
      <PageHeading
        eyebrow="WORKSPACE / NORTHSTAR WEB"
        title={view === "Overview" ? "Quality overview" : view}
        description="From the first test to the final sign-off. Keep the whole picture in view."
        actions={
          <Link className="btn-primary" href="/projects">
            Open projects <Icon name="arrow" size={16} />
          </Link>
        }
      />
      <div
        className="workspace-view-nav"
        role="group"
        aria-label="Example workspace views"
      >
        {views.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={view === name}
            className={`view-button${view === name ? " selected" : ""}`}
            onClick={() => changeView(name)}
          >
            {name}
            {name === "AI reviews" && (
              <span className="small-count">{pending.length}</span>
            )}
          </button>
        ))}
      </div>

      {view === "Overview" && (
        <>
          <div className="metric-grid">
            <MetricCard
              icon="cases"
              label="Test cases"
              value={exampleCases.length}
              note="Across 3 test suites"
            />
            <MetricCard
              icon="check"
              label="Passing"
              value={passed}
              note="Latest example execution"
              tone="success"
            />
            <MetricCard
              icon="spark"
              label="Awaiting review"
              value={pending.length}
              note="AI suggestions need a human"
              tone="info"
            />
            <MetricCard
              icon="alert"
              label="Release blockers"
              value={1}
              note="CI integration needs attention"
              tone="danger"
            />
          </div>
          <div className="overview-grid">
            <section
              className="workspace-panel release-summary"
              aria-labelledby="release-summary-title"
            >
              <div className="panel-heading">
                <span className="section-label">
                  <Icon name="release" />
                  CURRENT RELEASE
                </span>
                <StatusPill tone="warning">At risk</StatusPill>
              </div>
              <div className="release-summary-title">
                <div>
                  <h2 id="release-summary-title">
                    Northstar Web <span className="version-label">v1.8</span>
                  </h2>
                  <p className="text-muted">
                    Regression suite · Example release
                  </p>
                </div>
                <span className="branch-label">
                  <Icon name="branch" size={14} /> release/1.8
                </span>
              </div>
              <div className="execution-summary">
                <strong>
                  {passed}
                  <span> of {exampleCases.length} cases passing</span>
                </strong>
                <span>{Math.round((passed / exampleCases.length) * 100)}%</span>
              </div>
              <div
                className="result-bar"
                role="img"
                aria-label={`${passed} passed, ${failed} failed, ${notRun} not run`}
              >
                <span className="result-pass" style={{ flex: passed }} />
                <span className="result-fail" style={{ flex: failed }} />
                <span className="result-pending" style={{ flex: notRun }} />
              </div>
              <div className="result-legend">
                <span>
                  <i className="result-pass" />
                  {passed} Passed
                </span>
                <span>
                  <i className="result-fail" />
                  {failed} Failed
                </span>
                <span>
                  <i className="result-pending" />
                  {notRun} Not run
                </span>
              </div>
              <div className="release-callout">
                <Icon name="alert" size={17} />
                <p>
                  <strong>One required case is failing.</strong>
                  <br />
                  Review the CI mapping before signing off this release.
                </p>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => changeView("Release readiness")}
                >
                  View gates <Icon name="arrow" size={15} />
                </button>
              </div>
            </section>
            <section
              className="workspace-panel attention-panel"
              aria-labelledby="attention-title"
            >
              <div className="panel-heading">
                <h2 id="attention-title">Needs your attention</h2>
                <span className="small-count">{pending.length + 1}</span>
              </div>
              <button
                className="attention-row"
                type="button"
                onClick={() => {
                  changeView("Test library");
                  setQuery("");
                  setStatus("Failed");
                }}
              >
                <span className="attention-icon status-danger">
                  <Icon name="alert" />
                </span>
                <span>
                  <strong>Investigate a failing test</strong>
                  <small>CI integration · 1 case</small>
                </span>
                <Icon name="arrow" size={16} />
              </button>
              <button
                className="attention-row"
                type="button"
                onClick={() => changeView("AI reviews")}
              >
                <span className="attention-icon status-info">
                  <Icon name="spark" />
                </span>
                <span>
                  <strong>Review AI-generated cases</strong>
                  <small>
                    {pending.length} suggestions awaiting a decision
                  </small>
                </span>
                <Icon name="arrow" size={16} />
              </button>
              <div className="attention-note">
                <Icon name="check" size={16} />
                <p>
                  Human review stays in the loop.
                  <br />
                  <span>Suggestions never approve themselves.</span>
                </p>
              </div>
            </section>
          </div>
        </>
      )}

      {(view === "Overview" || view === "Test library") && (
        <section
          className="workspace-panel case-library"
          aria-labelledby="case-library-title"
        >
          <div className="panel-heading">
            <div>
              <h2 id="case-library-title">Test library</h2>
              <p className="panel-description">
                Readable cases. Traceable results.
              </p>
            </div>
            <span className="quiet-label">
              {exampleCases.length} sample cases
            </span>
          </div>
          <div className="table-toolbar">
            <label className="search-field">
              <Icon name="search" size={17} />
              <input
                aria-label="Search sample test cases"
                placeholder="Search cases, IDs, or suites…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelected(null);
                }}
              />
            </label>
            <label className="filter-field">
              <span>Result</span>
              <select
                aria-label="Filter sample cases by result"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setSelected(null);
                }}
              >
                <option>All results</option>
                <option>Passed</option>
                <option>Failed</option>
                <option>Not run</option>
              </select>
            </label>
          </div>
          <div className="case-master-detail">
            <div className="table-scroll">
              <table className="workspace-table">
                <caption className="sr-only">
                  Example test cases and their latest results. Select a case to
                  inspect its scenario.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Test case</th>
                    <th scope="col">Suite</th>
                    <th scope="col">Latest result</th>
                    <th scope="col">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((item) => (
                    <tr
                      key={item.id}
                      className={selected?.id === item.id ? "selected-row" : ""}
                    >
                      <td>
                        <button
                          className="case-title-button"
                          type="button"
                          aria-expanded={selected?.id === item.id}
                          aria-haspopup="dialog"
                          onClick={() =>
                            setSelected(selected?.id === item.id ? null : item)
                          }
                        >
                          <span className="case-id">{item.id}</span>
                          <strong>{item.title}</strong>
                        </button>
                      </td>
                      <td>
                        <span className="suite-label">{item.suite}</span>
                      </td>
                      <td>
                        <StatusPill tone={tones[item.status]}>
                          {item.status}
                        </StatusPill>
                      </td>
                      <td>
                        <span
                          className="avatar"
                          aria-label={item.owner}
                          title={item.owner}
                        >
                          {item.initials}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cases.length === 0 && (
                <EmptyState
                  title="No matching cases"
                  action={
                    <button
                      className="btn-secondary"
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setStatus("All results");
                      }}
                    >
                      Clear filters
                    </button>
                  }
                >
                  Try another search or reset the result filter.
                </EmptyState>
              )}
            </div>
            {selected && (
              <Drawer
                open
                onClose={() => setSelected(null)}
                title={`Details for ${selected.id}`}
              >
                <div className="sample-case-details">
                  <div className="panel-heading">
                    <span className="case-id">{selected.id} / SAMPLE CASE</span>
                  </div>
                  <h3>{selected.title}</h3>
                  <StatusPill tone={tones[selected.status]}>
                    {selected.status}
                  </StatusPill>
                  <dl className="scenario">
                    <dt>Given</dt>
                    <dd>{selected.given}</dd>
                    <dt>When</dt>
                    <dd>{selected.when}</dd>
                    <dt>Then</dt>
                    <dd>{selected.then}</dd>
                  </dl>
                  <div className="detail-meta">
                    <span>
                      Priority<strong>{selected.priority}</strong>
                    </span>
                    <span>
                      Owner<strong>{selected.owner}</strong>
                    </span>
                  </div>
                  <p className="detail-footnote">
                    Example only. Open your workspace to manage real test cases.
                  </p>
                </div>
              </Drawer>
            )}
          </div>
          <div className="table-footer">
            <span aria-live="polite">
              Showing {cases.length} of {exampleCases.length} sample cases
            </span>
            <span>
              Select a case to inspect its scenario{" "}
              <Icon name="arrow" size={14} />
            </span>
          </div>
        </section>
      )}

      {view === "AI reviews" && (
        <section className="workspace-panel review-workspace">
          <div className="panel-heading">
            <div>
              <h2>Human review, by design</h2>
              <p className="panel-description">
                Read the scenario before accepting a suggestion. These actions
                only change this preview.
              </p>
            </div>
            <StatusPill tone="info">{pending.length} pending</StatusPill>
          </div>
          <p className="review-notice" role="status">
            {notice}
          </p>
          {pending.map((item) => (
            <article key={item.id} className="review-card">
              <div>
                <span className="section-label">
                  <Icon name="spark" size={15} /> AI SUGGESTION · SAMPLE
                </span>
                <h3>{item.title}</h3>
                <p className="source-label">
                  <Icon name="branch" size={14} />
                  {item.source}
                </p>
              </div>
              <dl className="scenario">
                <dt>Given</dt>
                <dd>{item.given}</dd>
                <dt>When</dt>
                <dd>{item.when}</dd>
                <dt>Then</dt>
                <dd>{item.then}</dd>
              </dl>
              <div className="review-actions">
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => {
                    setReviewed([...reviewed, item.id]);
                    setNotice(
                      "Sample suggestion dismissed. No project data was changed.",
                    );
                  }}
                >
                  Dismiss example
                </button>
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => {
                    setReviewed([...reviewed, item.id]);
                    setNotice(
                      "Sample suggestion accepted in this preview only. No project data was changed.",
                    );
                  }}
                >
                  <Icon name="check" size={16} />
                  Accept example
                </button>
              </div>
            </article>
          ))}
          {pending.length === 0 && (
            <EmptyState
              title="You’re all caught up"
              action={
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => {
                    setReviewed([]);
                    setNotice("Example suggestions reset.");
                  }}
                >
                  Reset example reviews
                </button>
              }
            >
              Both sample suggestions have been reviewed. No cases were created.
            </EmptyState>
          )}
        </section>
      )}

      {view === "Release readiness" && (
        <section className="workspace-panel gate-workspace">
          <div className="panel-heading">
            <div>
              <span className="section-label">NORTHSTAR WEB / V1.8</span>
              <h2>Make the release decision with evidence.</h2>
              <p className="panel-description">
                Illustrative gates for this example release, not a live
                readiness calculation.
              </p>
            </div>
            <StatusPill tone="warning">At risk</StatusPill>
          </div>
          {[
            {
              name: "Required tests",
              detail: "One failing CI mapping case needs investigation.",
              tone: "danger" as const,
              state: "Blocked",
              action: "Inspect case",
            },
            {
              name: "Case review",
              detail: `${pending.length} AI suggestions still need human review.`,
              tone: pending.length
                ? ("warning" as const)
                : ("success" as const),
              state: pending.length ? "Pending" : "Reviewed",
              action: "Open reviews",
            },
            {
              name: "Compliance sign-off",
              detail:
                "An authorized reviewer must record the release decision.",
              tone: "neutral" as const,
              state: "Not signed off",
              action: null,
            },
          ].map((gate) => (
            <div className="gate-row" key={gate.name}>
              <span className={`gate-icon status-${gate.tone}`}>
                <Icon
                  name={
                    gate.tone === "success"
                      ? "check"
                      : gate.tone === "danger"
                        ? "alert"
                        : "clock"
                  }
                />
              </span>
              <div>
                <h3>{gate.name}</h3>
                <p>{gate.detail}</p>
              </div>
              <StatusPill tone={gate.tone}>{gate.state}</StatusPill>
              {gate.action && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    changeView(
                      gate.action === "Inspect case"
                        ? "Test library"
                        : "AI reviews",
                    );
                    if (gate.action === "Inspect case") {
                      setQuery("");
                      setStatus("Failed");
                    }
                  }}
                >
                  {gate.action}
                  <Icon name="arrow" size={15} />
                </button>
              )}
            </div>
          ))}
          <div className="gate-footer">
            <Icon name="book" />
            <p>
              No sign-off is available in the example workspace. Real release
              decisions use your project permissions and recorded evidence.
            </p>
            <Link href="/dashboard" className="btn-secondary">
              Open workspace
            </Link>
          </div>
        </section>
      )}
      <div className="workspace-bottom-note">
        <span>
          <Icon name="branch" size={14} />
          Test cases → CI evidence → Release decisions
        </span>
        <Link href="/beta-guide">
          Getting started <Icon name="arrow" size={14} />
        </Link>
      </div>
    </div>
  );
}
