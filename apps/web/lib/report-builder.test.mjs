import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reportMetricRows } from "./frozen-report.ts";
const read = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\s+/g, " ");
const builder = read("../components/ReportBuilder.tsx"),
  frozen = read("../components/FrozenReport.tsx"),
  route = read(
    "../app/projects/[projectId]/reports/snapshots/[snapshotId]/page.tsx",
  );
test("report creation requires fresh editor membership and explicit access recovery retains pending requests", () => {
  assert.match(
    builder,
    /project.isFetching[\s\S]*organizations.isFetching[\s\S]*!!project.error[\s\S]*!!organizations.error[\s\S]*!canEditProject/,
  );
  assert.match(builder, /Retry workspace access/);
  assert.match(builder, /project.refetch\(\), organizations.refetch\(\)/);
  assert.match(builder, /if \(readOnly \|\| busy \|\| saveRequest\) return/);
  assert.match(
    builder,
    /if \(readOnly \|\| busy \|\| request \|\| current\) return/,
  );
});
test("capture and reusable definition retry frozen exact payloads after uncertain writes", () => {
  assert.match(
    builder,
    /const input = request \?\? \{[\s\S]*requestId: crypto.randomUUID\(\)/,
  );
  assert.match(
    builder,
    /setRequest\(input\)[\s\S]*preview.mutateAsync\(input\)/,
  );
  assert.match(
    builder,
    /const input = saveRequest \?\? \{[\s\S]*requestId: crypto.randomUUID\(\)/,
  );
  assert.match(
    builder,
    /setSaveRequest\(input\)[\s\S]*save.mutateAsync\(input\)/,
  );
  assert.match(
    builder,
    /if \(request \|\| saveRequest\) \{\s*setOpen\(true\); return;/,
  );
  assert.match(builder, /Resume pending report/);
  assert.match(builder, /Retry same definition save/);
  assert.match(builder, /disabled=\{\s*busy \|\| readOnly \|\| !!saveRequest/);
});
test("approval pins the frozen private preview and selected sections use no providers or credits", () => {
  assert.match(
    builder,
    /approve.mutateAsync\(\{\s*projectId,\s*previewId: current.id,\s*approveSharing: true,?\s*\}\)/,
  );
  assert.match(
    builder,
    /Project-wide scope[\s\S]*does not apply the case-query filters/,
  );
  assert.match(
    builder,
    /Capture costs 0 AI credits. No source or external provider data is fetched/,
  );
  assert.match(builder, /definition.sections.includes\(section\)/);
  assert.match(
    builder,
    /sections: event.target.checked[\s\S]*definition.sections.filter/,
  );
  assert.match(builder, /maxLength=\{80\}/);
  assert.match(builder, /maxLength=\{1500\}/);
});
test("report presentation never invents optional notes, selection, evidence or live updates", () => {
  assert.match(frozen, /Not provided by report author/);
  assert.match(
    frozen,
    /REPORT_SECTIONS.filter\(\s*\(?section\)? => report.definition.sections.includes\(section\),?\s*\)/,
  );
  assert.match(frozen, /Evidence boundaries and missing data/);
  assert.match(frozen, /This snapshot never updates itself/);
  assert.match(frozen, /renderFrozenReportHtml\(report\)/);
  assert.match(frozen, /review recipients before sharing/);
});
test("workspace snapshot route gates sharing and exports to approved accessible reports", () => {
  assert.match(route, /snapshot.data && !snapshot.error/);
  assert.match(route, /payload.state === "approved"/);
  assert.match(route, /Recipients must already have access to this workspace/);
  assert.match(route, /Workspace access is required/);
  assert.match(route, /snapshot.refetch\(\)/);
});

test("recorded automation pace uses comparable identities and a meaningful interval, not added cases or executed savings", () => {
  const report = {
    state: "approved",
    projectName: "Synthetic",
    title: "Comparable recorded labels",
    asOf: "2026-10-02T20:00:00Z",
    windowStart: "2026-09-02T20:00:00Z",
    definition: {
      audience: "quality",
      windowDays: 30,
      sections: ["automation"],
      summary: "",
      risks: "",
      nextActions: "",
    },
    inventory: {
      active: 20,
      riskAssessed: 0,
      flaky: 0,
      priority: [],
      automation: [],
    },
    execution: {
      runs: 0,
      results: 0,
      outcomes: [],
      distinctCases: 0,
      highPriorityCases: 0,
      highPriorityExecuted: 0,
    },
    traceability: {
      requirements: 0,
      coveredRequirements: 0,
      casesWithLinks: 0,
      links: 0,
    },
    defects: null,
    cohort: [],
    limitations: ["Recorded labels, not actual automation execution"],
    automationChange: {
      baselineId: "synthetic-baseline",
      baselineAsOf: "2026-09-25T20:00:00Z",
      commonCases: 4,
      becameAutomated: 3,
      noLongerAutomated: 1,
      addedCases: 13,
      removedCases: 6,
      elapsedDays: 7,
    },
  };
  const pace = (candidate) =>
    reportMetricRows(candidate).find(
      (row) => row.label === "Net recorded automation change per 7 days",
    );
  assert.equal(pace(report).value, "2.00");
  assert.match(
    pace(report).note,
    /not executed automation or productivity savings/,
  );
  assert.equal(
    pace({
      ...report,
      automationChange: { ...report.automationChange, elapsedDays: 14 },
    }).value,
    "1.00",
  );
  assert.equal(
    pace({
      ...report,
      automationChange: { ...report.automationChange, elapsedDays: 0.5 },
    }).value,
    "Comparison interval too short or no comparable cases",
  );
  assert.equal(
    pace({
      ...report,
      automationChange: { ...report.automationChange, commonCases: 0 },
    }).value,
    "Comparison interval too short or no comparable cases",
  );
});
