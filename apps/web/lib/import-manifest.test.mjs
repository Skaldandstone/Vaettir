import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("live API imports retain full preview manifests and send them back on approval",()=>{
  const source=readFileSync(new URL("../components/MigrationWizard.tsx",import.meta.url),"utf8");
  assert.equal((source.match(/sourceManifest: res\.sourceManifest/g)??[]).length,2);
  assert.equal((source.match(/expectedManifest: filePreview\.sourceManifest/g)??[]).length,2);
  assert.match(source,/manifestNeedsRefresh \|\| !filePreview\.sourceManifest/);
  assert.match(source,/"CONFLICT"\) setManifestNeedsRefresh\(true\)/);
  assert.match(source,/Refresh preview/);
  assert.match(source,/table below is a display sample only/);
  assert.match(source,/Root-level or unfiled test cases are not fetched or included in this count/);
});
