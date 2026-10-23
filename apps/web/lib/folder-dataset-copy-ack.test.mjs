// SOURCE ONLY. Authoring does not establish browser or runtime acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifiedFolderDatasetAck } from "./folder-dataset-copy-ack.ts";
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const source = {
  sourceCaseId: "source-a",
  sourceDatasetId: "dataset-old",
  sourceRevisionHash: "a".repeat(64),
  contentHash: "b".repeat(64),
  parameterCount: 2,
  rowCount: 2,
  rows: [
    { rowIndex: 0, name: "Same name" },
    { rowIndex: 1, name: "Same name" },
  ],
};
const projectId = "synthetic-project",
  hash = createHash("sha256")
    .update(canonical({ projectId, datasets: [source] }))
    .digest("hex");
const input = {
  projectId,
  copyParameterDatasets: true,
  expectedDatasetHash: hash,
  expectedDatasets: [source],
};
const result = {
  copyParameterDatasets: true,
  datasetReviewHash: hash,
  copies: [
    { sourceId: "source-a", caseId: "copy-a", displayId: "synthetic-02" },
  ],
  copiedDatasets: [
    {
      ...source,
      caseId: "copy-a",
      displayId: "synthetic-02",
      datasetId: "dataset-new",
    },
  ],
};
test("cryptographically acknowledges exact fresh dataset+row-index mappings and never invents row IDs", async () => {
  assert.equal(await verifiedFolderDatasetAck(input, result), true);
  assert.equal(
    result.copiedDatasets[0].rows[0].name,
    result.copiedDatasets[0].rows[1].name,
  );
  assert.notEqual(
    result.copiedDatasets[0].rows[0].rowIndex,
    result.copiedDatasets[0].rows[1].rowIndex,
  );
});
test("retains UUID on wrong hash/scope, missing/truncated rows, duplicate/source-pointing identities and unexpected mapping", async () => {
  const d = result.copiedDatasets[0];
  for (const bad of [
    { ...result, copyParameterDatasets: false },
    { ...result, copyParameterDatasets: "unverified" },
    { ...result, copies: null },
    { ...result, copiedDatasets: {} },
    { ...result, copiedDatasets: [null] },
    { ...result, datasetReviewHash: "c".repeat(64) },
    { ...result, copiedDatasets: [] },
    { ...result, copiedDatasets: [d, d] },
    { ...result, copies: [result.copies[0], result.copies[0]] },
    { ...result, copies: [{ ...result.copies[0], caseId: "source-a" }] },
    ...[
      { ...d, datasetId: "dataset-old" },
      { ...d, rows: d.rows.slice(0, 1) },
      { ...d, rows: [...d.rows].reverse() },
      { ...d, displayId: "wrong" },
      { ...d, contentHash: "c".repeat(64) },
      { ...d, rows: null },
    ].map((d) => ({ ...result, copiedDatasets: [d] })),
  ])
    assert.equal(await verifiedFolderDatasetAck(input, bad), false);
  assert.equal(
    await verifiedFolderDatasetAck(
      { ...input, projectId: "other-project" },
      result,
    ),
    false,
  );
  assert.equal(
    await verifiedFolderDatasetAck(
      {
        ...input,
        expectedDatasets: [{ ...source, rows: [...source.rows].reverse() }],
      },
      result,
    ),
    false,
  );
});
test("preserves absent option legacy ACK and permits explicit reviewed empty dataset set without adding a dataset", async () => {
  assert.equal(
    await verifiedFolderDatasetAck({ projectId }, { copies: [] }),
    true,
  );
  assert.equal(await verifiedFolderDatasetAck({ projectId }, result), false);
  const emptyHash = createHash("sha256")
    .update(canonical({ projectId, datasets: [] }))
    .digest("hex");
  assert.equal(
    await verifiedFolderDatasetAck(
      { ...input, expectedDatasetHash: emptyHash, expectedDatasets: [] },
      { ...result, datasetReviewHash: emptyHash, copiedDatasets: [] },
    ),
    true,
  );
});
test("rejects overbound metadata/case populations before expensive hashing", async () => {
  assert.equal(
    await verifiedFolderDatasetAck(input, {
      ...result,
      copies: Array.from({ length: 51 }, () => result.copies[0]),
    }),
    false,
  );
  assert.equal(
    await verifiedFolderDatasetAck(input, {
      ...result,
      copiedDatasets: Array.from(
        { length: 51 },
        () => result.copiedDatasets[0],
      ),
    }),
    false,
  );
  assert.equal(
    await verifiedFolderDatasetAck(input, {
      ...result,
      copiedDatasets: [{ ...result.copiedDatasets[0], rowCount: 51 }],
    }),
    false,
  );
});
