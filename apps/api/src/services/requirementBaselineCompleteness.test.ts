// Source-authored only. These contracts do not establish SQL/runtime acceptance.
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("./requirementBaselines.ts", import.meta.url), "utf8");

test("all active direct-link metadata is bounded and checked before joined labels", () => {
  const metadataStart = source.indexOf("const directMetadata =");
  const labelsStart = source.indexOf("const linked =");
  assert.ok(metadataStart > 0 && metadataStart < labelsStart);
  const metadata = source.slice(metadataStart, labelsStart);
  for (const contract of ["LEFT JOIN \"TestCase\" c", 'c.id=l."caseId" AND c."projectId"=l."projectId"',
    "c.id IS NULL", 'l."providerOrigin" IS DISTINCT FROM \'vaettir\'', 'l."nativeId" IS DISTINCT FROM ${requirementId}',
    'l."removedAt" IS NULL', "l.provider='requirement' AND l.kind='requirement'", "ORDER BY l.id LIMIT 41",
    "directMetadata.length > 40", "directMetadata.some(link => link.invalid)", 'code: "PRECONDITION_FAILED"'])
    assert.ok(metadata.includes(contract), contract);
  assert.ok(!metadata.includes("c.title"));
  assert.ok(!metadata.includes('c."displayId"'));
  assert.ok(!metadata.includes('SELECT l."providerOrigin"'));
});

test("retained successful replay returns before current direct-link snapshot or fingerprint comparison", () => {
  const capture = source.slice(source.indexOf("export async function captureRequirementBaseline"));
  const replayReturn = capture.indexOf("return { ...receipt, requirementId: captured.requirementId");
  const newSnapshot = capture.indexOf("const current = await currentSnapshot");
  assert.ok(replayReturn > 0 && replayReturn < newSnapshot);
  assert.ok(capture.slice(0, replayReturn).includes("captured.fingerprint !== input.currentFingerprint"));
  assert.ok(!capture.slice(0, replayReturn).includes("await currentSnapshot"));
});
