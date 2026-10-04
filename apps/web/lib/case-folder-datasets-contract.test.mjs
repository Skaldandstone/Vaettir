// SOURCE ONLY. Static assertions are authored, not run or rendered tonight.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ui = readFileSync(
    new URL("../components/TestCaseFolderCopy.tsx", import.meta.url),
    "utf8",
  ),
  server = readFileSync(
    new URL("../../api/src/services/caseFolderCopy.ts", import.meta.url),
    "utf8",
  ),
  validator = readFileSync(
    new URL(
      "../../api/src/services/caseFolderCopyDatasets.ts",
      import.meta.url,
    ),
    "utf8",
  );
const normalize = (s) => s.replace(/\s+/g, " "),
  u = normalize(ui),
  s = normalize(server),
  v = normalize(validator);
test("dataset opt-in reviews every concrete value and preserves fresh composite row identity with explicit limitations", () => {
  for (const phrase of [
    "setCopyParameterDatasets(false)",
    "Also review supported parameter datasets",
    "Complete parameter dataset review",
    "reviewed.datasets.map",
    "d.parameterNames.map",
    "row.values[name]",
    "Empty string",
    "new dataset ID",
    "preserved row index",
    "unsupported row overrides/correlations",
    "expectedDatasetHash: reviewed.datasetReviewHash",
    "expectedDatasets: reviewed.datasetSources",
  ])
    assert.ok(u.includes(phrase), phrase);
  assert.ok(
    u.includes(
      "review.data.copyParameterDatasets === !!prepared.copyParameterDatasets",
    ),
  );
  assert.ok(!u.includes("dangerouslySetInnerHTML"));
});
test("exact dataset ACK completes before consuming UUID; scope/refresh/history guards remain independent", () => {
  assert.ok(
    ui.indexOf("await verifiedFolderDatasetAck(input, result)") <
      ui.indexOf("receipt.current = null"),
  );
  for (const phrase of [
    "!datasetsVerified",
    "receipt.current?.input !== input",
    "mutation.mutate(pending)",
    "result.organizationId !== acknowledgedScope.organizationId",
    "result.clerkActorId !== acknowledgedScope.clerkActorId",
    "completed.copiedDatasets.map",
    "historical",
    "current folders",
    "scope.matches(review.data)",
    'review.fetchStatus === "idle"',
  ])
    assert.ok(u.toLowerCase().includes(phrase.toLowerCase()), phrase);
});
test("strict datasets are bounded before body projection, lock/CAS/create/receipt ordering remains atomic, v3/v4 absence remains exact", () => {
  for (const phrase of [
    "FOR SHARE OF d",
    "p.datasetPlan?.reviewHash !== input.expectedDatasetHash",
    "qualityProfileHash(input.expectedDatasets)",
    "validatedDatasetReplay",
    "procedureVersionContainsDataset: false",
    'rowIdentity: "DATASET_ID_AND_ROW_INDEX"',
    "schemaVersion: input.copyParameterDatasets ? 5 : input.copyInternalPrerequisites ? 4 : 3",
  ])
    assert.ok(s.includes(phrase), phrase);
  assert.ok(
    server.indexOf("await tx.testCaseDataset.create") >
      server.indexOf("await createCaseCloneInTransaction"),
  );
  assert.ok(
    server.indexOf("await tx.testCaseDataset.create") <
      server.indexOf("await tx.caseFolderWrite.create"),
  );
  assert.ok(
    validator.indexOf("const sizes =") <
      validator.indexOf("tx.testCaseDataset.findMany"),
  );
  for (const phrase of [
    "executionDatasetSchema.safeParse",
    "qualityProfileHash(parsed.data) !== qualityProfileHash(value)",
    "resolveDatasetProcedure",
    "row pairing is unsupported",
    "500-instance",
    "256 KiB",
    "2 MiB",
    "4 MiB",
    "Nothing was recreated",
  ])
    assert.ok(v.includes(phrase), phrase);
});
