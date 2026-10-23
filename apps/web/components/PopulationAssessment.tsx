"use client";
import { trpcReact } from "../lib/trpcReact";
export function PopulationAssessment({ projectId }: { projectId: string }) {
  const query = trpcReact.populationAssessment.current.useQuery({ projectId });
  if (query.error)
    return (
      <p role="alert">
        Could not assess project evidence: {query.error.message}
      </p>
    );
  if (!query.data) return <p role="status">Checking project evidence…</p>;
  const assessment = query.data;
  return (
    <section>
      <h1>Project evidence snapshot</h1>
      <p>
        {assessment.overall}. This read-only view identifies recorded work and
        the next useful steps.
      </p>
      <div
        className="population-assessment-stages"
        aria-label="Evidence by activity"
      >
        {assessment.stages.map((stage) => (
          <a
            className={`population-stage ${stage.state}`}
            href={`/projects/${projectId}/${stage.path}`}
            key={stage.key}
          >
            <span>
              {stage.state === "recorded"
                ? "● Recorded"
                : stage.state === "review"
                  ? "▲ Needs review"
                  : "○ Not recorded"}
            </span>
            <h2>{stage.label}</h2>
            <p>{stage.summary}</p>
          </a>
        ))}
      </div>
      <h2>Recommended next actions</h2>
      {assessment.actions.length ? (
        <ol>
          {assessment.actions.map((action) => (
            <li key={action.key}>
              <a href={`/projects/${projectId}/${action.path}`}>
                {action.label}
              </a>
              <p>{action.reason}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p>
          Evidence exists for these activities. Review release-specific coverage
          and risks before making a readiness decision.
        </p>
      )}
      <details>
        <summary>Evidence limits and recorded release phases</summary>
        <ul>
          {assessment.uncertainty.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        {assessment.releasePhases.map((release) => (
          <p key={release.id}>
            <a href={`/projects/${projectId}/releases/${release.id}`}>
              {release.name}
            </a>
            : {release.status.toLowerCase()} · {release.basis}
          </p>
        ))}
        <p>
          {assessment.documents} approved documents. Snapshot read at{" "}
          {new Date(assessment.observedAt).toLocaleString()}. Latest ten
          releases shown. The 30-day run review threshold is an operational
          prompt, not a compliance rule.
        </p>
      </details>
    </section>
  );
}
