import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const panel = readFileSync(
  new URL("../components/DefectMapPanel.tsx", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../app/projects/[projectId]/defect-map/page.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../components/DefectMap.module.css", import.meta.url),
  "utf8",
);
const chip = readFileSync(
  new URL("../components/EvidenceLinkChip.tsx", import.meta.url),
  "utf8",
);

test("defect map distinguishes volume, suggestions and confirmation from runtime resolution", () => {
  assert.match(panel, /Occurrence volume is not unique users/);
  assert.match(panel, /Human-confirmed task links/);
  assert.match(panel, /Suggested matches/);
  assert.match(
    panel,
    /A closed task is not evidence that a runtime defect is fixed/,
  );
  assert.match(panel, /Imported task status/);
});

test("cluster browsing preserves accessible disclosure, filters and viewer boundaries", () => {
  assert.match(panel, /aria-label="Selected cluster details"/);
  assert.match(panel, /aria-pressed=\{cluster.id === selected\?\.id\}/);
  assert.match(panel, /Find a cluster/);
  assert.match(panel, /Reset filters/);
  assert.match(
    panel,
    /canEdit[\s\S]*?onReview\(selected.id, link.taskKey, "confirmed"\)/,
  );
  assert.match(
    css,
    /grid-template-columns:\s*minmax\(0, 0.9fr\) minmax\(0, 1.1fr\)/,
  );
  assert.match(
    css,
    /@media \(max-width: 700px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  );
  assert.match(
    route,
    /<DefectMapPanel key=\{projectId\} projectId=\{projectId\}/,
  );
  assert.match(panel, /decodeURIComponent\(window.location.hash.slice\(1\)\)/);
  assert.match(
    panel,
    /<CoveredTestCasesPanel[\s\S]*?provider: "defect",[\s\S]*?providerOrigin: "vaettir",[\s\S]*?nativeId: selected.id,[\s\S]*?kind: "defect"/,
  );
});

test("import requires metadata permission before read and a bounded normalized preview before approval", () => {
  assert.match(
    panel,
    /if \(!freshAccess \|\| busy \|\| !permission \|\| receipt\) return/,
  );
  assert.match(
    panel,
    /new TextEncoder\(\)\.encode\(json\)\.byteLength > 150_000/,
  );
  assert.match(panel, /defectBatchSchema.parse\(JSON.parse\(json\)\)/);
  assert.match(
    panel,
    /if \(!freshAccess \|\| !permission \|\| busy \|\| receipt \|\| !file\)[\s\S]*?file.size > 150_000[\s\S]*?await file.text\(\)/,
  );
  assert.match(
    panel,
    /batch: draft.batch,[\s\S]*?version: draft.preview.version,[\s\S]*?previewHash: draft.preview.previewHash,[\s\S]*?requestId: crypto.randomUUID\(\),[\s\S]*?approveMetadataRead: true,[\s\S]*?approveImport: true/,
  );
  assert.match(panel, /No AI · 0\s+credits/);
  assert.match(panel, /Native provider exports must be normalized/);
});

test("ambiguous writes retain exact receipt through permission errors and cached query failures", () => {
  assert.match(panel, /ambiguous: attempt.ambiguous \|\| !known/);
  assert.match(panel, /rejected: known && !attempt.ambiguous/);
  assert.match(panel, /receipt.rejected && !receipt.ambiguous/);
  assert.match(panel, /receipt.ambiguous \|\|[\s\S]*?!receipt.rejected/);
  assert.match(panel, /await importMutation.mutateAsync\(attempt.input\)/);
  assert.match(panel, /await linkMutation.mutateAsync\(attempt.input\)/);
  assert.match(panel, /onClick=\{\(\) => void sendWrite\(receipt\)\}/);
  assert.match(panel, /\{snapshot.data && \(/);
  assert.match(panel, /disabled=\{!freshAccess \|\| busy \|\| !!receipt\}/);
});

test("task chips retain safe section anchors and separate confirmed/suggested references", () => {
  assert.match(chip, /url.protocol === "https:"/);
  assert.match(chip, /!url.username &&\s*!url.password &&\s*!url.search/);
  assert.doesNotMatch(chip, /!url.hash/);
  assert.match(chip, /rel="noopener noreferrer"/);
  assert.match(chip, /if \(onReview\)/);
  assert.match(chip, /status === "suggested" \? "dashed" : "solid"/);
  for (const provider of ["jira", "linear", "asana"])
    assert.match(chip, new RegExp(`name === "${provider}"`));
  assert.match(
    panel,
    /<EvidenceLinkChip[\s\S]*?status=\{status\}[\s\S]*?onReview=\{onReview\}/,
  );
});
