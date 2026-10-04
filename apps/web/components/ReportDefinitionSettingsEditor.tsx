"use client";
import { trpcReact } from "@/lib/trpcReact";
import { REPORT_SECTIONS, readableMetric } from "@/lib/frozen-report";
import {
  REPORT_TEMPLATES,
  REPORT_TEMPLATE_IDS,
  applyReportTemplate,
  type ReportTemplateId,
} from "@/lib/report-templates";
import type { ReportDefinition } from "@vaettir/api/src/services/reportDefinitionSchema";
const fieldStyle = { width: "100%", boxSizing: "border-box" as const };

/** Explicit controlled edits only. Never initializes/resets a human draft from refetch. */
export function ReportDefinitionSettingsEditor({
  projectId,
  value,
  onChange,
  screen,
  onScreen,
  active,
}: {
  projectId: string;
  value: ReportDefinition;
  onChange: (value: ReportDefinition) => void;
  screen: number;
  onScreen: (screen: number) => void;
  active: boolean;
}) {
  const scopeOptions = trpcReact.reportSnapshots.scopeOptions.useQuery(
    { projectId },
    { enabled: active && screen === 2, staleTime: 0 },
  );
  const options =
    active &&
    screen === 2 &&
    !scopeOptions.error &&
    !scopeOptions.isFetching &&
    !scopeOptions.isPaused
      ? scopeOptions.data
      : null;
  function scope(
    key: "planId" | "runId" | "platform" | "environment" | "build",
    text: string,
  ) {
    const next = { ...value.executionScope };
    if (text.trim()) next[key] = text;
    else delete next[key];
    onChange({
      ...value,
      executionScope: Object.keys(next).length ? next : undefined,
    });
  }
  return (
    <section
      aria-label="Edit reusable report settings"
      style={{ display: "grid", gap: 12 }}
    >
      <p className="eyebrow">
        Settings screen {screen + 1} of 4 ·{" "}
        {
          [
            "Purpose / audience",
            "Metrics / time",
            "Recorded scope",
            "Commentary",
          ][screen]
        }
      </p>
      {screen === 0 && (
        <>
          <label>
            Report starter
            <select
              style={fieldStyle}
              value={value.templateId ?? "custom"}
              onChange={(event) => {
                if (event.target.value === "custom") {
                  const { templateId: _starter, ...rest } = value;
                  onChange(rest);
                } else
                  onChange(
                    applyReportTemplate(
                      value,
                      "Reusable report settings",
                      event.target.value as ReportTemplateId,
                    ).definition,
                  );
              }}
            >
              {REPORT_TEMPLATE_IDS.map((id) => (
                <option key={id} value={id}>
                  {REPORT_TEMPLATES[id].title}
                </option>
              ))}
              <option value="custom">Custom report</option>
            </select>
          </label>
          <p>
            Changing the starter prefills supported sections and audience. It
            preserves all written commentary and exact scope; it does not
            generate evidence.
          </p>
          <label>
            Audience
            <select
              style={fieldStyle}
              value={value.audience}
              onChange={(event) =>
                onChange({
                  ...value,
                  audience: event.target.value as ReportDefinition["audience"],
                })
              }
            >
              <option value="stakeholders">Stakeholders</option>
              <option value="engineering">Engineering</option>
              <option value="quality">Quality</option>
            </select>
          </label>
        </>
      )}
      {screen === 1 && (
        <>
          <fieldset>
            <legend>Metric sections</legend>
            {REPORT_SECTIONS.map((section) => (
              <label
                key={section}
                style={{ display: "flex", gap: 8, marginBlock: 8 }}
              >
                <input
                  type="checkbox"
                  checked={value.sections.includes(section)}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      sections: event.target.checked
                        ? [...value.sections, section]
                        : value.sections.filter((item) => item !== section),
                    })
                  }
                />
                {readableMetric(section)}
              </label>
            ))}
          </fieldset>
          <label>
            Rolling execution window
            <select
              style={fieldStyle}
              value={value.windowDays}
              onChange={(event) =>
                onChange({
                  ...value,
                  windowDays: Number(event.target.value) as 7 | 30 | 90,
                })
              }
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
          <details open={!!value.dateInterval}>
            <summary>Use exact UTC execution dates (optional)</summary>
            <p>
              Exact dates override the rolling window. Inclusive run-start
              dates, capped at a later capture time; not report capture dates.
            </p>
            <label>
              From (UTC)
              <input
                style={fieldStyle}
                type="date"
                value={value.dateInterval?.start ?? ""}
                onChange={(event) =>
                  onChange({
                    ...value,
                    dateInterval: {
                      start: event.target.value,
                      end: value.dateInterval?.end ?? "",
                    },
                  })
                }
              />
            </label>
            <label>
              Through (UTC)
              <input
                style={fieldStyle}
                type="date"
                value={value.dateInterval?.end ?? ""}
                onChange={(event) =>
                  onChange({
                    ...value,
                    dateInterval: {
                      start: value.dateInterval?.start ?? "",
                      end: event.target.value,
                    },
                  })
                }
              />
            </label>
            {value.dateInterval && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onChange({ ...value, dateInterval: undefined })}
              >
                Use rolling dates instead
              </button>
            )}
          </details>
        </>
      )}
      {screen === 2 && (
        <>
          <p>
            All filters are optional. A blank scope is project-wide; selected
            values match recorded run context, not current project labels.
            Saving settings does not capture or verify results.
          </p>
          <label>
            Plan (optional)
            <select
              style={fieldStyle}
              disabled={!options}
              value={value.executionScope?.planId ?? ""}
              onChange={(event) => scope("planId", event.target.value)}
            >
              <option value="">Any recorded plan</option>
              {value.executionScope?.planId &&
                !options?.plans.some(
                  (plan) => plan.id === value.executionScope?.planId,
                ) && (
                  <option value={value.executionScope.planId}>
                    Stored plan reference · {value.executionScope.planId}
                  </option>
                )}
              {options?.plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                  {plan.nameExcerpt ? "… (excerpt)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Run (optional)
            <select
              style={fieldStyle}
              disabled={!options}
              value={value.executionScope?.runId ?? ""}
              onChange={(event) => scope("runId", event.target.value)}
            >
              <option value="">Any recorded run</option>
              {value.executionScope?.runId &&
                !options?.runs.some(
                  (run) => run.id === value.executionScope?.runId,
                ) && (
                  <option value={value.executionScope.runId}>
                    Stored run reference · {value.executionScope.runId}
                  </option>
                )}
              {options?.runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.ciProvider}
                  {run.providerExcerpt ? "… (excerpt)" : ""} · {run.id}
                </option>
              ))}
            </select>
          </label>
          {scopeOptions.error && (
            <div role="alert">
              <p>
                Suggestions are unavailable. No cached choices are shown; your
                written scope is retained.
              </p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void scopeOptions.refetch()}
              >
                Retry scope suggestions
              </button>
            </div>
          )}
          {scopeOptions.isPaused && (
            <p role="status">
              Waiting to verify scope access. Written settings remain retained.
            </p>
          )}
          {scopeOptions.isFetching && (
            <p role="status">Loading bounded scope suggestions…</p>
          )}
          {(options?.plansLimited || options?.runsLimited) && (
            <p>
              Suggestions show at most 100 plans/recent runs. Use an exact
              native reference below for an older record; it is checked before a
              later capture.
            </p>
          )}
          <details>
            <summary>Exact recorded configuration filters (optional)</summary>
            {(["platform", "environment", "build"] as const).map((key) => (
              <label
                key={key}
                style={{ display: "grid", gap: 4, marginBlock: 10 }}
              >
                {readableMetric(key)}
                <input
                  style={fieldStyle}
                  value={value.executionScope?.[key] ?? ""}
                  maxLength={key === "environment" ? 2000 : 300}
                  onChange={(event) => scope(key, event.target.value)}
                />
              </label>
            ))}
            <label>
              Exact plan reference
              <input
                style={fieldStyle}
                maxLength={200}
                value={value.executionScope?.planId ?? ""}
                onChange={(event) => scope("planId", event.target.value)}
              />
            </label>
            <label>
              Exact run reference
              <input
                style={fieldStyle}
                maxLength={200}
                value={value.executionScope?.runId ?? ""}
                onChange={(event) => scope("runId", event.target.value)}
              />
            </label>
          </details>
          {value.executionScope && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onChange({ ...value, executionScope: undefined })}
            >
              Clear scope filters
            </button>
          )}
        </>
      )}
      {screen === 3 && (
        <>
          <p>
            These are authored notes, not computed findings. Sharing a
            definition also shares this text with current project members.
          </p>
          {(["summary", "risks", "nextActions"] as const).map((key) => (
            <label key={key} style={{ display: "grid", gap: 4 }}>
              {key === "nextActions"
                ? "Next actions (optional)"
                : `${readableMetric(key)} (optional)`}
              <textarea
                style={fieldStyle}
                rows={4}
                maxLength={1500}
                value={value[key]}
                onChange={(event) =>
                  onChange({ ...value, [key]: event.target.value })
                }
              />
            </label>
          ))}
        </>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {screen > 0 && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onScreen(screen - 1)}
          >
            Previous settings screen
          </button>
        )}
        {screen < 3 && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => onScreen(screen + 1)}
          >
            Next settings screen
          </button>
        )}
      </div>
    </section>
  );
}
