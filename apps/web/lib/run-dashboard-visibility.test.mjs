import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceCodeIncludes } from "./source-contract-tokens.mjs";
import { toggleRunDashboard } from "./run-dashboard-visibility.ts";
const source = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("first open is explicit; every later collapse preserves the visited instance", () => {
  let state = "UNOPENED";
  assert.equal(state !== "UNOPENED", false);
  for (let index = 0; index < 4; index++) {
    state = toggleRunDashboard(state);
    assert.equal(state, "OPEN");
    state = toggleRunDashboard(state);
    assert.equal(state, "COLLAPSED");
    assert.equal(state !== "UNOPENED", true);
  }
});

test("wrapper lazy mounts once, uses hide not unmount on collapse and has no data reader of its own", () => {
  const wrapper = source("../components/RunAllPagesDashboard.tsx");
  assert.match(wrapper, /useReducer\(toggleRunDashboard, "UNOPENED"/);
  assert.match(wrapper, /visibility !== "UNOPENED" && \(/);
  assert.match(wrapper, /id=\{contentId\} hidden=\{!opened\}/);
  assert.match(wrapper, /<RecordedExecutionTrend projectId=\{projectId\} active=\{opened\}/);
  assert.match(wrapper, /aria-expanded=\{opened\} aria-controls=\{contentId\}/);
  assert.doesNotMatch(wrapper, /useQuery|\.refetch\(|\.mutate\(|runsQuery|setApplied/);
  assert.match(wrapper, /up to 90 inclusive UTC days/);
  assert.match(wrapper, /stored run-start timestamps, not individual result observation times/);
  assert.match(wrapper, /not global manual planned cases, work left or release readiness/);
  assert.match(wrapper, /current history page/);
});

test("opening a retained reader never implicitly applies date or configuration drafts", () => {
  const trend = source("../components/RecordedExecutionTrend.tsx");
  assert.match(trend, /active = true/);
  assert.match(trend, /useState<RecordedExecutionTrendInput \| null>\(\s*null/);
  assert.match(trend, /enabled: active && !!applied && sameOrigin/);
  assert.equal([...trend.matchAll(/setApplied\(/g)].length, 1);
  assert.match(trend, /function applyScope\(event: FormEvent\)[\s\S]*?if \(!sameOrigin\) return[\s\S]*?setApplied\(parsed.data\)/);
  assert.doesNotMatch(trend, /if \(!active\)[\s\S]*?setDates\(|active.*setFilters\(/);
});

test("inactive reader denies cached evidence, closes portalled export and invalidates reviewed downloads", () => {
  const trend = source("../components/RecordedExecutionTrend.tsx");
  assert.match(trend, /const accessReady =\s*active &&/);
  assert.match(trend, /enabled: active, retry: false, staleTime: 0/);
  assert.match(trend, /organization.mine.useQuery\(undefined, \{\s*enabled: active/);
  assert.match(trend, /open=\{active && exportOpen\}/);
  assert.match(trend, /function download\(\) \{\s*if \(\s*!active \|\|/);
  assert.match(trend, /!latest.current.active \|\|/);
  assert.match(trend, /exportOpen: active && exportOpen/);
  assert.match(trend, /setReviewedEpoch\(-1\);\s*\}, \[\s*active,/);
  for (const gate of [/!project.isFetching/, /!project.isPaused/, /!organizations.error/, /!query.error/, /!query.isFetching/, /!query.isPaused/, /origin\?\.actorId === userId/, /query.data.requestKey === recordedExecutionTrendKey\(applied\)/]) assert.match(trend, gate);
});

test("run history pagination/refetch and empty pages do not unmount dashboard scope", () => {
  const page = source("../app/projects/[projectId]/test-runs/page.tsx");
  assert.ok(sourceCodeIncludes(page, '<RunHistoryDashboard key={projectId} projectId={projectId} organizationId={organizationId} onView={setOpenRunId} /> <RunAllPagesDashboard key={projectId} projectId={projectId} />'));
  assert.equal([...page.matchAll(/<RunAllPagesDashboard/g)].length, 1);
  assert.equal([...page.matchAll(/<RunHistoryDashboard/g)].length, 1);
  assert.doesNotMatch(page, /runsQuery|historyCursors|<RunOverview|testRuns\.list/);
  const dashboard = source("../components/RunHistoryDashboard.tsx");
  assert.match(dashboard, /useRunHistory\(projectId/);
  assert.match(dashboard, /Current run-history page/);
  assert.match(dashboard, /sameRenderedPage\(rendered, reader.current\(\)\)/);
});
