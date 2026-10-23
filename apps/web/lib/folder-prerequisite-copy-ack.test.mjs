// Authored source assertions only; intentionally NOT executed tonight.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifiedFolderPrerequisiteAck } from "./folder-prerequisite-copy-ack.ts";

const edges = [{ dependentId: "source-b", prerequisiteId: "source-a" }];
const hash = createHash("sha256")
  .update(JSON.stringify({ edges, projectId: "synthetic-project" }))
  .digest("hex");
const input = {
  projectId: "synthetic-project",
  copyInternalPrerequisites: true,
  expectedPrerequisiteHash: hash,
  expectedInternalPrerequisites: edges,
};
const result = {
  copyInternalPrerequisites: true,
  prerequisiteReviewHash: hash,
  copies: [
    { sourceId: "source-a", caseId: "copy-a", displayId: "synthetic-03" },
    { sourceId: "source-b", caseId: "copy-b", displayId: "synthetic-04" },
  ],
  copiedPrerequisites: [
    {
      sourceDependentId: "source-b",
      sourcePrerequisiteId: "source-a",
      sourceDependentDisplayId: "synthetic-02",
      sourcePrerequisiteDisplayId: "synthetic-01",
      dependentId: "copy-b",
      prerequisiteId: "copy-a",
      dependentDisplayId: "synthetic-04",
      prerequisiteDisplayId: "synthetic-03",
    },
  ],
};
test("validates captured graph SHA and complete fresh identity mapping before ACK", async () => {
  assert.equal(await verifiedFolderPrerequisiteAck(input, result), true);
});
test("does not acknowledge missing/truncated/duplicate/source-pointing/unreviewed edges or hashes", async () => {
  for (const bad of [
    { ...result, copiedPrerequisites: [] },
    { ...result, prerequisiteReviewHash: "a".repeat(64) },
    {
      ...result,
      copiedPrerequisites: [
        result.copiedPrerequisites[0],
        result.copiedPrerequisites[0],
      ],
    },
    {
      ...result,
      copiedPrerequisites: [
        { ...result.copiedPrerequisites[0], prerequisiteId: "source-a" },
      ],
    },
    { ...result, copies: [result.copies[0], result.copies[0]] },
    {
      ...result,
      copies: [result.copies[0], { ...result.copies[1], caseId: "source-a" }],
    },
    {
      ...result,
      copiedPrerequisites: [
        {
          ...result.copiedPrerequisites[0],
          dependentDisplayId: "wrong-identity",
        },
      ],
    },
  ])
    assert.equal(await verifiedFolderPrerequisiteAck(input, bad), false);
  assert.equal(
    await verifiedFolderPrerequisiteAck(
      { ...input, projectId: "other-project" },
      result,
    ),
    false,
  );
  assert.equal(
    await verifiedFolderPrerequisiteAck(
      {
        ...input,
        expectedInternalPrerequisites: [
          { dependentId: "source-a", prerequisiteId: "source-b" },
        ],
      },
      result,
    ),
    false,
  );
});
test("preserves legacy no-opt-in acknowledgements but refuses an unexpected remapping mode", async () => {
  assert.equal(
    await verifiedFolderPrerequisiteAck(
      { projectId: "synthetic-project" },
      { copies: [] },
    ),
    true,
  );
  assert.equal(
    await verifiedFolderPrerequisiteAck(
      { projectId: "synthetic-project" },
      result,
    ),
    false,
  );
  assert.equal(
    await verifiedFolderPrerequisiteAck(input, {
      ...result,
      copyInternalPrerequisites: false,
    }),
    false,
  );
});
test("bounds receipt/approved population and supports reviewed empty internal graph", async () => {
  assert.equal(
    await verifiedFolderPrerequisiteAck(input, {
      ...result,
      copiedPrerequisites: Array.from(
        { length: 2501 },
        () => result.copiedPrerequisites[0],
      ),
    }),
    false,
  );
  assert.equal(
    await verifiedFolderPrerequisiteAck(input, {
      ...result,
      copies: Array.from({ length: 51 }, () => result.copies[0]),
    }),
    false,
  );
  const emptyHash = createHash("sha256")
    .update(JSON.stringify({ edges: [], projectId: input.projectId }))
    .digest("hex");
  assert.equal(
    await verifiedFolderPrerequisiteAck(
      {
        ...input,
        expectedInternalPrerequisites: [],
        expectedPrerequisiteHash: emptyHash,
      },
      {
        copyInternalPrerequisites: true,
        prerequisiteReviewHash: emptyHash,
        copies: result.copies,
        copiedPrerequisites: [],
      },
    ),
    true,
  );
});
