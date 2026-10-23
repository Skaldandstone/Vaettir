import { controlGuidance, frameworkGuidance } from "@/lib/compliance-guidance";

export function ComplianceFrameworkGuidance({
  frameworkKey,
}: {
  frameworkKey: string;
}) {
  const guide = frameworkGuidance(frameworkKey);
  return (
    <section
      className="compliance-mapping-guide"
      aria-label="Framework mapping guide"
    >
      <h3>Choose evidence that demonstrates the requirement</h3>
      {guide && <p>{guide.summary}</p>}
      <p>
        Open a control’s mapping guide, choose a test that checks the stated
        behavior, then record its actual result and review period. A linked case
        shows coverage; it does not show that the test passed or that the
        requirement is satisfied.
      </p>
      <p>
        {guide?.review ??
          "Use your authoritative framework and its current version to confirm applicability, expected behavior and evidence with the responsible reviewer. Custom controls keep their saved wording; no regulatory interpretation is inferred from their code."}
      </p>
      {guide && (
        <p>
          <a href={guide.sourceUrl} target="_blank" rel="noopener noreferrer">
            Official source: {guide.name} ({guide.version})
          </a>
          <span className="text-muted">
            {" "}
            · Reference checked {guide.reviewedAt}. Examples below are
            engineering suggestions.
          </span>
        </p>
      )}
      {!guide && frameworkKey === "soc2" && (
        <p>
          <a
            href="https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022"
            target="_blank"
            rel="noopener noreferrer"
          >
            Official source: AICPA Trust Services Criteria
          </a>
          . Use the applicable criteria and examination scope with your auditor.
        </p>
      )}
    </section>
  );
}

export function ComplianceMappingGuidance({
  frameworkKey,
  control,
}: {
  frameworkKey: string;
  control: { code: string; title: string; description?: string | null };
}) {
  const guide = controlGuidance(frameworkKey, control.code, control.title);
  const framework = frameworkGuidance(frameworkKey);
  return (
    <details className="compliance-control-guide">
      <summary>{control.code}: what to map</summary>
      {guide ? (
        <>
          <p>
            <strong>What this covers: </strong>
            {guide.purpose ??
              control.description ??
              framework?.controls.find((c) => c.code === control.code)
                ?.description}
          </p>
          <p>
            <strong>Tests worth mapping: </strong>
            {guide.tests}
          </p>
          <p>
            <strong>Evidence to review: </strong>
            {guide.evidence} Include the tested version, scope, date and actual
            outcome.
          </p>
          <p>
            <strong>Human review: </strong>
            {framework?.review}
          </p>
          {framework && (
            <a
              href={framework.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Read the official source for {control.code}
            </a>
          )}
        </>
      ) : (
        <>
          <p>
            This control has no curated interpretation. Use its saved
            description and authoritative requirement to define the behavior and
            scope before mapping.
          </p>
          <p>
            <strong>Tests worth mapping: </strong>A case with explicit
            prerequisites, an action and an expected result that demonstrates
            this control. Include a refusal or failure case where relevant.
          </p>
          <p>
            <strong>Evidence to review: </strong>The executed version, scope,
            date, expected and actual result, deviations and responsible
            reviewer. Organizational or physical requirements also need evidence
            outside software tests.
          </p>
        </>
      )}
    </details>
  );
}
