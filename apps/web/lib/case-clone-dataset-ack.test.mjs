// SOURCE ONLY: authored, NOT RUN. Requires supported Node strip-types runtime.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
// Browser source uses bundler-compatible extensionless imports. Resolve that
// exact dependency to its file URL only in this Node strip-types harness.
const ackSource = await readFile(
  new URL("./case-clone-dataset-ack.ts", import.meta.url),
  "utf8",
);
const dependencyUrl = new URL("./folder-dataset-copy-ack.ts", import.meta.url)
  .href;
const ackModule = stripTypeScriptTypes(
  ackSource.replace(
    '"./folder-dataset-copy-ack"',
    JSON.stringify(dependencyUrl),
  ),
);
const { verifiedIndependentCloneAck } = await import(
  `data:text/javascript;base64,${Buffer.from(ackModule).toString("base64")}`
);
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
const source = {
  sourceCaseId: "original",
  sourceDatasetId: "old-dataset",
  sourceRevisionHash: "a".repeat(64),
  contentHash: "b".repeat(64),
  rowCount: 2,
  parameterCount: 1,
  rows: [
    { rowIndex: 0, name: "Same" },
    { rowIndex: 1, name: "Same" },
  ],
};
const input = {
  projectId: "project",
  caseId: "original",
  requestId: "request",
  copyParameterDataset: true,
  expectedScope: { organizationId: "org", clerkActorId: "actor" },
  expectedDataset: source,
  expectedDatasetHash: createHash("sha256")
    .update(canonical({ projectId: "project", datasets: [source] }))
    .digest("hex"),
};
const result = {
  caseId: "copy",
  displayId: "project-02",
  requestId: input.requestId,
  projectId: input.projectId,
  ...input.expectedScope,
  copyParameterDataset: true,
  datasetReviewHash: input.expectedDatasetHash,
  copiedDataset: {
    ...source,
    caseId: "copy",
    displayId: "project-02",
    datasetId: "new-dataset",
  },
};
test("ACK verifies actor/original org/exact UUID and full fresh dataset mapping before consumption", async () => {
  assert.equal(await verifiedIndependentCloneAck(input, result), true);
});
test("rejects wrong scope/request/mode/hash, original or duplicated dataset and malformed/truncated mappings", async () => {
  for (const bad of [
    { ...result, requestId: "other" },
    { ...result, organizationId: "other-org" },
    { ...result, clerkActorId: "other-actor" },
    { ...result, projectId: "other-project" },
    { ...result, caseId: "original" },
    { ...result, copyParameterDataset: undefined },
    { ...result, copiedDataset: undefined },
    { ...result, datasetReviewHash: "c".repeat(64) },
    {
      ...result,
      copiedDataset: { ...result.copiedDataset, datasetId: "old-dataset" },
    },
    {
      ...result,
      copiedDataset: { ...result.copiedDataset, rows: [source.rows[0]] },
    },
    {
      ...result,
      copiedDataset: { ...result.copiedDataset, caseId: "original" },
    },
  ])
    assert.equal(await verifiedIndependentCloneAck(input, bad), false);
});
test("retains legacy no-option identity acknowledgements but forbids unexpected dataset transfer", async () => {
  assert.equal(
    await verifiedIndependentCloneAck(
      { projectId: "project", caseId: "original", requestId: "legacy" },
      { caseId: "copy", displayId: "project-02" },
    ),
    true,
  );
  assert.equal(
    await verifiedIndependentCloneAck(
      { projectId: "project", caseId: "original", requestId: "legacy" },
      result,
    ),
    false,
  );
});
test("scoped ordinary clone requires echoes even without dataset and dataset content evidence must match exact captured preview", async () => {
  const {
    copyParameterDataset: _flag,
    expectedDataset: _dataset,
    expectedDatasetHash: _hash,
    ...ordinary
  } = input;
  const {
    copyParameterDataset: _mode,
    copiedDataset: _copy,
    datasetReviewHash: _review,
    ...plain
  } = result;
  assert.equal(await verifiedIndependentCloneAck(ordinary, plain), true);
  assert.equal(
    await verifiedIndependentCloneAck(ordinary, {
      caseId: "copy",
      displayId: "project-02",
    }),
    false,
  );
  assert.equal(
    await verifiedIndependentCloneAck(
      { ...input, expectedDataset: { ...source, contentHash: "c".repeat(64) } },
      result,
    ),
    false,
  );
});
