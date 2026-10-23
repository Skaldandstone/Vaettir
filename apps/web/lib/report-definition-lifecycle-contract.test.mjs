import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// Authored only. Source contracts do not establish rendered UX or runtime access.
const manager = readFileSync(
  new URL("../components/ReportDefinitionManager.tsx", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const builder = readFileSync(
  new URL("../components/ReportBuilder.tsx", import.meta.url),
  "utf8",
);
const editor = readFileSync(
  new URL("../components/ReportDefinitionSettingsEditor.tsx", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
test("settings edits use four focused native screens and never auto-rebase authored context", () => {
  assert.match(editor, /Settings screen \{screen \+ 1\} of 4/);
  assert.match(editor, /Metric sections/);
  assert.match(editor, /type="checkbox"/);
  assert.match(editor, /Next settings screen/);
  assert.match(editor, /No cached choices are shown/);
  assert.match(manager, /Keep edits and review against current version/);
  assert.match(manager, /version: reviewedVersion/);
  assert.match(manager, /reviewedVersion !== data.current.version/);
});
test("definition catalog/history are project-keyed and cache gated", () => {
  assert.match(manager, /Manager key=\{projectId\}/);
  assert.match(manager, /!query.error && !query.isFetching && !query.isPaused/);
  assert.match(manager, /query.data.includeArchived === archives/);
  assert.match(manager, /query.data.id === id && query.data.page === page/);
  assert.match(builder, /<ReportDefinitionManager projectId=\{projectId\}/);
});
test("review preserves unknown-outcome identity and separates acknowledgement from refresh", () => {
  assert.match(manager, /const request = pending \?\?/);
  assert.match(manager, /The outcome is unknown/);
  assert.match(manager, /definitiveRefusal &&/);
  assert.match(manager, /Discard refused review and refresh/);
  assert.match(manager, /The change was acknowledged as saved/);
  assert.match(manager, /await mutation.mutateAsync\(request\)/);
});
test("sharing and historical restoration have explicit bounded review rather than public grants", () => {
  assert.match(manager, /approveProjectSharing: sharing/);
  assert.match(manager, /No captured report is shared by this action/);
  assert.match(manager, /Nothing will be reconstructed/);
  assert.match(manager, /Complete stored settings and author commentary/);
  assert.match(manager, /Previous history/);
  assert.match(manager, /Next history/);
});
