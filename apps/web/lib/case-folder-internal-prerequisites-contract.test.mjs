// SOURCE ONLY; not executed/rendered tonight.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ui = readFileSync(
  new URL("../components/TestCaseFolderCopy.tsx", import.meta.url),
  "utf8",
);
const server = readFileSync(
  new URL("../../api/src/services/caseFolderCopy.ts", import.meta.url),
  "utf8",
);
const readableUi = ui.replace(/\s+/g, " "),
  readableServer = server.replace(/\s+/g, " ");
test("internal remapping is explicit opt-in, complete source review and captured approval", () => {
  for (const phrase of [
    "setCopyInternalPrerequisites(false)",
    "Also review internal prerequisite links",
    "reviewed.internalPrerequisites.map",
    "expectedInternalPrerequisites",
    "expectedPrerequisiteHash",
    "new copied identities",
    "listed internal prerequisite link",
    "review.data.copyInternalPrerequisites === !!prepared.copyInternalPrerequisites",
  ])
    assert.ok(readableUi.includes(phrase), phrase);
});
test("ACK graph validation precedes clearing retained exact request; results disclose historical mapping", () => {
  assert.ok(
    ui.indexOf("await verifiedFolderPrerequisiteAck(input, result)") <
      ui.indexOf("receipt.current = null"),
  );
  for (const phrase of [
    "!graphVerified",
    "receipt.current?.input !== input",
    "mutation.mutate(pending)",
    "later relationship edits",
    "completed.copiedPrerequisites.map",
    "edge.dependentDisplayId",
    "edge.prerequisiteDisplayId",
  ])
    assert.ok(readableUi.includes(phrase), phrase);
});
test("server retains lock/complete graph/CAS/clone-all/remap/receipt order and unchanged unsupported guards", () => {
  for (const phrase of [
    "MAX_FOLDER_COPY_PREREQUISITES + 1",
    "FOR SHARE",
    "reviewedInternalPrerequisites",
    "p.prerequisiteReviewHash !== input.expectedPrerequisiteHash",
    "qualityProfileHash(input.expectedInternalPrerequisites)",
    "procedureVersionContainsRelationships: false",
    "Source steps contain media references",
    "shared step library",
    "parameter dataset",
    "case attachments",
    "archived case",
    "Retained copy belongs to the project's previous organization",
  ])
    assert.ok(readableServer.includes(phrase), phrase);
  assert.ok(
    server.indexOf("const copyBySource = new Map") >
      server.indexOf("await createCaseCloneInTransaction"),
  );
  assert.ok(
    server.indexOf("await tx.testCasePrerequisite.createMany") <
      server.indexOf("await tx.caseFolderState.upsert"),
  );
  assert.match(
    readableServer,
    /schemaVersion: input\.copyParameterDatasets \? 5 : input\.copyInternalPrerequisites \? 4 : 3/,
  );
  assert.ok(readableServer.includes("...(input.copyInternalPrerequisites ?"));
});
