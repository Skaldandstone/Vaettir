import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  PROJECT_NAVIGATION,
  navigationGroupIsActive,
  detailsPanelWidth,
} from "./workbench-navigation.ts";

test("all fifteen project destinations remain available exactly once", () => {
  const paths = PROJECT_NAVIGATION.flatMap((group) =>
    group.links.map((link) => link.path),
  );
  assert.equal(new Set(paths).size, 15);
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
      "/defect-map",
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
  assert.match(dialog, /textarea, summary, iframe, audio\[controls\], video\[controls\]/);
  const drawer = readFileSync(
    new URL("../components/Drawer.tsx", import.meta.url),
    "utf8",
  );
  assert.match(drawer, /data-dialog-initial-focus/);
  assert.match(drawer, /new ResizeObserver\(updateViewport\)/);
  assert.match(drawer, /observer.disconnect\(\)/);
});
