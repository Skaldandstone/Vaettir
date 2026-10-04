// Source-only contracts authored tonight, UNEXECUTED. Not deletion acceptance.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
const text = readFileSync(
  fileURLToPath(
    new URL("../app/admin/organizations/[id]/page.tsx", import.meta.url),
  ),
  "utf8",
);
test("deletion preview discloses original ownership and refuses unsupported current preview", () => {
  assert.match(
    text,
    /reportScope\?\.originalOrganizationId === organizationId/,
  );
  assert.match(text, /basis === "ORIGINAL_ORGANIZATION"/);
  assert.match(text, /!reportErasureScope.blocked/);
  assert.match(text, /originalRecordsOnReparentedProjects/);
  assert.match(text, /unsupportedForeignOriginalRecordsOnCurrentProjects/);
  assert.match(
    text,
    /unsupportedForeignSnapshotsReferencingOriginalDefinitions/,
  );
  assert.match(text, /reportErasureScope.limitations.map/);
});
test("handler and destructive button require current nonblocked review without executing deletion", () => {
  assert.match(text, /if \(!deletionReviewReady\)/);
  assert.match(
    text,
    /disabled=\{deleting \|\| !deletionReviewReady \|\| confirmSlug !== org.slug\}/,
  );
  assert.match(
    text,
    /!orgQuery.error && !orgQuery.isFetching && !orgQuery.isPaused/,
  );
});
