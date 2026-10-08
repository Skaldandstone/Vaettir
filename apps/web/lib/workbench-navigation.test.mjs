import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  PROJECT_NAVIGATION,
  navigationGroupIsActive,
  detailsPanelWidth,
  projectNavigationForExperience,
  hiddenActiveProjectLinks,
} from "./workbench-navigation.ts";

test("all twenty project destinations remain available exactly once", () => {
  const paths = PROJECT_NAVIGATION.flatMap((group) =>
    group.links.map((link) => link.path),
  );
  assert.equal(new Set(paths).size, 20);
  assert.deepEqual(
    [...paths].sort(),
    [
      "",
      "/test-cases",
      "/test-strategy",
      "/test-plans",
      "/test-runs",
      "/reports",
      "/requirements",
      "/requirement-baselines",
      "/requirement-coverage",
      "/recorded-run-comparison",
      "/execution-trends",
      "/defect-map",
      "/quality-risks",
      "/compliance",
      "/audit-log",
      "/reverse-engineer",
      "/live-app-generation",
      "/production-signals",
      "/import",
      "/releases",
    ].sort(),
  );
});
test("explicit optional tools hide only selected navigation, while old and invalid settings retain legacy", () => {
  const legacy = projectNavigationForExperience(["SOFTWARE"]);
  const paths = (groups) =>
    groups.flatMap((group) => group.links.map((link) => link.path));
  assert.deepEqual(
    projectNavigationForExperience(["SOFTWARE"], ["Unknown"]),
    legacy,
  );
  assert.deepEqual(
    projectNavigationForExperience(["SOFTWARE"], ["Compliance", "Compliance"]),
    legacy,
  );
  const core = projectNavigationForExperience(["SOFTWARE"], []);
  for (const path of [
    "",
    "/test-cases",
    "/test-plans",
    "/test-runs",
    "/reports",
    "/releases",
    "/quality-risks",
    "/requirements",
    "/import",
    "/audit-log",
  ])
    assert.ok(paths(core).includes(path));
  for (const path of [
    "/compliance",
    "/production-signals",
    "/reverse-engineer",
    "/live-app-generation",
    "/execution-trends",
    "/recorded-run-comparison",
    "/defect-map",
    "/test-strategy",
  ])
    assert.ok(!paths(core).includes(path));
  const some = projectNavigationForExperience(
    ["GAME"],
    ["Compliance", "AdvancedAnalytics"],
  );
  assert.ok(paths(some).includes("/compliance"));
  assert.ok(paths(some).includes("/execution-trends"));
  assert.deepEqual(
    hiddenActiveProjectLinks(
      "/projects/one/compliance/history",
      "one",
      core,
    ).map((link) => link.path),
    ["/compliance"],
  );
  assert.deepEqual(
    hiddenActiveProjectLinks("/projects/two/compliance", "one", core),
    [],
  );
  assert.deepEqual(
    hiddenActiveProjectLinks("/projects/one/compliance-extra", "one", core),
    [],
  );
});
test("quality choices tailor disclosure but never remove destinations or grant capabilities", () => {
  const generic = PROJECT_NAVIGATION.flatMap((group) =>
    group.links.map((link) => link.path),
  ).sort();
  for (const offerings of [
    null,
    [],
    ["SOFTWARE"],
    ["GAME"],
    ["HARDWARE"],
    ["HIL"],
    ["CLINICAL"],
    ["FOOD_SAFETY", "SOFTWARE"],
    ["UNKNOWN"],
  ]) {
    const groups = projectNavigationForExperience(offerings);
    assert.deepEqual(
      groups.flatMap((group) => group.links.map((link) => link.path)).sort(),
      generic,
    );
    assert.equal(
      new Set(groups.flatMap((group) => group.links.map((link) => link.path)))
        .size,
      20,
    );
    assert.ok(groups[0].links.some((link) => link.path === "/releases"));
    assert.equal(groups[0].collapsible, false);
    assert.equal(groups[2].collapsible, true);
  }
  assert.equal(
    projectNavigationForExperience(["CLINICAL"])[1].label,
    "Protocols & evidence",
  );
  assert.equal(
    projectNavigationForExperience(["CLINICAL"])[1].collapsible,
    false,
  );
  assert.equal(projectNavigationForExperience(["HIL"])[1].collapsible, false);
  assert.equal(
    projectNavigationForExperience(["SOFTWARE"])[1].collapsible,
    true,
  );
  assert.deepEqual(
    projectNavigationForExperience(["UNKNOWN"]),
    projectNavigationForExperience(null),
  );
  assert.deepEqual(
    projectNavigationForExperience(["HIL", "UNKNOWN"]),
    projectNavigationForExperience(null),
  );
  assert.deepEqual(
    projectNavigationForExperience(["HIL", "HIL"]),
    projectNavigationForExperience(null),
  );
});
test("sidebar uses authorized project experience and hides scoped tools when project access fails", () => {
  const sidebar = readFileSync(
    new URL("../components/Sidebar.tsx", import.meta.url),
    "utf8",
  );
  assert.match(sidebar, /project\.experience\.useQuery/);
  assert.match(
    sidebar,
    /enabled: projectQuery\.isSuccess && !projectQuery\.isError/,
  );
  assert.match(
    sidebar,
    /projectQuery\.isSuccess && !projectQuery\.isError \? \(?\s*<nav/,
  );
  assert.match(
    sidebar,
    /experienceQuery\.isSuccess && !experienceQuery\.isError/,
  );
});
test("secondary navigation reveals the group for direct or nested routes", () => {
  const evidence = PROJECT_NAVIGATION[1].links;
  assert.equal(
    navigationGroupIsActive("/projects/one/compliance/review", "one", evidence),
    true,
  );
  assert.equal(
    navigationGroupIsActive("/projects/one/compliance-extra", "one", evidence),
    false,
  );
  assert.equal(
    navigationGroupIsActive("/projects/two/compliance", "one", evidence),
    false,
  );
  assert.equal(
    navigationGroupIsActive(
      "/projects/one",
      "one",
      PROJECT_NAVIGATION[0].links,
    ),
    true,
  );
});
test("panel width and accessible range agree across desktop and small viewports", () => {
  assert.equal(detailsPanelWidth(760, 390), 390);
  assert.equal(detailsPanelWidth(760, 320), 320);
  assert.equal(detailsPanelWidth(760, 1440), 760);
  assert.equal(detailsPanelWidth(100, 1440), 360);
  assert.equal(detailsPanelWidth(1600, 1440), 1440);
});

test("native dialogs retain modality, nested ownership and explicit focus endpoints", () => {
  const dialog = readFileSync(
    new URL("../components/ui/DialogFrame.tsx", import.meta.url),
    "utf8",
  );
  assert.match(dialog, /dialog.showModal\(\)/);
  assert.match(dialog, /opener.focus\(\{ preventScroll: true \}\)/);
  assert.match(
    dialog,
    /event.target.closest\("dialog"\) !== event.currentTarget/,
  );
  assert.match(dialog, /event.key === "Tab"/);
  assert.match(dialog, /document.activeElement === first/);
  assert.match(dialog, /document.activeElement === last/);
  assert.match(dialog, /last.focus\(\)/);
  assert.match(dialog, /first.focus\(\)/);
  assert.match(dialog, /control.matches\(":disabled"\)/);
  assert.match(dialog, /control.getClientRects\(\).length > 0/);
  assert.match(
    dialog,
    /textarea, summary, iframe, audio\[controls\], video\[controls\]/,
  );
  const drawer = readFileSync(
    new URL("../components/Drawer.tsx", import.meta.url),
    "utf8",
  );
  assert.match(drawer, /data-dialog-initial-focus/);
  assert.match(drawer, /new ResizeObserver\(updateViewport\)/);
  assert.match(drawer, /observer.disconnect\(\)/);
});
