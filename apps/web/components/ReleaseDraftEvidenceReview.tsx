type ProposedPlan = Readonly<{ name: string; criteria: readonly string[] }>;

/** Display only. A retained request owns its exact proposed plan, including
 * absence; an editable local draft cannot replace an uncertain submitted body. */
export function ReleaseDraftEvidenceReview({
  retainedRequest,
  releaseName,
  planName,
  criteria,
}: {
  retainedRequest: Readonly<{ newPlan?: ProposedPlan }> | null;
  releaseName: string;
  planName: string;
  criteria: readonly string[];
}) {
  const proposedPlan = retainedRequest
    ? retainedRequest.newPlan
    : criteria.length
      ? {
          name:
            planName.trim() ||
            `${releaseName.trim()} quality plan`.slice(0, 200),
          criteria,
        }
      : undefined;

  return (
    <section aria-label="Proposed new quality plan" style={{ marginTop: 16 }}>
      <h4>New quality plan</h4>
      {proposedPlan ? (
        <>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            <strong>{proposedPlan.name}</strong>
          </p>
          <p className="text-muted">
            These acceptance criteria will start pending, not satisfied. This
            review does not record test results or approve release readiness.
          </p>
          {proposedPlan.criteria.length ? (
            <ol aria-label="Proposed pending acceptance criteria">
              {proposedPlan.criteria.map((criterion, index) => (
                <li
                  key={index}
                  style={{
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    marginBottom: 8,
                  }}
                >
                  {criterion}
                </li>
              ))}
            </ol>
          ) : (
            <p>No acceptance criteria are included in this proposed plan.</p>
          )}
        </>
      ) : (
        <p>
          No new quality plan is included. Existing selected plans will be
          linked without editing their criteria.
        </p>
      )}
    </section>
  );
}
